/**
 * Maps domain errors thrown out of page handlers onto rendered pages.
 *
 * The only such mapping left in the repo, now that the JSON-answering one in the deleted `apps/api` has
 * gone. This one answers HTML, because the caller is a browser: a caseworker following a stale link to a
 * deleted case should get the service's own "Page not found" page, not a JSON body and not a 500.
 *
 * **Without this the pages returned 500 for a missing case.** The app mounts the starter's
 * `errorHandler`, which logs and renders `errors/500` for anything at all — it has no knowledge of
 * `NotFoundError`. That is the same gap that produced three defects in Phase 3, on the API side:
 * an expected, caller-caused condition reaching an error handler that does not recognise it.
 *
 * Mounted **before** the starter's handler and delegating via `next(err)` for anything it does not
 * recognise, so a genuine fault still gets the starter's logging and its 500 page. Replacing the
 * starter's handler outright would mean reimplementing both, in a file the next re-scaffold
 * overwrites.
 */
import { ForbiddenError, InvalidInputError, NotFoundError, TooManyRequestsError, UnauthorizedError } from "@hmcts/deed-poll";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { type SecurityEventName, type SecurityEventProps, securityEvent } from "./auth/security-events.js";
import { signOut } from "./auth/session.js";
import { forLog } from "./for-log.js";

export function domainErrorHandler(): ErrorRequestHandler {
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    // Past the point of changing the status, so let Express abort rather than attempt a second set
    // of headers. Relevant here because the document download route streams.
    if (res.headersSent) {
      return next(err);
    }

    if (err instanceof NotFoundError) {
      // The starter's own 404 view, so a missing case and a mistyped URL look the same to a user —
      // which they should: both mean "there is nothing here".
      return res.status(404).render("errors/404");
    }

    if (err instanceof ForbiddenError) {
      // Logged here rather than passed on, because the render below is the end of the road: the starter's
      // handler is the only thing in the chain that logs, and it is never reached. `requireJudicial` puts
      // the path and the role it wanted in the message for exactly this line — a refusal on the app's one
      // authorization boundary that left no trace anywhere is a question nobody could answer later.
      console.error(`forbidden: ${forLog(err.message)}`);
      const [event, props] = refusalEvent(err);
      securityEvent(event, req, props);

      // Reached by `requireJudicial` (./auth/require-role.ts), which refuses an authenticated non-judge this
      // way rather than rendering its own page, and by api's own 403. The 404 **view** on a 403 status keeps
      // the area non-enumerable: telling a caseworker who guessed a judicial URL that there is something
      // there to be refused from is more than they need to know. `src/pages/errors/403.njk` does exist, but
      // it is the login flow's — there the user already knows who they are and what was refused.
      return res.status(403).render("errors/404");
    }

    if (err instanceof UnauthorizedError) {
      // api refused a token this session still believes in — its user deleted or its IDAM session ended,
      // which is every AAT persona within three hours of being created. Left to the 500 page, the caseworker
      // had no way back short of clearing cookies. **Rendered, never redirected**: a redirect to `/login`
      // loops when IDAM's own session silently re-issues a token api refuses again (a misconfigured
      // audience, say), whereas a link costs one click and cannot. Signing out first is what makes the link
      // honest, since `/login` with a live session would hand the same token straight back.
      console.error(`signing out after api refused the session's token: ${forLog(err.message)}`);
      // Before `signOut`, which takes the subject and the session id with it.
      securityEvent("auth.session.ended", req, { reason: "api_401" });
      return signOut(req).then(
        // Back to the page they were on, but only for a read: a POST has nothing to return to, and `/login`
        // checks `returnTo` itself, so this is a convenience rather than a trust decision.
        () => res.status(401).render("errors/401", { returnTo: req.method === "GET" ? req.originalUrl : null }),
        (error: unknown) => next(error)
      );
    }

    if (err instanceof TooManyRequestsError) {
      // Not logged here: the limit that refused records it — api in its own logs, this app's limiter in its `rate_limit` line.
      const seconds = err.retryAfterSeconds;
      if (seconds !== null) {
        res.setHeader("Retry-After", String(seconds));
      }
      // Rounded up and never below one, because "try again in 0 minutes" reads as "now".
      return res.status(429).render("errors/429", { retryAfterMinutes: seconds === null ? null : Math.max(1, Math.ceil(seconds / 60)) });
    }

    if (err instanceof InvalidInputError) {
      // A page that validates input is expected to catch this and re-render its form with the
      // errors against the fields, which is the whole reason InvalidInputError carries them. Reaching
      // here means a handler did not, so it is a bug in that handler rather than a user error, and it
      // is passed on to be logged as one.
      return next(err);
    }

    next(err);
  };
}

/**
 * Every 403 is recorded here and nowhere else, so each refusal is exactly one event whichever gate raised it. The
 * error's bounded details travel; its message, which is free text for the log, does not.
 */
function refusalEvent(err: ForbiddenError): [SecurityEventName, SecurityEventProps] {
  if (err.reason === "same-origin") {
    return ["csrf.refused", { fetchSite: err.fetchSite, originHost: err.originHost }];
  }
  return ["authz.denied", { source: err.reason, requiredCapability: err.requiredCapability }];
}
