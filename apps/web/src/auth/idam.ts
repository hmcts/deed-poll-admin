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
 */
let discovered: Promise<client.Configuration> | undefined;

export function resetIdamDiscovery(): void {
  discovered = undefined;
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
    discovered = client.discovery(new URL(config.issuerUrl), config.clientId, config.clientSecret, undefined, {
      // `openid-client` refuses a cleartext issuer by default, and is right to: the code exchange
      // sends the client secret over the same connection the tokens come back on. That default is why
      // `/login` 500s against the local simulator until this is granted. The allowlist behind
      // `plainHttpPermitted` is shared with `apps/api`, which has to make the opposite call — reject
      // rather than permit — from the same decision.
      ...(plainHttpPermitted() ? { execute: [client.allowInsecureRequests] } : {})
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

export interface LoginResult {
  user: ReturnType<typeof userFromClaims>;
  tokens: {
    idToken?: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  };
}

/**
 * Complete the flow: exchange the code for tokens, then read the user from the **userinfo** endpoint.
 *
 * The `state` check is `openid-client`'s, given the value from the session — so a callback carrying a
 * code obtained in someone else's browser is refused rather than logged in. Without it the callback
 * is an open redirect into an authenticated session.
 *
 * **Roles and name come from userinfo, not from the ID token.** This originally read them from the ID
 * token's claims, which was wrong: CFT IDAM's ID token is thin. Checked against
 * `hmcts/rse-idam-simulator`, the HMCTS-standard local IDAM — its `JwTokenGeneratorService` puts only
 * `sub`, `aud`, `scope`, `realm`, `auth_level` and similar into the token, while `IdamUserInfo` (the
 * `/o/userinfo` response) is what carries `roles`, `name`, `given_name` and `family_name`. Reading the
 * token would have yielded no roles at all against real IDAM — and because unknown roles are dropped
 * rather than rejected, the symptom would have been "nobody can edit privacy" rather than an error.
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

  const claims = tokens.claims();
  if (!claims?.sub) {
    // A token response with no verifiable ID token is not an identity, and treating it as one would
    // log someone in as nobody.
    throw new Error("IDAM returned no ID token subject");
  }

  const info = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);

  return {
    user: userFromClaims(info as IdamClaims),
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
 * Use a refresh token to obtain new access and ID tokens without re-authentication.
 *
 * Returns undefined if the refresh fails (token revoked, expired, or IDAM refuses it), in which case
 * the caller should sign the user out and force re-authentication. Throws on network errors or
 * unexpected responses that might be transient.
 *
 * **IDAM may return a new refresh token** in the response — if it does, the caller must use that for
 * future refreshes and discard the old one (refresh token rotation). If no new refresh token is
 * returned, keep using the original.
 */
export async function refreshTokens(config: IdamConfig, refreshToken: string): Promise<LoginResult | undefined> {
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
      return undefined;
    }
    // Some other error (network, IDAM down, unexpected response) — let it bubble up so the caller
    // can decide whether to retry or give up.
    throw error;
  }

  const claims = tokens.claims();
  if (!claims?.sub) {
    throw new Error("IDAM refresh response contained no ID token subject");
  }

  const info = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);

  return {
    user: userFromClaims(info as IdamClaims),
    tokens: {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      // If IDAM rotated the refresh token, use the new one; otherwise keep the old one
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
export async function endSessionUrl(config: IdamConfig, idToken: string | undefined): Promise<string | undefined> {
  const configuration = await idamConfiguration(config);
  const metadata = configuration.serverMetadata();
  if (!metadata.end_session_endpoint) return undefined;

  const url = new URL(metadata.end_session_endpoint);
  // The id token proves which session to end. Without it IDAM may prompt the user to confirm, which
  // is a worse logout than no redirect at all.
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", new URL("/", config.redirectUri).href);
  return url.href;
}
