import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClientCredentialsToken } from "./client-credentials.js";
import type { IdamConfig } from "./idam.js";
import { createTestUser, deleteTestUser, getTestUser, type TestUser } from "./test-users.js";

vi.mock("./client-credentials.js", () => ({
  getClientCredentialsToken: vi.fn()
}));

global.fetch = vi.fn();

const config: IdamConfig = {
  issuerUrl: "https://hmcts-access.aat.platform.hmcts.net",
  clientId: "deed-poll-admin",
  clientSecret: "a-secret",
  redirectUri: "https://deed-poll-admin.aat.platform.hmcts.net/oauth2/callback",
  scope: "openid profile roles offline_access"
};

describe("createTestUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientCredentialsToken).mockResolvedValue({
      accessToken: "service-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });
  });

  it("creates a test user via the testing-support-api", async () => {
    const userId = "user-id-123";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: userId, email: "test@example.com" })
    } as Response);

    const request = {
      password: "Pa$$w0rd",
      user: {
        email: "test@example.com",
        forename: "Test",
        surname: "User",
        roleNames: ["deedpoll-admin"]
      }
    };

    const result = await createTestUser(config, request);

    expect(result).toBe(userId);
    expect(fetch).toHaveBeenCalledWith("https://idam-testing-support-api.aat.platform.hmcts.net/test/idam/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer service-token"
      },
      body: JSON.stringify(request)
    });
  });

  it("obtains a client credentials token with profile and roles scopes", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "user-id" })
    } as Response);

    await createTestUser(config, {
      password: "pass",
      user: { email: "a@b.com", forename: "A", surname: "B", roleNames: [] }
    });

    expect(getClientCredentialsToken).toHaveBeenCalledWith(config, "profile roles");
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () => "User already exists"
    } as Response);

    await expect(
      createTestUser(config, {
        password: "pass",
        user: { email: "a@b.com", forename: "A", surname: "B", roleNames: [] }
      })
    ).rejects.toThrow(/409.*Conflict.*User already exists/);
  });

  it("throws when the response contains no user ID", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ email: "test@example.com" })
    } as Response);

    await expect(
      createTestUser(config, {
        password: "pass",
        user: { email: "a@b.com", forename: "A", surname: "B", roleNames: [] }
      })
    ).rejects.toThrow(/no ID returned/);
  });
});

describe("getTestUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientCredentialsToken).mockResolvedValue({
      accessToken: "service-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });
  });

  it("fetches a test user by ID", async () => {
    const user: TestUser = {
      id: "user-id",
      email: "test@example.com",
      forename: "Test",
      surname: "User",
      roleNames: ["citizen"]
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => user
    } as Response);

    const result = await getTestUser(config, "user-id");

    expect(result).toEqual(user);
    expect(fetch).toHaveBeenCalledWith("https://idam-testing-support-api.aat.platform.hmcts.net/test/idam/users/user-id", {
      method: "GET",
      headers: {
        Authorization: "Bearer service-token"
      }
    });
  });

  it("returns undefined when the user does not exist", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404
    } as Response);

    const result = await getTestUser(config, "nonexistent");

    expect(result).toBeUndefined();
  });

  it("throws when the API returns an error other than 404", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Something broke"
    } as Response);

    await expect(getTestUser(config, "user-id")).rejects.toThrow(/500.*Internal Server Error/);
  });
});

describe("deleteTestUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientCredentialsToken).mockResolvedValue({
      accessToken: "service-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });
  });

  it("deletes a test user via the testing-support-api", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true
    } as Response);

    await deleteTestUser(config, "user-id");

    expect(fetch).toHaveBeenCalledWith("https://idam-testing-support-api.aat.platform.hmcts.net/test/idam/users/user-id", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer service-token"
      }
    });
  });

  it("succeeds silently when the user does not exist", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404
    } as Response);

    await expect(deleteTestUser(config, "nonexistent")).resolves.toBeUndefined();
  });

  it("throws when the API returns an error other than 404", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Something broke"
    } as Response);

    await expect(deleteTestUser(config, "user-id")).rejects.toThrow(/500.*Internal Server Error/);
  });
});
