import {
  addBankHoliday,
  createMaster,
  getProcessSettings,
  listBankHolidays,
  listMasters,
  removeBankHoliday,
  updateMaster,
  updateProcessSettings
} from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from "../errors.js";
import {
  deleteBankHoliday,
  findBankHolidays,
  findMasters,
  findProcessSettings,
  saveBankHoliday,
  saveMasterChange,
  saveNewMaster,
  saveProcessSettings
} from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  addBankHoliday: vi.fn(),
  createMaster: vi.fn(),
  getProcessSettings: vi.fn(),
  listBankHolidays: vi.fn(),
  listMasters: vi.fn(),
  removeBankHoliday: vi.fn(),
  updateMaster: vi.fn(),
  updateProcessSettings: vi.fn()
}));

const CALLER = { accessToken: "delivery-manager-token" };
const MASTER = { id: "6f1c1d4e-2a5b-4c3d-8e9f-0a1b2c3d4e5f", name: "Master Wren", email: "wren@example.test", available: true, linked: false, revision: 0 };
const HOLIDAY = { date: "2029-01-01", name: "New Year's Day" };
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

  it("should pass every setting and the revision through, and no attribution, because api stamps it from the token", async () => {
    vi.mocked(updateProcessSettings).mockResolvedValue({ ok: true, data: SETTINGS });
    const dto = {
      referralClaimExpiryMinutes: 10080,
      reminderIntervalHours: 48,
      windowCap: 10,
      morningWindowStart: "07:00",
      morningWindowEnd: "10:30",
      afternoonWindowStart: "14:00",
      afternoonWindowEnd: "14:30",
      revision: 4
    };

    const result = await saveProcessSettings(dto, CALLER);

    expect(result).toBe(SETTINGS);
    expect(updateProcessSettings).toHaveBeenCalledWith(dto, expect.objectContaining(CALLER));
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

  describe("Masters", () => {
    it("should list the Masters with the caller's token", async () => {
      vi.mocked(listMasters).mockResolvedValue({
        ok: true,
        data: { masters: [{ ...MASTER, assignedInWindow: 0 }], window: { date: "2026-10-28", slot: "AM" }, cap: 10 }
      });

      const result = await findMasters(CALLER);

      expect(result).toEqual([{ ...MASTER, assignedInWindow: 0 }]);
      expect(listMasters).toHaveBeenCalledWith(expect.objectContaining(CALLER));
    });

    it("should add a Master with only its name and email", async () => {
      vi.mocked(createMaster).mockResolvedValue({ ok: true, data: MASTER });

      await saveNewMaster({ name: "Master Wren", email: "wren@example.test" }, CALLER);

      expect(createMaster).toHaveBeenCalledWith({ name: "Master Wren", email: "wren@example.test" }, expect.objectContaining(CALLER));
    });

    it("should patch a Master by its id at the revision given", async () => {
      vi.mocked(updateMaster).mockResolvedValue({ ok: true, data: { ...MASTER, revision: 1 } });

      await saveMasterChange(MASTER.id, { available: false, revision: 0 }, CALLER);

      expect(updateMaster).toHaveBeenCalledWith(MASTER.id, { available: false, revision: 0 }, expect.objectContaining(CALLER));
    });

    it("should keep api's field on the ConflictError when a duplicate email is refused, so it is not read as a stale revision", async () => {
      vi.mocked(createMaster).mockResolvedValue({
        ok: false,
        error: { kind: "conflict", status: 409, message: "Duplicate", fieldErrors: [{ field: "email", message: "Duplicate" }] }
      } as never);

      const error = await saveNewMaster({ name: "Master Wren", email: "wren@example.test" }, CALLER).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).errors.map((field) => field.field)).toEqual(["email"]);
    });

    it("should carry no field on the ConflictError for a stale revision", async () => {
      vi.mocked(updateMaster).mockResolvedValue({ ok: false, error: { kind: "conflict", status: 409, message: "Changed" } });

      const error = await saveMasterChange(MASTER.id, { available: false, revision: 0 }, CALLER).catch((caught: unknown) => caught);

      expect((error as ConflictError).errors).toEqual([]);
    });
  });

  describe("bank holidays", () => {
    it("should list, add and remove bank holidays with the caller's token", async () => {
      vi.mocked(listBankHolidays).mockResolvedValue({ ok: true, data: [HOLIDAY] });
      vi.mocked(addBankHoliday).mockResolvedValue({ ok: true, data: HOLIDAY });
      vi.mocked(removeBankHoliday).mockResolvedValue({ ok: true, data: undefined });

      expect(await findBankHolidays(CALLER)).toEqual([HOLIDAY]);
      await saveBankHoliday(HOLIDAY, CALLER);
      await deleteBankHoliday("2029-01-01", CALLER);

      expect(addBankHoliday).toHaveBeenCalledWith(HOLIDAY, expect.objectContaining(CALLER));
      expect(removeBankHoliday).toHaveBeenCalledWith("2029-01-01", expect.objectContaining(CALLER));
    });

    it("should throw NotFoundError when the date is not listed", async () => {
      vi.mocked(removeBankHoliday).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "Not listed" } });

      await expect(deleteBankHoliday("2029-01-02", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
