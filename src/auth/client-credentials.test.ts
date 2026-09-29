import * as client from "openid-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClientCredentialsToken } from "./client-credentials.js";
import type { IdamConfig } from "./idam.js";
import { idamConfiguration } from "./idam.js";

vi.mock("openid-client", () => ({
  clientCredentialsGrant: vi.fn()
}));

// Only `idamConfiguration` is stubbed — it makes a network call. `expiresAtFrom` is kept real, because
// it is the thing under test here as much as the grant call is, and stubbing it out would leave the
// expiry assertions below asserting the stub.
vi.mock("./idam.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idam.js")>()),
  idamConfiguration: vi.fn()
}));

const config: IdamConfig = {
  issuerUrl: "https://hmcts-access.aat.platform.hmcts.net/o",
  clientId: "deed-poll-admin",
  clientSecret: "a-secret",
  redirectUri: "https://deed-poll-admin.aat.platform.hmcts.net/oauth2/callback",
  scope: "openid profile roles offline_access"
};

// A token response as the library returns one: `expires_in` seconds, plus the `expiresIn()` helper over
// it. There is no `expires_at` — reading one type-checks against the response's index signature and is
// undefined at runtime, which is how every token silently got a one-hour lifetime.
function tokenResponse(expiresIn: number | undefined) {
  return {
    access_token: "a-service-token",
    expires_in: expiresIn,
    expiresIn: () => expiresIn
  } as never;
}

describe("getClientCredentialsToken", () => {
  const mockConfiguration = {} as client.Configuration;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(idamConfiguration).mockResolvedValue(mockConfiguration);
  });

  it("requests a token with client credentials grant", async () => {
    vi.mocked(client.clientCredentialsGrant).mockResolvedValue(tokenResponse(3600));

    const before = Math.floor(Date.now() / 1000);
    const result = await getClientCredentialsToken(config, "profile roles");

    expect(result.accessToken).toBe("a-service-token");
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3600);
  });

  it("uses the IDAM configuration from discovery", async () => {
    vi.mocked(client.clientCredentialsGrant).mockResolvedValue(tokenResponse(3600));

    await getClientCredentialsToken(config, "profile roles");

    expect(idamConfiguration).toHaveBeenCalledWith(config);
  });

  it("takes the expiry from the issuer's expires_in rather than assuming an hour", async () => {
    vi.mocked(client.clientCredentialsGrant).mockResolvedValue(tokenResponse(900));

    const before = Math.floor(Date.now() / 1000);
    const result = await getClientCredentialsToken(config, "profile roles");

    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 900);
    expect(result.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 900);
  });

  it("defaults expiry to 1 hour if not provided in token response", async () => {
    const beforeCall = Math.floor(Date.now() / 1000);
    vi.mocked(client.clientCredentialsGrant).mockResolvedValue(tokenResponse(undefined));

    const result = await getClientCredentialsToken(config, "profile roles");
    const afterCall = Math.floor(Date.now() / 1000);

    expect(result.expiresAt).toBeGreaterThanOrEqual(beforeCall + 3600);
    expect(result.expiresAt).toBeLessThanOrEqual(afterCall + 3600);
  });

  it("passes the requested scope as a token-request parameter", async () => {
    // As `{ scope }`, not a bare string: the second argument is the parameter set, so a string there
    // sends no scope at all and the token comes back with the client's default rather than the one asked
    // for — which for a least-privilege service token is the whole point of asking.
    vi.mocked(client.clientCredentialsGrant).mockResolvedValue(tokenResponse(3600));

    await getClientCredentialsToken(config, "custom scope");

    expect(client.clientCredentialsGrant).toHaveBeenCalledWith(mockConfiguration, { scope: "custom scope" });
  });
});
