/**
 * Records when a request reached this app, as `res.locals.receivedAt` (epoch milliseconds).
 *
 * The Gazette send's deadline is counted from this moment rather than from the send, because the frontend Application
 * Gateway cuts the browser off 30 s after the request left it, however that time was spent here: a token refresh
 * against IDAM, `/me`, the re-check of every selected review. Plan `docs/plans/completed/20261021-r03b-gazette-send-deadline.md`.
 *
 * **Mounted first in `createApp`**, so no layer can spend time the deadline does not see; `app.test.ts` pins it.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

export function recordArrival(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.locals.receivedAt = Date.now();
    next();
  };
}
