/**
 * The password grant the persona switcher swaps identity with.
 *
 * Same shape as `idam.test.ts` and for the same reason: `openid-client` runs for real against a discovery
 * document served over HTTP by this file, and only the two calls that would need a signing token endpoint to
 * answer — `genericGrantRequest` and `fetchUserInfo` — are stubbed. What is being tested is the glue, and the
 * glue is where this could go wrong quietly: a grant that returned the right *access* token and no refresh
 * token would work perfectly for five minutes and then revert the session to whoever was signed in before.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DEEDPOLL_JUDICIAL, findCallerAccess } from "@hmcts/deed-poll";
import * as client from "openid-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type IdamConfig, resetIdamDiscovery } from "./idam.js";
import { passwordGrantLogin } from "./password-grant.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findCallerAccess: vi.fn()
}));

vi.mock("openid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openid-client")>()),
  genericGrantRequest: vi.fn(),
  fetchUserInfo: vi.fn()
}));

let server: Server;
let base: string;
let config: IdamConfig;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname === "/o/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          issuer: `${base}/o`,
          authorization_endpoint: `${base}/o/authorize`,
          token_endpoint: `${base}/o/token`,
          userinfo_endpoint: `${base}/o/userinfo`,
          jwks_uri: `${base}/o/jwks`,
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
    scope: "openid profile roles offline_access"
  };
});

afterAll(() => {
  server.close();
});

const JUDGE_CLAIMS = { sub: "judge@example.com" };

/**
 * `expires_in` and the `expiresIn()` helper over it are both modelled, because that pair is what the library
 * returns — see `idam.test.ts` on the double that omitted them and let the code read a non-existent
 * `expires_at`.
 *
 * `claims` is deliberately required and un-defaulted: a default swallows an explicit `undefined`, so the "no ID
 * token at all" case would silently test the default instead and the refusal below would never be exercised.
 */
function tokenResponse(overrides: Record<string, unknown>, claims: Record<string, unknown> | undefined) {
  return {
    access_token: "a-judge-access-token",
    id_token: "a-judge-id-token",
    refresh_token: "a-judge-refresh-token",
    expires_in: 900,
    claims: () => claims,
    expiresIn: () => 900,
    ...overrides
  } as never;
}

describe("passwordGrantLogin", () => {
  beforeEach(() => {
    resetIdamDiscovery();
    vi.clearAllMocks();
    vi.mocked(client.genericGrantRequest).mockResolvedValue(tokenResponse({}, JUDGE_CLAIMS));
    vi.mocked(client.fetchUserInfo).mockResolvedValue({ sub: "judge@example.com", name: "A Judge", roles: [DEEDPOLL_JUDICIAL] } as never);
    vi.mocked(findCallerAccess).mockResolvedValue({ staff: false, judicial: true, capabilities: [] });
  });

  it("should ask the issuer for a password grant with the persona's credentials and the configured scope", async () => {
    // The scope matters as much as the credentials: `offline_access` is what makes IDAM issue the refresh
    // token the assertion below depends on.
    await passwordGrantLogin(config, "judge@example.com", "Pa55word11");

    expect(client.genericGrantRequest).toHaveBeenCalledWith(expect.anything(), "password", {
      username: "judge@example.com",
      password: "Pa55word11",
      scope: "openid profile roles offline_access"
    });
  });

  it("should return the persona's name from userinfo and its access from /me, asked with the persona's own token", async () => {
    // The switcher signs in through this path, so a switched persona's access is api's answer for the new token
    // rather than whatever the previous persona's session held.
    const { user } = await passwordGrantLogin(config, "judge@example.com", "Pa55word11");

    expect(findCallerAccess).toHaveBeenCalledWith({ accessToken: "a-judge-access-token" });
    expect(user).toMatchObject({ staff: false, judicial: true, capabilities: [], isJudicial: true, name: "A Judge" });
  });

  it("should grant nothing from the roles userinfo asserts when /me gives no answer", async () => {
    vi.mocked(findCallerAccess).mockRejectedValue(new Error("deed-poll-api call failed (timeout): aborted"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { user } = await passwordGrantLogin(config, "judge@example.com", "Pa55word11");

    expect(user).toMatchObject({ staff: false, judicial: false, capabilities: [], isJudicial: false, name: "A Judge" });
  });

  it("should check userinfo against the ID token's subject, so a response describing someone else is refused", async () => {
    await passwordGrantLogin(config, "judge@example.com", "Pa55word11");

    expect(client.fetchUserInfo).toHaveBeenCalledWith(expect.anything(), "a-judge-access-token", "judge@example.com");
  });

  it("should return the refresh token, without which the session reverts at the next renewal", async () => {
    // The trap this task exists for: `refreshMiddleware` renews five minutes before expiry, so a switch that
    // left the previous user's refresh token in place would silently put them back mid-test.
    const { tokens } = await passwordGrantLogin(config, "judge@example.com", "Pa55word11");

    expect(tokens.refreshToken).toBe("a-judge-refresh-token");
    expect(tokens.accessToken).toBe("a-judge-access-token");
    expect(tokens.idToken).toBe("a-judge-id-token");
  });

  it("should return the subject, which is what a later refresh is checked against", async () => {
    const { subject } = await passwordGrantLogin(config, "judge@example.com", "Pa55word11");

    expect(subject).toBe("judge@example.com");
  });

  it("should take the expiry from the issuer's expires_in rather than assuming an hour", async () => {
    const before = Math.floor(Date.now() / 1000);

    const { tokens } = await passwordGrantLogin(config, "judge@example.com", "Pa55word11");

    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 900);
    expect(tokens.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 900);
  });

  it("should refuse a token response with no verifiable ID token subject", async () => {
    // Adopting it would replace the session's user with nobody, and `fetchUserInfo` would have nothing to be
    // checked against.
    vi.mocked(client.genericGrantRequest).mockResolvedValue(tokenResponse({}, undefined));

    await expect(passwordGrantLogin(config, "judge@example.com", "Pa55word11")).rejects.toThrow(/no ID token subject/);
    expect(client.fetchUserInfo).not.toHaveBeenCalled();
  });

  it("should propagate a refused grant rather than returning a half-built identity", async () => {
    // What AAT will do until the client is registered for `password`, and what the local simulator does for a
    // user that has not been seeded. The caller renders the 500 page; task 5 is where it learns to explain it.
    vi.mocked(client.genericGrantRequest).mockRejectedValue(new Error("unauthorized_client"));

    await expect(passwordGrantLogin(config, "judge@example.com", "Pa55word11")).rejects.toThrow("unauthorized_client");
  });
});
