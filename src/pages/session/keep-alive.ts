/**
 * The timeout warning's "Stay signed in": records activity now and answers 204.
 *
 * Public in `requireAuth`'s allowlist only so an anonymous request gets a 401 here, not a redirect to sign in that the
 * warning's `fetch` would follow. Signed-in requests have already passed `sessionLifetime`, so a session past a limit
 * never reaches this handler, and only the idle clock moves: staying signed in cannot pass the absolute deadline.
 * `requireSameOrigin` refuses it from any other site, like every other write.
 */
import type { Request, Response } from "express";
import { isSessionGone, sessionUser, signOut, touchLastSeen } from "../../auth/session.js";

export const POST = async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  if (!sessionUser(req)) return res.sendStatus(401);
  try {
    await touchLastSeen(req);
  } catch (error) {
    // Ended by another request since this one was loaded: answered as any signed-out request is.
    if (!isSessionGone(error)) throw error;
    await signOut(req);
    return res.sendStatus(401);
  }
  res.sendStatus(204);
};
