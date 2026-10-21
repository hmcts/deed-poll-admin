/**
 * Where IDAM sends the browser back with an authorization code.
 *
 * Exchanges the code for tokens, reduces the ID token to a `CurrentUser`, and signs in. The `state`
 * and PKCE checks both happen inside `completeLogin`, against values read from this session — so a
 * code obtained in a different browser cannot be redeemed here.
 */
import type { Request, Response } from "express";
import { callbackUrl, completeLogin, describeIdamError } from "../../auth/idam.js";
import { safeReturnTo } from "../../auth/return-to.js";
import { securityEvent } from "../../auth/security-events.js";
import { signIn, takeFlow } from "../../auth/session.js";
import { idamSettings } from "../../auth/settings.js";

// RFC 6749's error codes are lower-case words joined by underscores. The query is the browser's to write, so
// anything else is recorded as one fixed value rather than as text an attacker chose.
const IDAM_ERROR_CODE = /^[a-z_]{1,64}$/;

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
    // The code only: `error_description` is prose IDAM may fill with the user's own details.
    securityEvent("auth.login.failed", req, { reason: "idam_error", outcome: idamErrorCode(req.query.error) });
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
    console.error("IDAM authorization code exchange failed:", describeIdamError(error));
    securityEvent("auth.login.failed", req, { reason: "exchange_failed" });
    return res.status(403).render("errors/403");
  }

  await signIn(req, signedIn.user, signedIn.subject, signedIn.tokens);
  // After `signIn`, so the sid is the regenerated session's rather than the pre-login one.
  securityEvent("auth.login.succeeded", req);

  // Checked again although `/login` already checked it before storing: this sink trusts every writer of the flow,
  // and a writer added later that forgot would make the one redirect a user trusts most an open one.
  res.redirect(safeReturnTo(flow.returnTo));
};

function idamErrorCode(error: string): string {
  return IDAM_ERROR_CODE.test(error) ? error : "unrecognised";
}
