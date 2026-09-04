/**
 * Validating an IDAM access token, so `apps/api` can identify a caller without a browser session.
 *
 * This is the resource-server half of Phase 5. `apps/web` runs the authorization-code flow and holds a
 * session; the API has no session and no login page, so it takes a bearer token and checks it. The
 * token it checks is the same `access_token` that flow already receives.
 *
 * **`jose` rather than `openid-client`.** `openid-client` models a *client* — it wants a client id and
 * secret and drives redirects and code exchanges, none of which a resource server does. Validating a
 * signature against a rotating JWKS is `jose`'s job, and `createRemoteJWKSet` is the part worth not
 * hand-rolling: it caches keys, refetches on an unknown `kid`, and rate-limits that refetch so an
 * attacker cannot turn a stream of bogus `kid`s into a denial of service against IDAM.
 *
 * **Endpoints are discovered, not configured**, for the same reason as in `apps/web/src/auth/idam.ts`:
 * this was written without access to a real CFT IDAM, so any hardcoded path would have been a guess.
 * Discovery is a plain `fetch` of the issuer's `/.well-known/openid-configuration` here — ten lines,
 * against pulling in a client library for two URLs out of it.
 *
 * **Roles come from `/o/userinfo`, not from the token.** An IDAM access token carries `sub`, `aud`,
 * `scope`, `tokenName` and similar, and no roles at all — checked against `hmcts/rse-idam-simulator`'s
 * `JwTokenGeneratorService`, whose `IdamUserInfo` is what holds `roles`. `apps/web` learned this the
 * expensive way: it read roles from the ID token, passed against a stub that put them there, and would
 * have found every caseworker role-less against real IDAM. Same conclusion, so the same source.
 */
import { type IdamClaims, plainHttpPermitted, UnauthorizedError, userFromClaims } from "@hmcts/deed-poll";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

/**
 * IDAM issues one estate-wide set of keys, so a signature alone only proves "some IDAM token". The
 * `aud` claim names the client the token was minted for, and checking it is what stops a token issued
 * to an unrelated CFT service being replayed here.
 *
 * `audiences` is therefore required, and empty means every request is refused rather than every token
 * accepted. Same polarity as `plainHttpPermitted` and for the same reason: an unset config value must
 * not be the permissive case.
 */
export interface IdamApiConfig {
  issuerUrl: string;
  audiences: string[];
}

/**
 * IDAM signs with RS256 (`JwTokenGeneratorService` builds an `RS256` header over an `RSAKey`).
 *
 * Pinned rather than left to the token, because `alg` is a field the *sender* controls. `jose` already
 * refuses `none` and would fail an HMAC token against an RSA JWKS key, so this is belt as well as
 * braces — but the failure it guards against is total, and one line is a cheap brace.
 */
const SIGNING_ALGORITHMS = ["RS256"];

/**
 * Forgerock labels its tokens, and an ID token is not a credential for calling an API: it is issued to
 * the client, describes the user to that client, and carries the same `aud` as the access token — so
 * the audience check cannot separate the two. Checked only when present, since nothing in OIDC
 * requires the claim and an issuer without it should still work.
 */
const ACCESS_TOKEN_NAME = "access_token";

interface IdamMetadata {
  issuer: string;
  jwks_uri: string;
  userinfo_endpoint: string;
}

/**
 * Discovery and the key set, cached for the process's lifetime.
 *
 * Cached because discovery would otherwise be a network round trip on every API request, putting
 * IDAM's availability in front of every call rather than just the token check. Not cached across
 * restarts, so a pod picks up endpoint changes when it cycles. Key *rotation* is handled inside
 * `createRemoteJWKSet`, which is a different lifetime from this and correctly shorter.
 */
let cached: Promise<{ metadata: IdamMetadata; jwks: ReturnType<typeof createRemoteJWKSet> }> | undefined;

export function resetIdamDiscovery(): void {
  cached = undefined;
}

/**
 * Resolve the caller from a bearer token: validate it, then read who they are from userinfo.
 *
 * Throws `UnauthorizedError` for anything the caller could fix by presenting a different token, and a
 * plain `Error` for anything they could not — a missing audience configuration, or IDAM being
 * unreachable. That split is deliberate: answering 401 when the fault is ours sends the caller off to
 * re-authenticate against a service that will refuse them just as firmly the second time, and hides an
 * outage behind a status code that reads as "client error".
 */
export async function userFromBearerToken(config: IdamApiConfig, token: string) {
  const { metadata, jwks } = await idamMetadata(config);

  const payload = await verify(config, metadata, jwks, token);
  const claims = await fetchUserInfo(metadata, token, payload);

  return userFromClaims(claims);
}

/**
 * Read the config block into the shape above.
 *
 * `audiences` is a comma-separated string in config rather than a JSON array because it arrives from
 * `IDAM_API_AUDIENCES` in a Helm `env:` map, where a list would have to be JSON-encoded into a string
 * and then be one missing bracket away from silently parsing as no audiences at all.
 */
export function idamApiConfig(raw: { issuerUrl: string; audiences: string }): IdamApiConfig {
  return {
    issuerUrl: raw.issuerUrl,
    audiences: raw.audiences
      .split(",")
      .map((audience) => audience.trim())
      .filter((audience) => audience.length > 0)
  };
}

/** Pull the token out of `Authorization: Bearer <token>`, or undefined if it is not there. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer (.+)$/i.exec((header ?? "").trim());
  return match?.[1].trim() || undefined;
}

async function idamMetadata(config: IdamApiConfig) {
  if (!cached) {
    cached = discover(config).catch((error) => {
      // Otherwise one failed discovery — IDAM restarting, a DNS blip — is cached as a rejected
      // promise and every subsequent request fails against it until the pod cycles.
      cached = undefined;
      throw error;
    });
  }
  return cached;
}

async function discover(config: IdamApiConfig) {
  requireHttps(config.issuerUrl);

  const issuer = config.issuerUrl.replace(/\/$/, "");
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`IDAM discovery failed: ${response.status} from ${issuer}`);
  }

  const metadata = (await response.json()) as Partial<IdamMetadata>;
  if (!metadata.jwks_uri || !metadata.userinfo_endpoint || !metadata.issuer) {
    throw new Error(`IDAM discovery at ${issuer} is missing issuer, jwks_uri or userinfo_endpoint`);
  }

  // OIDC Discovery 1.0 §4.3 requires these to match. They will not if the issuer is behind a proxy
  // that rewrites its base URL, and in that case every token's `iss` would also disagree with the
  // configured value — so failing here, with both values named, beats failing later per request.
  if (metadata.issuer.replace(/\/$/, "") !== issuer) {
    throw new Error(`IDAM discovery at ${issuer} advertises a different issuer, ${metadata.issuer}`);
  }

  return {
    metadata: metadata as IdamMetadata,
    jwks: createRemoteJWKSet(new URL(metadata.jwks_uri))
  };
}

/**
 * Refuse a cleartext issuer outside development and test.
 *
 * `openid-client` refuses one by default and `apps/web` has to opt in; `fetch` has no such scruple, so
 * the API has to say no itself or it would silently take its keys, and the roles it authorises
 * against, over a connection anything on the path can rewrite.
 */
function requireHttps(issuerUrl: string): void {
  const { protocol } = new URL(issuerUrl);
  if (protocol === "https:" || plainHttpPermitted()) return;

  throw new Error(`Refusing to use a cleartext IDAM issuer (${issuerUrl}) under NODE_ENV ${JSON.stringify(process.env.NODE_ENV)}`);
}

async function verify(config: IdamApiConfig, metadata: IdamMetadata, jwks: ReturnType<typeof createRemoteJWKSet>, token: string): Promise<JWTPayload> {
  if (config.audiences.length === 0) {
    throw new Error("No IDAM audiences are configured (IDAM_API_AUDIENCES), so no access token can be accepted");
  }

  let payload: JWTPayload;
  try {
    // `jwtVerify` checks the signature, `iss`, `aud`, `exp` and `nbf` together. Doing them separately
    // is how a check gets forgotten, which is why none of them are done by hand below.
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: metadata.issuer,
      audience: config.audiences,
      algorithms: SIGNING_ALGORITHMS
    }));
  } catch (error) {
    // The reason is useful to us and useful to an attacker probing which check failed, so it is logged
    // and not returned.
    console.warn("Rejected an IDAM access token:", error instanceof Error ? error.message : error);
    throw new UnauthorizedError("Invalid access token");
  }

  const tokenName = payload.tokenName;
  if (typeof tokenName === "string" && tokenName !== ACCESS_TOKEN_NAME) {
    throw new UnauthorizedError(`Expected an access token, not a ${tokenName}`);
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new UnauthorizedError("Access token has no subject");
  }

  return payload;
}

/**
 * Ask IDAM who the token belongs to.
 *
 * Not cached, deliberately. A cache here is a cache of authorisation data: a caseworker whose admin
 * role is removed would keep it for the cache's lifetime, and the operations it gates are the ones
 * worth removing it for. Nothing about this service's traffic — a back-office API — makes one extra
 * round trip per request worth that.
 *
 * The subject is checked against the token's, which is what `openid-client`'s `fetchUserInfo` does for
 * `apps/web`. Without it a response for the wrong user is accepted as this one's identity.
 */
async function fetchUserInfo(metadata: IdamMetadata, token: string, payload: JWTPayload): Promise<IdamClaims> {
  const response = await fetch(metadata.userinfo_endpoint, {
    headers: { authorization: `Bearer ${token}` }
  });

  // A token that verified but that IDAM will not resolve has been revoked, or belongs to a user who no
  // longer exists. Caller-fixable, so 401 — anything else is IDAM's problem, not theirs.
  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedError("IDAM rejected the access token");
  }
  if (!response.ok) {
    throw new Error(`IDAM userinfo failed: ${response.status}`);
  }

  const claims = (await response.json()) as IdamClaims;
  if (claims.sub !== payload.sub) {
    throw new UnauthorizedError("IDAM userinfo describes a different subject to the access token");
  }

  return claims;
}
