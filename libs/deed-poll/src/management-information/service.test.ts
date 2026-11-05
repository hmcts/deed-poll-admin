import { getMiCompletion, getMiReferralOutcomes, getMiStageDurations, getMiVolume } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, InvalidInputError } from "../errors.js";
import { findMiCompletion, findMiReferralOutcomes, findMiStageDurations, findMiVolume } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getMiCompletion: vi.fn(),
  getMiReferralOutcomes: vi.fn(),
  getMiStageDurations: vi.fn(),
  getMiVolume: vi.fn()
}));

const CALLER = { accessToken: "team-leader-token" };
const QUERY = { from: "2026-10-06", to: "2026-11-04", granularity: "WEEK" as const, includeMigrated: true };

describe("management-information/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["findMiVolume", findMiVolume, getMiVolume],
    ["findMiStageDurations", findMiStageDurations, getMiStageDurations],
    ["findMiReferralOutcomes", findMiReferralOutcomes, getMiReferralOutcomes],
    ["findMiCompletion", findMiCompletion, getMiCompletion]
  ] as const)("should send the query with the caller's token through %s and return api's answer", async (_name, find, read) => {
    const answer = { parameters: QUERY };
    vi.mocked(read).mockResolvedValue({ ok: true, data: answer } as never);

    const result = await find(QUERY, CALLER);

    expect(result).toBe(answer);
    expect(read).toHaveBeenCalledWith(QUERY, expect.objectContaining(CALLER));
  });

  it("should turn api's 400 into InvalidInputError keeping api's field errors", async () => {
    const errors = [{ field: "to", message: "The last day of the range cannot be before the first." }];
    vi.mocked(getMiVolume).mockResolvedValue({
      ok: false,
      error: { kind: "validation", status: 400, message: errors[0].message, fieldErrors: errors }
    } as never);

    const failure = await findMiVolume(QUERY, CALLER).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidInputError);
    expect((failure as InvalidInputError).errors).toEqual(errors);
  });

  it("should turn api's 403 into ForbiddenError", async () => {
    vi.mocked(getMiCompletion).mockResolvedValue({ ok: false, error: { kind: "forbidden", status: 403, message: "Forbidden" } } as never);

    await expect(findMiCompletion(QUERY, CALLER)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
