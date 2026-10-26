/**
 * The IDAM OpenID Connect client, and the two halves of the authorization-code flow.
 *
 * Follows `docs/reference/standards/authentication-and-authorization.md`: authorization code flow
 * with PKCE for browser authentication, and client credentials reserved for service-to-service.
 *
 * **Endpoints are discovered, not configured.** `openid-client`'s `discovery()` reads the issuer's
 * `/.well-known/openid-configuration` and takes the authorization, token and JWKS endpoints from
 * there. That is deliberate: this was written without access to a real CFT IDAM instance, so any
 * endpoint path hardcoded here would have been a guess. Discovery means the paths come from whoever
 * actually operates the issuer, and a change at their end does not need a release here.
 *
 * **`openid-client` rather than a hand-rolled flow.** PKCE, `state`, the code exchange and ID-token
 * signature/claim validation against a rotating JWKS are all easy to implement almost-correctly, and
 * an almost-correct one accepts tokens it should not. This library is maintained by the author of
 * `jose` and is ESM-only, which matches the workspace.
 */
import { type IdamClaims, plainHttpPermitted, userFromClaims } from "@hmcts/deed-poll";
import type { Request } from "express";
import * as client from "openid-client";
import { fetchCallerAccess } from "./caller-access.js";

/**
 * How long a failed discovery holds off the next one. Short enough that a login a few seconds after IDAM recovers
 * succeeds, long enough that an outage under load is one request per interval rather than one per login.
 */
const DISCOVERY_RETRY_COOLDOWN_MS = 5_000;

/** What the flow needs to remember between the redirect out and the callback back. */
export interface AuthFlowState {
  /** PKCE verifier. Never leaves the session; only its S256 challenge goes to IDAM. */
  codeVerifier: string;
  /** CSRF guard. IDAM echoes it back and the callback refuses a mismatch. */
  state: string;
  /** Where the user was heading before being sent to log in. */
  returnTo: string;
}

export interface IdamConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

/**
 * Discovery result, cached for the process's lifetime.
 *
 * Cached because discovery is a network call and doing it per request would put IDAM's availability
 * in the path of every login. Not cached across restarts, so a pod picks up endpoint changes when it
 * cycles. `openid-client` handles JWKS fetching and key rotation inside the returned configuration.
 *
 * **Only a success is kept.** A pending attempt is shared by every caller that arrives while it runs, but a
 * rejected one releases the cache, so the next login rediscovers once IDAM recovers rather than replaying the
 * first outage until the pod restarts. The release is made only by the attempt that owns the entry: one
 * replaced by `resetIdamDiscovery` must not clear the attempt that replaced it.
 *
 * **A failure holds off the next attempt for `DISCOVERY_RETRY_COOLDOWN_MS`**, so an outage costs IDAM at most one
 * discovery request per interval however many logins arrive. Callers inside it are refused at once rather than
 * queued, and the first after it starts one shared attempt. There is no background retry: recovery is driven by
 * the next request, and a pod whose discovery keeps failing is a misconfigured issuer, not a transient outage.
 */
let discovered: Promise<client.Configuration> | undefined;
/** `Date.now()` before which no new discovery may start; set only by the failure of the attempt that owned the cache. */
let retryNotBefore: number | undefined;

export function resetIdamDiscovery(): void {
  discovered = undefined;
  retryNotBefore = undefined;
}

/**
 * When the access token in a token response expires, as a Unix timestamp in seconds.
 *
 * **A token response carries `expires_in` (seconds from now), not `expires_at`.** Reading a
 * non-existent `expires_at` type-checks against `TokenEndpointResponse`'s index signature and is
 * `undefined` at runtime, so every session silently took the fallback below and believed its token
 * lasted an hour whatever IDAM actually said. Too long and the refresh never fires before the token
 * expires — the user gets a 401 mid-session; too short and every request refreshes.
 *
 * `expiresIn()` is `openid-client`'s helper over `expires_in`, and returns `undefined` when the
 * server omitted it. The one-hour fallback is only for that case: OIDC does not require `expires_in`,
 * so an issuer may leave the lifetime to be discovered by a 401.
 */
export function expiresAtFrom(tokens: client.TokenEndpointResponseHelpers): number {
  return Math.floor(Date.now() / 1000) + (tokens.expiresIn() ?? 3600);
}

export async function idamConfiguration(config: IdamConfig): Promise<client.Configuration> {
  if (!discovered) {
    if (retryNotBefore !== undefined && Date.now() < retryNotBefore) {
      throw new Error("IDAM discovery failed recently; a new attempt is held off until the cooldown ends");
    }
    retryNotBefore = undefined;
    const attempt = client.discovery(new URL(config.issuerUrl), config.clientId, config.clientSecret, undefined, {
      // `openid-client` refuses a cleartext issuer by default, and is right to: the code exchange
      // sends the client secret over the same connection the tokens come back on. That default is why
      // `/login` 500s against the local simulator until this is granted. The allowlist behind
      // `plainHttpPermitted` lives in the domain library rather than here because the same decision used
      // to be read the opposite way — reject rather than permit — by the deleted `apps/api`.
      ...(plainHttpPermitted() ? { execute: [client.allowInsecureRequests] } : {}) // NOSONAR typescript:S1874 - development/test HTTP simulator; Steve accepted 2026-10-26
    });
    discovered = attempt;
    // Registered before any caller awaits, so the entry is released before a caller sees the rejection.
    attempt.catch(() => {
      if (discovered !== attempt) return;
      discovered = undefined;
      retryNotBefore = Date.now() + DISCOVERY_RETRY_COOLDOWN_MS;
    });
  }
  return discovered;
}

/**
 * Begin the flow: build the URL to send the browser to, and the state to remember.
 *
 * Returns both rather than writing to the session itself, so this stays testable without an Express
 * session and the caller keeps one obvious place where session state is written.
 */
export async function beginLogin(config: IdamConfig, returnTo: string): Promise<{ authorizationUrl: string; flow: AuthFlowState }> {
  const configuration = await idamConfiguration(config);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();

  const authorizationUrl = client.buildAuthorizationUrl(configuration, {
    redirect_uri: config.redirectUri,
    scope: config.scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state
  });

  return { authorizationUrl: authorizationUrl.href, flow: { codeVerifier, state, returnTo } };
}

export interface IdamTokens {
  idToken?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export type RefreshResult = { ok: true; tokens: IdamTokens } | { ok: false; reason: "invalid_grant" | "subject_mismatch" };

export interface LoginResult {
  user: ReturnType<typeof userFromClaims>;
  /**
   * The subject IDAM authenticated, from the ID token.
   *
   * Stored in the session so a later refresh can check the identity has not changed under it — see
   * `refreshTokens`. Not part of `CurrentUser`, which is deliberately only what authorization
   * decisions are made from.
   */
  subject: string;
  tokens: IdamTokens;
}

/**
 * Complete the flow: exchange the code for tokens, then read the user from the **userinfo** endpoint.
 *
 * The `state` check is `openid-client`'s, given the value from the session — so a callback carrying a
 * code obtained in someone else's browser is refused rather than logged in. Without it the callback
 * is an open redirect into an authenticated session.
 *
 * **The name comes from userinfo, not from the ID token**, because CFT IDAM's ID token is thin. Checked against
 * `hmcts/rse-idam-simulator`, the HMCTS-standard local IDAM — its `JwTokenGeneratorService` puts only
 * `sub`, `aud`, `scope`, `realm`, `auth_level` and similar into the token, while `IdamUserInfo` (the
 * `/o/userinfo` response) is what carries `name`, `given_name` and `family_name`. Access comes from neither:
 * see `loginFrom`.
 *
 * The ID token is still validated by `authorizationCodeGrant` — signature, issuer, audience, expiry —
 * and its `sub` is what `fetchUserInfo` checks the userinfo response against, so a userinfo response
 * describing a different subject is refused.
 *
 * **Returns refresh token if IDAM issues one.** Whether one is issued depends on the requested scope
 * (`offline_access`) and IDAM's configuration. The absence of a refresh token is not an error — it just
 * means the session cannot be extended and the user will re-authenticate when it expires.
 */
export async function completeLogin(config: IdamConfig, flow: AuthFlowState, currentUrl: URL): Promise<LoginResult> {
  const configuration = await idamConfiguration(config);

  const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state
  });

  return loginFrom(configuration, tokens);
}

/**
 * A token response turned into a session identity, shared by every grant this app performs.
 *
 * One function rather than a copy per grant because the two things it does are the security properties the
 * grants have in common, and a divergence in either is silent: the `sub` check refuses a token response with
 * no verifiable ID token (adopting one would log someone in as nobody), and the roles come from **userinfo**
 * rather than from the thin CFT ID token, which `fetchUserInfo` checks against that same `sub`. The
 * password grant in `./password-grant.ts` had its own copy of both, so a fix to one would have reached only
 * the flow whose bug was noticed.
 *
 * **What the user may do is api's `GET /me` answer, asked with the new access token.** A failed `/me` still
 * signs the user in, with no access at all: refusing the login is OWASP plan 01 Task 6's decision, not this
 * one's. The next successful refresh replaces it.
 */
export async function loginFrom(
  configuration: client.Configuration,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
): Promise<LoginResult> {
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("IDAM returned no ID token subject");

  const info = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);
  const access = await fetchCallerAccess(tokens.access_token, "sign-in");

  return {
    user: userFromClaims(info as IdamClaims, access),
    subject: claims.sub,
    tokens: {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiresAtFrom(tokens)
    }
  };
}

/**
 * The URL of the request as IDAM saw it, which the code exchange validates against.
 *
 * Built from the configured `redirectUri` rather than from the request's own host header, because the
 * host header is attacker-controlled and `redirectUri` is the value registered with IDAM. In AKS the
 * pod's idea of its own hostname is not the public one either, so trusting the request would break
 * behind the ingress even without an attacker.
 */
export function callbackUrl(config: IdamConfig, req: Request): URL {
  const url = new URL(config.redirectUri);
  url.search = new URL(req.originalUrl, config.redirectUri).search;
  return url;
}

/**
 * Exchange a refresh token for a fresh access token, without re-authenticating the user.
 *
 * Refuses when the refresh must not be honoured — the token was revoked or expired (`invalid_grant`), or the
 * response describes a different subject (`subject_mismatch`). Both mean the same thing to the caller: sign out
 * and make the user log in again. They are told apart only so a substituted identity can be alerted on, which a
 * revoked token is not worth. Throws only on faults that might be transient (network, IDAM down), so the caller
 * can distinguish "this session is over" from "try again".
 *
 * **Returns tokens only, and does not read `/o/userinfo`.** It used to build a `CurrentUser` from
 * userinfo, and the only caller discarded it — a wasted round trip per refresh. Access is
 * re-read by the refresh middleware, which asks api's `GET /me` with the new token.
 *
 * **An absent `id_token` is not an error.** OpenID Connect Core §12.2 states the refresh response is a
 * normal token response *"except that it might not contain an `id_token`"*, and its own example omits
 * one. `openid-client` agrees — it resolves with `claims()` returning `undefined` rather than throwing.
 * This function previously threw on a missing subject, which meant that against any compliant issuer
 * that omits the ID token, **every refresh failed and `refreshMiddleware` swallowed it as transient**,
 * so sessions expired exactly as though refresh had never been built. Nothing would have reported it.
 *
 * **What is checked instead is that the subject has not changed.** §12.2 requires that an ID token
 * returned here carry the same `sub` as the one issued at authentication, and **`openid-client` does
 * not enforce it** — its required-claims list is presence-only and it holds no expected subject for a
 * token response. So the comparison is made here, against the subject recorded in the session at login.
 * Skipping it would let a refresh silently swap the identity behind a live session. The check is only
 * possible when an ID token arrives; when none does there is nothing to compare, which is the case the
 * spec permits.
 *
 * **IDAM may rotate the refresh token.** When the response carries a new one it replaces the old, which
 * is now spent; when it does not, the original stays valid and is carried forward.
 */
export async function refreshTokens(config: IdamConfig, refreshToken: string, expectedSubject: string): Promise<RefreshResult> {
  const configuration = await idamConfiguration(config);

  // The helpers half of the type matters: `claims()` and `expiresIn()` live there, and annotating this
  // as a bare `TokenEndpointResponse` strips both.
  let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
  try {
    tokens = await client.refreshTokenGrant(configuration, refreshToken);
  } catch (error) {
    // Refresh token is invalid/revoked/expired — this is a normal flow, not an error to log.
    // The caller should sign out and force re-authentication.
    if (error instanceof client.ResponseBodyError && error.error === "invalid_grant") {
      return { ok: false, reason: "invalid_grant" };
    }
    // Some other error (network, IDAM down, unexpected response) — let it bubble up so the caller
    // can decide whether to retry or give up.
    throw error;
  }

  const subject = tokens.claims()?.sub;
  if (subject !== undefined && subject !== expectedSubject) {
    // Refusing rather than throwing: this is not a fault to retry, it is a session to end.
    console.error("IDAM refresh returned a different subject than the session was established with");
    return { ok: false, reason: "subject_mismatch" };
  }

  return {
    ok: true,
    tokens: {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresAt: expiresAtFrom(tokens)
    }
  };
}

/**
 * IDAM's end-session URL, or undefined when the issuer does not advertise one.
 *
 * Undefined is a normal answer, not a failure: `end_session_endpoint` is optional in OIDC discovery.
 * Returning undefined lets the caller finish a local sign-out and say so, rather than inventing a path
 * and sending the user somewhere that 404s.
 */
export async function endSessionUrl(config: IdamConfig, idToken: string | undefined, postLogoutPath = "/"): Promise<string | undefined> {
  const configuration = await idamConfiguration(config);
  const metadata = configuration.serverMetadata();
  if (!metadata.end_session_endpoint) return undefined;

  const url = new URL(metadata.end_session_endpoint);
  // The id token proves which session to end. Without it IDAM may prompt the user to confirm, which
  // is a worse logout than no redirect at all.
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  // IDAM refuses a return address not registered for the client, so a new one waits on idam-access-config.
  url.searchParams.set("post_logout_redirect_uri", new URL(postLogoutPath, config.redirectUri).href);
  return url.href;
}

/**
 * The parts of an IDAM failure worth a log line: what kind of failure, IDAM's own error code and description,
 * and the HTTP status.
 *
 * Not the error object itself. openid-client's errors carry the HTTP response and its parsed body as `response`
 * and `cause`, and console output is auto-collected into Application Insights, so logging the object ships
 * whatever IDAM sent back. `message` is kept because it is what tells a missing `id_token` from an outage.
 */
export function describeIdamError(error: unknown): IdamErrorSummary | string {
  if (!(error instanceof Error)) return String(error);

  const fields = error as Error & { code?: unknown; error?: unknown; error_description?: unknown; status?: unknown };
  const summary: IdamErrorSummary = { name: error.name, message: error.message };
  if (typeof fields.code === "string") summary.code = fields.code;
  if (typeof fields.error === "string") summary.error = fields.error;
  if (typeof fields.error_description === "string") summary.error_description = fields.error_description;
  if (typeof fields.status === "number") summary.status = fields.status;
  return summary;
}

export interface IdamErrorSummary {
  name: string;
  message: string;
  code?: string;
  error?: string;
  error_description?: string;
  status?: number;
}
