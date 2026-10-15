import { findCallerAccess } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCallerAccess } from "./caller-access.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findCallerAccess: vi.fn()
}));

const ANSWER = { staff: true, judicial: false, capabilities: ["ACCESS_GAZETTE" as const] };

describe("fetchCallerAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return api's answer for the token it is given", async () => {
    vi.mocked(findCallerAccess).mockResolvedValue(ANSWER);

    const access = await fetchCallerAccess("a-token", "refresh");

    expect(access).toEqual(ANSWER);
    expect(findCallerAccess).toHaveBeenCalledWith({ accessToken: "a-token" });
  });

  it.each([
    ["sign-in", "no access until its next refresh"],
    ["refresh", "keeps its previous answer"],
    ["backfill", "the next will ask again"]
  ] as const)("should answer undefined and warn once, naming what %s does next, when api gives no answer", async (occasion, consequence) => {
    vi.mocked(findCallerAccess).mockRejectedValue(new Error("deed-poll-api call failed (timeout): aborted"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const access = await fetchCallerAccess("a-secret-token", occasion);

    expect(access).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(consequence);
    expect(logged).toContain("timeout");
    expect(logged).not.toContain("a-secret-token");
  });
});
