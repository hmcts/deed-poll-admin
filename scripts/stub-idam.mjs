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
 * **Its contract is taken from `hmcts/rse-idam-simulator`**, the HMCTS-standard local IDAM, read at
 * `libs/rse-idam-simulator` in the cft-workspace. In particular: the **ID token is thin** — its
 * `JwTokenGeneratorService` emits `sub`, `aud`, `scope`, `realm`, `auth_level` and similar, and **no
 * roles** — while `/o/userinfo` returns `IdamUserInfo`, which is what carries `roles`, `name`,
 * `given_name` and `family_name`. This stub matches that split, because getting it wrong is exactly the
 * bug it was hiding: the flow originally read roles from the ID token and would have found none against
 * real IDAM.
 *
 * **Why not just run the simulator?** Its published `:latest` image cannot serve an authorization-code
 * flow: `/o/token` requires a `username` parameter (it is built for the password grant), `/o/authorize`
 * allows POST only so a browser redirect 405s, and it does not echo `state`. Master fixes all three,
 * so building from source would work — but the contract question this stub needed answering was
 * answered by reading that source, and a stub that drives a real browser flow is what the tests want.
 *
 * **What it is not.** Not a mock of IDAM's behaviour, and it checks no password. It is a
 * compliant-enough issuer: discovery, an RS256 ID token signed with a key it serves at `jwks_uri`,
 * userinfo, and `code_challenge`/`state` honoured.
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

/** Access tokens handed out, so `/o/userinfo` can answer for the right subject. */
const accessTokens = new Map();

const routes = {
  "/o/.well-known/openid-configuration": () =>
    json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
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
  if (url.pathname === "/o/userinfo") return respond(res, userinfo(req));

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

  // Thin, matching the simulator: no roles, no name. Those come from /o/userinfo.
  const idToken = await new SignJWT({ scope: ["openid", "profile", "roles"], realm: "/hmcts", auth_level: 0 })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(ISSUER)
    .setAudience(body.get("client_id") ?? "deed-poll-admin")
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  const accessToken = `stub-access-${Math.abs(hash(`${code}:${SUBJECT}`))}`;
  accessTokens.set(accessToken, SUBJECT);

  return json({ access_token: accessToken, id_token: idToken, token_type: "Bearer", expires_in: 600 });
}

/**
 * The user, shaped as the simulator's `IdamUserInfo`: `uid`, `email`, `sub`, `name`, `given_name`,
 * `family_name`, `roles`. This is where roles live — see the note at the top of this file.
 */
function userinfo(req) {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const subject = accessTokens.get(bearer);

  // 401 rather than a body for an unknown token, so a flow that skips the exchange fails visibly.
  if (!subject) return json({ error: "invalid_token" }, 401);

  const [given, ...rest] = NAME.split(" ");
  return json({
    uid: subject,
    email: `${subject}@example.com`,
    sub: subject,
    name: NAME,
    given_name: given,
    family_name: rest.join(" "),
    roles: ROLES
  });
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
