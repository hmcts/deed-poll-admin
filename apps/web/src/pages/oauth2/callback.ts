/**
 * Where IDAM sends the browser back with an authorization code.
 *
 * Exchanges the code for tokens, reduces the ID token to a `CurrentUser`, and signs in. The `state`
 * and PKCE checks both happen inside `completeLogin`, against values read from this session — so a
 * code obtained in a different browser cannot be redeemed here.
 */
import type { Request, Response } from "express";
import { callbackUrl, completeLogin } from "../../auth/idam.js";
import { signIn, takeFlow } from "../../auth/session.js";
import { idamSettings } from "../../auth/settings.js";

export const GET = async (req: Request, res: Response) => {
  const flow = takeFlow(req);

  // No in-flight flow: either a bookmarked callback, a replayed code, or a session that expired
  // mid-login. None is an error worth a stack trace, and all are fixed by starting again.
  if (!flow) {
    return res.redirect("/login");
  }

  // IDAM reports a refusal by redirecting here with ?error=, not by failing the exchange. Without
  // this the code exchange would fail on a missing `code` and report a server fault for what is
  // usually the user declining or a misconfigured client.
  if (typeof req.query.error === "string") {
    return res.status(403).render("errors/403", { reason: req.query.error_description ?? req.query.error });
  }

  const settings = idamSettings();

  let signedIn: Awaited<ReturnType<typeof completeLogin>>;
  try {
    signedIn = await completeLogin(settings, flow, callbackUrl(settings, req));
  } catch (error) {
    // A failed exchange is a failed login, and 403 is what the user should see whether the cause was
    // a forged `state`, a replayed code, or a misconfigured client secret. Letting it propagate gave a
    // **500** for the security check working correctly — the same shape of mistake as the upload
    // parser's, and the reason this is caught at the source rather than left to error middleware.
    //
    // Logged at error level regardless, because the operator's reading of "nobody can log in" is
    // entirely different from the user's, and only the log distinguishes a forgery from an outage.
    console.error("IDAM authorization code exchange failed:", error);
    return res.status(403).render("errors/403");
  }

  await signIn(req, signedIn.user, signedIn.idToken);

  res.redirect(flow.returnTo);
};
