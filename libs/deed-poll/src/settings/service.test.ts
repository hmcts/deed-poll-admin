import { getProcessSettings, updateProcessSettings } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, InvalidInputError } from "../errors.js";
import { findProcessSettings, saveProcessSettings } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getProcessSettings: vi.fn(),
  updateProcessSettings: vi.fn()
}));

const CALLER = { accessToken: "delivery-manager-token" };
const SETTINGS = { referralClaimExpiryMinutes: 120, revision: 4, updatedAt: null, updatedBy: null };

describe("settings/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should read the settings with the caller's token", async () => {
    vi.mocked(getProcessSettings).mockResolvedValue({ ok: true, data: SETTINGS });

    const result = await findProcessSettings(CALLER);

    expect(result).toBe(SETTINGS);
    expect(getProcessSettings).toHaveBeenCalledWith(expect.objectContaining(CALLER));
  });

  it("should send only the window and the revision, because api stamps the attribution from the token", async () => {
    vi.mocked(updateProcessSettings).mockResolvedValue({ ok: true, data: SETTINGS });

    const result = await saveProcessSettings({ referralClaimExpiryMinutes: 90, revision: 4 }, CALLER);

    expect(result).toBe(SETTINGS);
    expect(updateProcessSettings).toHaveBeenCalledWith({ referralClaimExpiryMinutes: 90, revision: 4 }, expect.objectContaining(CALLER));
  });

  it("should throw ForbiddenError when api answers 403", async () => {
    vi.mocked(getProcessSettings).mockResolvedValue({ ok: false, error: { kind: "forbidden", status: 403, message: "Forbidden" } });

    await expect(findProcessSettings(CALLER)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("should throw ConflictError when api answers 409 for a stale revision", async () => {
    vi.mocked(updateProcessSettings).mockResolvedValue({ ok: false, error: { kind: "conflict", status: 409, message: "Changed" } });

    await expect(saveProcessSettings({ referralClaimExpiryMinutes: 90, revision: 0 }, CALLER)).rejects.toBeInstanceOf(ConflictError);
  });

  it("should throw InvalidInputError naming api's field when api answers 400", async () => {
    vi.mocked(updateProcessSettings).mockResolvedValue({
      ok: false,
      error: { kind: "validation", status: 400, message: "Invalid", fieldErrors: [{ field: "referralClaimExpiryMinutes", message: "out of range" }] }
    } as never);

    const error = await saveProcessSettings({ referralClaimExpiryMinutes: 90, revision: 0 }, CALLER).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).errors.map((field) => field.field)).toEqual(["referralClaimExpiryMinutes"]);
  });
});
