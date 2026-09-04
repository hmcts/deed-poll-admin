/**
 * Send the browser to IDAM to sign in.
 *
 * Public, and has to be: requiring a session to reach the page that creates one is a loop.
 */
import type { Request, Response } from "express";
import { beginLogin } from "../auth/idam.js";
import { sessionUser, startFlow } from "../auth/session.js";
import { idamSettings } from "../auth/settings.js";

export const GET = async (req: Request, res: Response) => {
  // Already signed in: go where they were heading rather than round the flow again.
  if (sessionUser(req)) {
    return res.redirect(safeReturnTo(req));
  }

  const { authorizationUrl, flow } = await beginLogin(idamSettings(), safeReturnTo(req));
  startFlow(req, flow);

  // Saved explicitly: the redirect leaves for IDAM immediately, and if the PKCE verifier has not
  // reached the store by the time the callback arrives on another pod, the exchange fails.
  req.session.save((error) => (error ? res.status(500).render("errors/500") : res.redirect(authorizationUrl)));
};

/**
 * Where to go after signing in, restricted to a path on this site.
 *
 * `returnTo` arrives in a query string, so it is attacker-controlled. Redirecting to it unchecked
 * makes `/login?returnTo=https://evil.example` an open redirect that borrows this service's domain to
 * launder a phishing link. Only a rooted path is accepted, and `//host` is rejected too because
 * browsers read a protocol-relative URL as absolute.
 */
function safeReturnTo(req: Request): string {
  const raw = req.query.returnTo;
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/deed-polls";
  }
  return raw;
}
