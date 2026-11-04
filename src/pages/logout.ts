/**
 * End the session here, then end it at IDAM.
 *
 * Local first: if the IDAM round trip fails or the browser abandons it, the user is still signed out
 * of this service, which is the half that matters. Doing it the other way round can leave someone
 * looking at a logged-out IDAM page while still authenticated here. The IDAM address is asked for last, and an
 * outage reads like an issuer with no end-session endpoint, so the redirect always happens (review finding R04).
 * Either lands on `/signed-out`, never `/`: `/` sends an anonymous visitor straight to sign-in, and an IDAM session that
 * survived the outage would sign them back in (plan `docs/plans/completed/20261021-r04b-signed-out-page.md`).
 */
import type { Request, Response } from "express";
import { availableEndSessionUrl } from "../auth/end-session.js";
import { securityEvent } from "../auth/security-events.js";
import { sessionIdToken, signOut } from "../auth/session.js";
import { idamSettings } from "../auth/settings.js";

const SIGNED_OUT_PATH = "/signed-out";

export const GET = async (req: Request, res: Response) => {
  const idToken = sessionIdToken(req);
  // Before `signOut`, which takes the subject and the session id with it.
  securityEvent("auth.logout", req);
  await signOut(req);

  // A cached case page is an exposure from the moment the user has gone, so tell the browser to drop them.
  // "cache" only: "cookies" would also wipe the cookie-consent choice, and the app keeps nothing in storage.
  res.setHeader("Clear-Site-Data", '"cache"');

  const away = await availableEndSessionUrl(idamSettings(), idToken);

  // No end-session endpoint advertised, or IDAM unreachable: the local sign-out is done, so say so rather than pretending
  // the IDAM session is gone too.
  res.redirect(away ?? SIGNED_OUT_PATH);
};
