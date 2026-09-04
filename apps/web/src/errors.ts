/**
 * Maps domain errors thrown out of page handlers onto rendered pages.
 *
 * `apps/api` has an equivalent (`apps/api/src/errors.ts`) that answers JSON. This one answers HTML,
 * because the caller is a browser: a caseworker following a stale link to a deleted case should get
 * the service's own "Page not found" page, not a JSON body and not a 500.
 *
 * **Without this the pages returned 500 for a missing case.** `apps/web` mounts the starter's
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
      // No page mounts a role guard yet, so this is unreachable today. It is here because the
      // alternative — a 500 the first time one is added — is exactly the failure this file exists to
      // stop, and 403 has no view of its own in the starter.
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
