/**
 * The OIDC client's two halves, plus the discovery and logout details around them.
 *
 * **`openid-client` runs for real here**, against a discovery document served over HTTP by this file.
 * That is the point of most of these tests: `beginLogin`'s authorization URL, its S256 challenge and
 * its `state` are built by the library, and a test that mocked the library would only pin that the mock
 * was called. Only `authorizationCodeGrant` and `fetchUserInfo` are stubbed, because those two talk to
 * a token endpoint that would have to sign real tokens to answer.
 *
 * What is being tested in `completeLogin` is therefore the glue, and the glue is where the bug was:
 * roles were read from the ID token, which is thin, instead of from `/o/userinfo`. That reading is
 * asserted directly below, because it passed for a week against a stub that put them in the token.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DEEDPOLL_ADMIN } from "@hmcts/deed-poll";
import type { Request } from "express";
import * as client from "openid-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { beginLogin, callbackUrl, completeLogin, describeIdamError, endSessionUrl, type IdamConfig, refreshTokens, resetIdamDiscovery } from "./idam.js";

vi.mock("openid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openid-client")>()),
  authorizationCodeGrant: vi.fn(),
  refreshTokenGrant: vi.fn(),
  fetchUserInfo: vi.fn()
}));

let server: Server;
let base: string;
let config: IdamConfig;
/** Omitted from discovery in the tests that need an issuer without one. */
let endSessionEndpoint: string | undefined;
let discoveryCalls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/o/.well-known/openid-configuration") {
      discoveryCalls += 1;
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          issuer: `${base}/o`,
          authorization_endpoint: `${base}/o/authorize`,
          token_endpoint: `${base}/o/token`,
          userinfo_endpoint: `${base}/o/userinfo`,
          jwks_uri: `${base}/o/jwks`,
          ...(endSessionEndpoint ? { end_session_endpoint: endSessionEndpoint } : {}),
          response_types_supported: ["code"]
        })
      );
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config = {
    issuerUrl: `${base}/o`,
    clientId: "deed-poll-admin",
    clientSecret: "a-secret",
    redirectUri: "http://localhost:3000/oauth2/callback",
    scope: "openid profile roles"
  };
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetIdamDiscovery();
  discoveryCalls = 0;
  endSessionEndpoint = `${base}/o/endSession`;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("beginLogin", () => {
  it("sends the browser to the issuer's advertised authorization endpoint", async () => {
    // Discovered, not configured. This was written without a real IDAM, so a hardcoded path would have
    // been a guess.
    const { authorizationUrl } = await beginLogin(config, "/deed-polls");

    expect(new URL(authorizationUrl).origin + new URL(authorizationUrl).pathname).toBe(`${base}/o/authorize`);
  });

  it("asks for a code, with the configured client, redirect and scope", async () => {
    const { authorizationUrl } = await beginLogin(config, "/deed-polls");
    const params = new URL(authorizationUrl).searchParams;

    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("deed-poll-admin");
    expect(params.get("redirect_uri")).toBe("http://localhost:3000/oauth2/callback");
    expect(params.get("scope")).toBe("openid profile roles");
  });

  it("sends an S256 PKCE challenge and keeps the verifier out of the URL", async () => {
    // If the verifier ever reached the query string, PKCE would protect nothing — anyone who saw the
    // redirect would hold both halves.
    const { authorizationUrl, flow } = await beginLogin(config, "/deed-polls");
    const params = new URL(authorizationUrl).searchParams;

    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("code_challenge")).not.toBe(flow.codeVerifier);
    expect(authorizationUrl).not.toContain(flow.codeVerifier);
  });

  it("computes the challenge as the SHA-256 of the verifier, so the issuer's check can pass", async () => {
    const { authorizationUrl, flow } = await beginLogin(config, "/deed-polls");

    expect(new URL(authorizationUrl).searchParams.get("code_challenge")).toBe(await client.calculatePKCECodeChallenge(flow.codeVerifier));
  });

  it("sends a state and returns the same value for the callback to check", async () => {
    const { authorizationUrl, flow } = await beginLogin(config, "/deed-polls");

    expect(new URL(authorizationUrl).searchParams.get("state")).toBe(flow.state);
    expect(flow.state.length).toBeGreaterThan(20);
  });

  it("uses a fresh verifier and state per login, so one cannot be replayed against another", async () => {
    const first = await beginLogin(config, "/deed-polls");
    const second = await beginLogin(config, "/deed-polls");

    expect(first.flow.codeVerifier).not.toBe(second.flow.codeVerifier);
    expect(first.flow.state).not.toBe(second.flow.state);
  });

  it("carries the destination through the flow rather than the URL", async () => {
    // It goes in the session, so IDAM never sees where the user was heading and cannot influence it.
    const { authorizationUrl, flow } = await beginLogin(config, "/deed-polls/case-1");

    expect(flow.returnTo).toBe("/deed-polls/case-1");
    expect(authorizationUrl).not.toContain("case-1");
  });

  it("discovers once per process, so IDAM is not in the path of every login twice over", async () => {
    await beginLogin(config, "/deed-polls");
    await beginLogin(config, "/deed-polls");

    expect(discoveryCalls).toBe(1);
  });

  it("refuses a cleartext issuer outside development and test", async () => {
    // `openid-client` refuses by default and is right to: the code exchange sends the client secret.
    // The grant is an allowlist, so an environment that is merely not "production" does not get it.
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "aat";
    resetIdamDiscovery();

    try {
      // The specific reason, not just any rejection: this issuer is also unreachable in some of the
      // other tests, and "it threw" would pass whether or not the allowlist was consulted at all.
      await expect(beginLogin(config, "/deed-polls")).rejects.toThrow(/only requests to HTTPS are allowed/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("permits the cleartext local simulator under NODE_ENV=test, which is how the rest of this file works", async () => {
    // The other side of the same allowlist. Both directions are asserted because a check that only
    // ever refuses would pass if it refused everything.
    await expect(beginLogin(config, "/deed-polls")).resolves.toBeTruthy();
  });
});

describe("completeLogin", () => {
  const flow = { codeVerifier: "a-verifier", state: "a-state", returnTo: "/deed-polls" };
  const currentUrl = new URL("http://localhost:3000/oauth2/callback?code=abc&state=a-state");

  // `expires_in` and the `expiresIn()` helper over it are both modelled, because that pair is what the
  // library actually returns and an earlier double that omitted them let the code read a non-existent
  // `expires_at` and still pass. A double that supplies only what the code happens to reach for can
  // only confirm its author's assumptions — see the deleted hand-written IDAM stub.
  // `expiresIn` is deliberately required rather than defaulted: a default swallows an explicit
  // `undefined`, so the "issuer omitted expires_in" case would silently test the default instead.
  function tokensWith(claims: Record<string, unknown> | undefined, expiresIn: number | undefined) {
    return {
      access_token: "an-access-token",
      id_token: "an-id-token",
      expires_in: expiresIn,
      claims: () => claims,
      expiresIn: () => expiresIn
    } as never;
  }

  beforeEach(() => {
    vi.mocked(client.authorizationCodeGrant).mockResolvedValue(tokensWith({ sub: "admin@example.com" }, 900));
    vi.mocked(client.fetchUserInfo).mockResolvedValue({ sub: "admin@example.com", name: "An Admin", roles: [DEEDPOLL_ADMIN] } as never);
  });

  it("reads roles from userinfo, not from the ID token", async () => {
    // The bug this file exists for. CFT IDAM's ID token is thin — `JwTokenGeneratorService` puts no
    // roles in it at all — so reading claims would have yielded no roles against real IDAM. And because
    // unknown roles are dropped rather than rejected, the symptom would have been "nobody can edit
    // privacy" rather than an error.
    vi.mocked(client.authorizationCodeGrant).mockResolvedValue(tokensWith({ sub: "admin@example.com", roles: [DEEDPOLL_ADMIN] }, 900));
    vi.mocked(client.fetchUserInfo).mockResolvedValue({ sub: "admin@example.com", name: "An Admin", roles: [] } as never);

    const { user } = await completeLogin(config, flow, currentUrl);

    expect(user.isAdmin).toBe(false);
  });

  it("returns the user userinfo describes", async () => {
    const { user } = await completeLogin(config, flow, currentUrl);

    expect(user).toMatchObject({ isAdmin: true, name: "An Admin" });
  });

  it("passes the PKCE verifier and the expected state from the session", async () => {
    // Both come from the session, not the request, which is what makes a code obtained in someone
    // else's browser unusable here.
    await completeLogin(config, flow, currentUrl);

    expect(client.authorizationCodeGrant).toHaveBeenCalledWith(expect.anything(), currentUrl, {
      pkceCodeVerifier: "a-verifier",
      expectedState: "a-state"
    });
  });

  it("checks userinfo against the ID token's subject", async () => {
    // Otherwise a userinfo response describing someone else is accepted as this user's identity.
    await completeLogin(config, flow, currentUrl);

    expect(client.fetchUserInfo).toHaveBeenCalledWith(expect.anything(), "an-access-token", "admin@example.com");
  });

  it("returns the tokens including id token so logout can end the IDAM session too", async () => {
    const result = await completeLogin(config, flow, currentUrl);
    expect(result.tokens.idToken).toBe("an-id-token");
    expect(result.tokens.accessToken).toBeDefined();
    expect(result.tokens.expiresAt).toBeGreaterThan(0);
  });

  it("takes the expiry from the issuer's expires_in, not a fixed hour", async () => {
    // The expiry drives the refresh window, so inventing it means refreshing at the wrong time. Reading
    // a non-existent `expires_at` gave every session an hour whatever IDAM said — and if IDAM's real
    // lifetime is shorter than that, the refresh never fires and the user gets a 401 mid-session.
    vi.mocked(client.authorizationCodeGrant).mockResolvedValue(tokensWith({ sub: "admin@example.com" }, 900));

    const before = Math.floor(Date.now() / 1000);
    const { tokens } = await completeLogin(config, flow, currentUrl);

    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 900);
    expect(tokens.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 900);
  });

  it("falls back to an hour only when the issuer omits expires_in", async () => {
    // `expires_in` is optional in OIDC, so the fallback is a real case rather than dead code — but it
    // must be the exception, which is what the test above pins.
    vi.mocked(client.authorizationCodeGrant).mockResolvedValue(tokensWith({ sub: "admin@example.com" }, undefined));

    const before = Math.floor(Date.now() / 1000);
    const { tokens } = await completeLogin(config, flow, currentUrl);

    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600);
  });

  it("refuses a token response with no verifiable ID token subject", async () => {
    // Treating it as an identity would sign someone in as nobody.
    vi.mocked(client.authorizationCodeGrant).mockResolvedValue(tokensWith(undefined, 900));

    await expect(completeLogin(config, flow, currentUrl)).rejects.toThrow(/no ID token subject/);
    expect(client.fetchUserInfo).not.toHaveBeenCalled();
  });

  it("propagates a rejected exchange rather than signing anyone in", async () => {
    vi.mocked(client.authorizationCodeGrant).mockRejectedValue(new Error("unexpected state"));

    await expect(completeLogin(config, flow, currentUrl)).rejects.toThrow("unexpected state");
  });

  it("returns the authenticated subject, so a later refresh has something to be checked against", async () => {
    const { subject } = await completeLogin(config, flow, currentUrl);

    expect(subject).toBe("admin@example.com");
  });
});

/**
 * `refreshTokens` had **no tests at all** until this block, which is how it shipped requiring an
 * `id_token` that OIDC Core §12.2 explicitly makes optional. It cannot be driven end to end locally
 * either: `rse-idam-simulator` does not implement the refresh grant, so a standards-shaped refresh gets
 * a 400 from it. That makes these the only check there is on this path until real IDAM answers.
 */
describe("refreshTokens", () => {
  const SUBJECT = "admin@example.com";

  function refreshResponse(overrides: Record<string, unknown> = {}, claims?: Record<string, unknown>) {
    return {
      access_token: "a-new-access-token",
      expires_in: 900,
      expiresIn: () => 900,
      claims: () => claims,
      ...overrides
    } as never;
  }

  it("succeeds when the response carries no id token, which the spec permits", async () => {
    // OIDC Core §12.2: the refresh response is a normal token response "except that it might not
    // contain an id_token". Requiring one meant every refresh threw against a compliant issuer that
    // omits it, and `refreshMiddleware` swallowed the throw — so sessions expired as though refresh had
    // never been built, silently. This is the regression test for that.
    vi.mocked(client.refreshTokenGrant).mockResolvedValue(refreshResponse({ id_token: undefined }, undefined));

    const tokens = await refreshTokens(config, "a-refresh-token", SUBJECT);

    expect(tokens?.accessToken).toBe("a-new-access-token");
    expect(tokens?.idToken).toBeUndefined();
  });

  it("does not call userinfo, because no caller reads the result", async () => {
    // It used to, and `refreshMiddleware` discarded the user it built — a wasted round trip per refresh.
    // Re-reading roles here would be a deliberate behaviour change, not part of a refresh.
    vi.mocked(client.refreshTokenGrant).mockResolvedValue(refreshResponse());

    await refreshTokens(config, "a-refresh-token", SUBJECT);

    expect(client.fetchUserInfo).not.toHaveBeenCalled();
  });

  it("refuses a response whose id token names a different subject", async () => {
    // §12.2 requires the subject to be stable across a refresh, and `openid-client` does not enforce
    // it — its required-claims check is presence-only and it holds no expected subject for a token
    // response. Without this check a refresh could swap the identity behind a live session.
    vi.mocked(client.refreshTokenGrant).mockResolvedValue(refreshResponse({ id_token: "an-id-token" }, { sub: "someone-else@example.com" }));

    await expect(refreshTokens(config, "a-refresh-token", SUBJECT)).resolves.toBeUndefined();
  });

  it("accepts a response whose id token names the same subject", async () => {
    // The other side of the same check: one that only ever refused would pass if it refused everything.
    vi.mocked(client.refreshTokenGrant).mockResolvedValue(refreshResponse({ id_token: "an-id-token" }, { sub: SUBJECT }));

    await expect(refreshTokens(config, "a-refresh-token", SUBJECT)).resolves.toMatchObject({ idToken: "an-id-token" });
  });

  it("returns undefined on invalid_grant, so the caller signs out rather than retrying", async () => {
    vi.mocked(client.refreshTokenGrant).mockRejectedValue(
      new client.ResponseBodyError("invalid_grant", { cause: { error: "invalid_grant" }, response: new Response() })
    );

    await expect(refreshTokens(config, "a-refresh-token", SUBJECT)).resolves.toBeUndefined();
  });

  it("propagates any other failure, so an outage is not read as a revoked token", async () => {
    // A caller that treated IDAM being down as "your session ended" would sign everyone out during a
    // blip. The distinction is the whole reason this returns undefined for one case and throws for the
    // other.
    vi.mocked(client.refreshTokenGrant).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));

    await expect(refreshTokens(config, "a-refresh-token", SUBJECT)).rejects.toThrow("EAI_AGAIN");
  });

  it("takes a rotated refresh token when IDAM sends one", async () => {
    vi.mocked(client.refreshTokenGrant).mockResolvedValue(refreshResponse({ refresh_token: "a-rotated-token" }));

    const tokens = await refreshTokens(config, "the-old-token", SUBJECT);

    expect(tokens?.refreshToken).toBe("a-rotated-token");
  });

  it("keeps the existing refresh token when IDAM sends none", async () => {
    // Discarding it would make the next refresh impossible, so the session would expire early for no
    // reason the logs would explain.
    vi.mocked(client.refreshTokenGrant).mockResolvedValue(refreshResponse({ refresh_token: undefined }));

    const tokens = await refreshTokens(config, "the-old-token", SUBJECT);

    expect(tokens?.refreshToken).toBe("the-old-token");
  });

  it("takes the new expiry from the response rather than carrying the old one forward", async () => {
    const before = Math.floor(Date.now() / 1000);
    vi.mocked(client.refreshTokenGrant).mockResolvedValue(refreshResponse());

    const tokens = await refreshTokens(config, "a-refresh-token", SUBJECT);

    expect(tokens?.expiresAt).toBeGreaterThanOrEqual(before + 900);
    expect(tokens?.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 900);
  });
});

describe("callbackUrl", () => {
  it("is built from the registered redirect URI, not the request's host header", () => {
    // The host header is attacker-controlled, and behind the AKS ingress the pod's idea of its own
    // hostname is not the public one either — so trusting the request would break without an attacker.
    const url = callbackUrl(config, { originalUrl: "/oauth2/callback?code=abc&state=xyz" } as Request);

    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe("/oauth2/callback");
  });

  it("keeps the query string, which is what the exchange validates", () => {
    const url = callbackUrl(config, { originalUrl: "/oauth2/callback?code=abc&state=xyz" } as Request);

    expect(url.searchParams.get("code")).toBe("abc");
    expect(url.searchParams.get("state")).toBe("xyz");
  });

  it("survives a callback with no query string at all", () => {
    expect(callbackUrl(config, { originalUrl: "/oauth2/callback" } as Request).search).toBe("");
  });
});

describe("endSessionUrl", () => {
  it("uses the issuer's advertised end-session endpoint", async () => {
    const away = await endSessionUrl(config, "an-id-token");

    expect(away?.startsWith(`${base}/o/endSession`)).toBe(true);
  });

  it("sends the id token, so IDAM knows which session to end without prompting", async () => {
    const away = await endSessionUrl(config, "an-id-token");

    expect(new URL(away as string).searchParams.get("id_token_hint")).toBe("an-id-token");
  });

  it("sends the service root as the post-logout destination", async () => {
    const away = await endSessionUrl(config, "an-id-token");

    expect(new URL(away as string).searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/");
  });

  // The timed-out page, once idam-access-config registers it. IDAM refuses an unregistered return address.
  it("sends a named path on this service as the post-logout destination when asked to", async () => {
    const away = await endSessionUrl(config, "an-id-token", "/session-timed-out");

    expect(new URL(away as string).searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/session-timed-out");
  });

  it("still returns a URL when there is no id token to hint with", async () => {
    const away = await endSessionUrl(config, undefined);

    expect(away).toBeTruthy();
    expect(new URL(away as string).searchParams.has("id_token_hint")).toBe(false);
  });

  it("returns undefined when the issuer advertises no end-session endpoint", async () => {
    // A normal answer, not a failure — `end_session_endpoint` is optional in OIDC discovery. Inventing
    // a path would send the user somewhere that 404s.
    endSessionEndpoint = undefined;
    resetIdamDiscovery();

    expect(await endSessionUrl(config, "an-id-token")).toBeUndefined();
  });
});

describe("describeIdamError", () => {
  it("should keep only the name, message, code, error, description and status of a ResponseBodyError-shaped error", () => {
    // Arrange: the shape openid-client throws, with the response and its parsed body attached.
    const error = Object.assign(new Error("server responded with an error in the response body"), {
      name: "ResponseBodyError",
      code: "OAUTH_RESPONSE_BODY_ERROR",
      error: "invalid_grant",
      error_description: "Authorization code is invalid",
      status: 400,
      cause: { error: "invalid_grant", access_token: "a-token-that-must-not-be-logged" },
      response: { url: "https://idam.example/o/token?code=a-code" }
    });

    // Act
    const summary = describeIdamError(error);

    // Assert
    expect(summary).toEqual({
      name: "ResponseBodyError",
      message: "server responded with an error in the response body",
      code: "OAUTH_RESPONSE_BODY_ERROR",
      error: "invalid_grant",
      error_description: "Authorization code is invalid",
      status: 400
    });
    expect(JSON.stringify(summary)).not.toContain("a-token-that-must-not-be-logged");
    expect(JSON.stringify(summary)).not.toContain("a-code");
  });

  it("should reduce a plain error to its name and message", () => {
    expect(describeIdamError(new TypeError("fetch failed"))).toEqual({ name: "TypeError", message: "fetch failed" });
  });

  it("should stringify something that is not an Error", () => {
    expect(describeIdamError("refused")).toBe("refused");
  });
});
