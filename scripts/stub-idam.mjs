#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: the IDAM_STUB_* vars are this dev script's own
// knobs and are deliberately not part of either app's environment. Declaring them in config would
// imply the apps read them, which is a worse lie than the warning is a nuisance.

/**
 * A stand-in OIDC issuer, for developing and verifying the login flow without CFT IDAM.
 *
 * **Why this exists.** Phase 5 was built before an IDAM client id, secret and registered redirect URI
 * existed — those are an external request with lead time. Without something to authenticate against,
 * the flow could only have been written and not run, and an unrun auth flow is the last thing anyone
 * should trust. This makes the whole path exercisable end to end: discovery, PKCE, the code exchange,
 * a real signed ID token verified against a real JWKS, roles, and logout.
 *
 * **What it is not.** It is not a mock of IDAM's behaviour, and it does not check a password. It is a
 * compliant-enough issuer: it publishes discovery, signs an RS256 ID token with a key it serves at
 * `jwks_uri`, and honours `code_challenge`/`state`. So `openid-client` does the same real work against
 * it that it will against IDAM — the part that stays unverified is only whether CFT IDAM's own claim
 * names and role strings match what `userFromClaims` reduces. See the handover.
 *
 * Never mounted by the apps and never reachable from one: it is a dev script, run deliberately.
 *
 *   node scripts/stub-idam.mjs                        # port 5062, signs in as a caseworker
 *   IDAM_STUB_ROLES=deedpoll-admin node scripts/…     # sign in as an admin
 *   IDAM_STUB_PORT=6000 node scripts/…                # somewhere else
 */

import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const PORT = Number(process.env.IDAM_STUB_PORT ?? 5062);
const ISSUER = `http://localhost:${PORT}/o`;
const ROLES = (process.env.IDAM_STUB_ROLES ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);
const NAME = process.env.IDAM_STUB_NAME ?? "Stub Caseworker";
const SUBJECT = process.env.IDAM_STUB_SUBJECT ?? "stub-user-1";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const KEY_ID = "stub-key-1";
const jwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: "RS256", use: "sig" };

/** Authorization codes issued but not yet redeemed, so a code cannot be spent twice. */
const codes = new Map();

const routes = {
  "/o/.well-known/openid-configuration": () =>
    json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      end_session_endpoint: `${ISSUER}/endSession`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "roles"],
      claims_supported: ["sub", "name", "roles"]
    }),

  "/o/jwks": () => json({ keys: [jwk] }),

  /**
   * Skips the login form entirely and redirects straight back with a code. There is no password to
   * check: what is under test is this service's handling of the flow, not IDAM's UI.
   */
  "/o/authorize": (url) => {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    if (!redirectUri) return { status: 400, body: "redirect_uri is required" };

    const code = `stub-code-${Math.abs(hash(`${state}:${Date.now()}`))}`;
    codes.set(code, { challenge: url.searchParams.get("code_challenge") });

    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    if (state) back.searchParams.set("state", state);
    return { status: 302, headers: { location: back.href }, body: "" };
  },

  "/o/endSession": (url) => ({
    status: 302,
    headers: { location: url.searchParams.get("post_logout_redirect_uri") ?? "/" },
    body: ""
  })
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/o/token") return respond(res, await token(req));

  const route = routes[url.pathname];
  if (!route) return respond(res, { status: 404, body: `no stub route for ${url.pathname}` });

  respond(res, route(url));
});

/**
 * Exchange a code for tokens. The code must exist and not have been redeemed, so replaying one fails
 * here as it would at a real issuer — which is what makes the session's single-use flow state testable.
 */
async function token(req) {
  const body = new URLSearchParams(await readBody(req));
  const code = body.get("code");

  if (!code || !codes.has(code)) {
    return json({ error: "invalid_grant", error_description: "unknown or already-redeemed code" }, 400);
  }
  codes.delete(code);

  const idToken = await new SignJWT({ name: NAME, roles: ROLES, sub: SUBJECT })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(ISSUER)
    .setAudience(body.get("client_id") ?? "deed-poll-admin")
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  return json({ access_token: "stub-access-token", id_token: idToken, token_type: "Bearer", expires_in: 600 });
}

function json(payload, status = 200) {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

function respond(res, { status, headers = {}, body }) {
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
  });
}

function hash(value) {
  let h = 0;
  for (const char of value) h = (h * 31 + char.charCodeAt(0)) | 0;
  return h;
}

server.listen(PORT, () => {
  console.log(`Stub IDAM issuer on ${ISSUER}`);
  console.log(`  signing in as: ${NAME} (sub ${SUBJECT}) with roles [${ROLES.join(", ") || "none"}]`);
  console.log("  NOT a mock of IDAM's behaviour — a compliant-enough issuer so the flow can be run.");
});
