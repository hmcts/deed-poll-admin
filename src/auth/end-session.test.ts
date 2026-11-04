import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableEndSessionUrl } from "./end-session.js";
import { endSessionUrl, type IdamConfig } from "./idam.js";

vi.mock("./idam.js", () => ({ endSessionUrl: vi.fn() }));

const CONFIG = { issuerUrl: "https://idam.example/o", redirectUri: "https://admin.example/oauth2/callback" } as IdamConfig;
const END_SESSION = "https://idam.example/o/endSession?id_token_hint=an-id-token";

describe("availableEndSessionUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should pass IDAM's end-session address through when discovery succeeds", async () => {
    vi.mocked(endSessionUrl).mockResolvedValue(END_SESSION);

    const away = await availableEndSessionUrl(CONFIG, "an-id-token", "/session-timed-out");

    expect(away).toBe(END_SESSION);
    expect(endSessionUrl).toHaveBeenCalledWith(CONFIG, "an-id-token", "/session-timed-out");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("should answer undefined, as for an issuer with no end-session endpoint, when discovery fails", async () => {
    vi.mocked(endSessionUrl).mockRejectedValue(Object.assign(new Error("unexpected HTTP response status code 503 for an-id-token"), { cause: "body" }));

    const away = await availableEndSessionUrl(CONFIG, "an-id-token");

    expect(away).toBeUndefined();
    expect(vi.mocked(console.warn).mock.calls).toEqual([["IDAM end-session address unavailable; the session was ended locally only"]]);
  });
});
