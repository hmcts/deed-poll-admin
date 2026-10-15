/**
 * How long the session has left, for the timeout warning to check before it declares a timeout, because the user
 * may have been active in another tab.
 *
 * The figures are `sessionLifetime`'s, which answers this path without recording activity or ending the session.
 * Public for the same reason as `keep-alive.ts`: an anonymous request gets a 401, not a redirect.
 */
import type { Request, Response } from "express";
import { sessionUser } from "../../auth/session.js";

export const GET = (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  if (!sessionUser(req) || !res.locals.sessionClock) return res.sendStatus(401);
  res.json(res.locals.sessionClock);
};
