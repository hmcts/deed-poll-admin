/**
 * What a request does when the session it was loaded with has gone while it ran (review finding E01): logged out,
 * replaced by a sign-in, or expired, by another request or instance. The store refused its write, so nothing was put
 * back; this makes sure the request does not go on as the user its in-memory snapshot still describes.
 *
 * Nothing is emitted, because whatever ended the session already did. The destroy deletes nothing that still exists,
 * and leaves `express-session` no session to save or touch when the response ends. The log line names no session,
 * subject or token.
 */
import type { Request, Response } from "express";
import { signOut } from "./session.js";

export async function endedElsewhere(req: Request, res: Response, returnTo = req.originalUrl): Promise<void> {
  console.warn("Session ended elsewhere while this request held it — continuing signed out");
  await signOut(req);
  res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}
