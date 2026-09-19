/**
 * The resource-owner password grant — obtaining a genuine IDAM token for a named test user.
 *
 * **Its only caller is the persona switcher** (`src/pages/switch-persona.ts`, gated by
 * `./persona-switcher.ts`), and it is a separate file for the same reason `client-credentials.ts` is:
 * `idam.ts` owns the browser flow, and each additional grant this app performs is a deliberate,
 * separately-reviewable thing rather than another branch inside that one.
 *
 * **Why a grant at all, rather than rewriting the session's roles.** api derives roles from `/o/userinfo`
 * using the access token it is handed — `src/auth/idam.ts` says the same of this app — and the access token
 * carries no roles of its own. So a session that claimed a role it had not been issued would render the
 * judicial chrome and then collect a 403 from api on every call behind it: a UI that lies, and one that
 * looks exactly like a defect in the screens being tested. Obtaining a real token for the persona's own
 * user makes every downstream decision correct for free, including the `createdBy`/`claimedBy`/`decidedBy`
 * api stamps from the token.
 *
 * **`genericGrantRequest` because `openid-client` publishes no `password` helper.** The grant is dropped in
 * OAuth 2.1 and the library offers only the grants it endorses; the generic request is the supported way to
 * perform another one. It is not a lower-level escape hatch in the way that matters here — the response goes
 * through `processGenericTokenEndpointResponse`, so an ID token in it is **validated** (signature against the
 * issuer's JWKS, `iss`, `aud`, `exp`) before `claims()` will return anything. Those claims are therefore
 * checked claims rather than a decode.
 *
 * **Roles still come from userinfo, not from the token**, exactly as in `completeLogin` — the ID token is thin
 * and reading roles from it yields none at all against real IDAM, which presents as a permissions bug rather
 * than an error. The subject is taken from the validated ID token and `fetchUserInfo` is checked against it,
 * so a userinfo response describing somebody else is refused.
 *
 * **The scope is the configured one, and `offline_access` in it is load-bearing.** It is what makes IDAM
 * return a **refresh token** for the new persona. Replacing the access token without it would leave the
 * previous user's refresh token in the session, and `refreshMiddleware` renews five minutes before expiry —
 * so the session would silently revert to whoever was signed in before, presenting as the app losing your
 * persona at random. See `signIn` in `./session.js`, which is what the caller uses to replace all of it.
 *
 * **It never reads a real user's credentials.** The only usernames it is called with are the configured
 * personas in `./persona-switcher.ts`, and the password is that fixture set's own.
 */
import { type IdamClaims, userFromClaims } from "@hmcts/deed-poll";
import * as client from "openid-client";
import { expiresAtFrom, type IdamConfig, idamConfiguration, type LoginResult } from "./idam.js";

export async function passwordGrantLogin(config: IdamConfig, username: string, password: string): Promise<LoginResult> {
  const configuration = await idamConfiguration(config);

  const tokens = await client.genericGrantRequest(configuration, "password", { username, password, scope: config.scope });

  const claims = tokens.claims();
  if (!claims?.sub) {
    // A token response with no verifiable ID token is not an identity, and adopting it would replace the
    // session's user with nobody. Same refusal as `completeLogin`'s, and for the same reason.
    throw new Error("IDAM returned no ID token subject for the password grant");
  }

  const info = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);

  return {
    user: userFromClaims(info as IdamClaims),
    subject: claims.sub,
    tokens: {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiresAtFrom(tokens)
    }
  };
}
