/**
 * End the session here, then end it at IDAM.
 *
 * Local first: if the IDAM round trip fails or the browser abandons it, the user is still signed out
 * of this service, which is the half that matters. Doing it the other way round can leave someone
 * looking at a logged-out IDAM page while still authenticated here.
 */
import type { Request, Response } from "express";
import { endSessionUrl } from "../auth/idam.js";
import { sessionIdToken, signOut } from "../auth/session.js";
import { idamSettings } from "../auth/settings.js";

export const GET = async (req: Request, res: Response) => {
  const idToken = sessionIdToken(req);
  await signOut(req);

  const away = await endSessionUrl(idamSettings(), idToken);

  // A cached case page is an exposure from the moment the user has gone, so tell the browser to drop them.
  // "cache" only: "cookies" would also wipe the cookie-consent choice, and the app keeps nothing in storage.
  res.setHeader("Clear-Site-Data", '"cache"');

  // No end-session endpoint advertised: the local sign-out is done, so say so rather than pretending
  // the IDAM session is gone too.
  res.redirect(away ?? "/");
};
