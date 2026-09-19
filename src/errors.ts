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
import { ForbiddenError, InvalidInputError, NotFoundError } from "@hmcts/deed-poll";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";

export function domainErrorHandler(): ErrorRequestHandler {
  return (err: Error, _req: Request, res: Response, next: NextFunction) => {
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
      console.error(`forbidden: ${err.message}`);

      // Reached by `requireJudicial` (./auth/require-role.ts), which refuses an authenticated non-judge this
      // way rather than rendering its own page, and by api's own 403. The 404 **view** on a 403 status keeps
      // the area non-enumerable: telling a caseworker who guessed a judicial URL that there is something
      // there to be refused from is more than they need to know. `src/pages/errors/403.njk` does exist, but
      // it is the login flow's — there the user already knows who they are and what was refused.
      return res.status(403).render("errors/404");
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
