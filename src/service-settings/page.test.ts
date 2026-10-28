import {
  ConflictError,
  ForbiddenError,
  findGazetteSettings,
  findProcessSettings,
  InvalidInputError,
  MANAGE_PROCESS_CONFIG,
  saveGazetteSettings,
  saveProcessSettings,
  UnauthorizedError
} from "@hmcts/deed-poll";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { saveGazetteSection, saveProcessSection, showSettings } from "./page.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findGazetteSettings: vi.fn(),
  findProcessSettings: vi.fn(),
  saveGazetteSettings: vi.fn(),
  saveProcessSettings: vi.fn()
}));

const CALLER = { accessToken: "dm-token" };
const PROCESS = {
  referralClaimExpiryMinutes: 10080,
  reminderIntervalHours: 48,
  masterWindowCap: 10,
  morningWindowStart: "07:00",
  morningWindowEnd: "10:30",
  afternoonWindowStart: "14:00",
  afternoonWindowEnd: "14:30",
  revision: 4,
  updatedBy: "Dee Manager",
  updatedAt: new Date("2026-10-20T09:30:00Z")
};
const STORED_VALUES = {
  processingDays: "7",
  reminderIntervalHours: "48",
  masterWindowCap: "10",
  morningWindowStart: "07:00",
  morningWindowEnd: "10:30",
  afternoonWindowStart: "14:00",
  afternoonWindowEnd: "14:30",
  revision: "4"
};
const GAZETTE = { recipientEmail: "lg@example.com", revision: 2, updatedBy: "Admin", updatedAt: new Date("2026-10-08T10:00:00Z") };
const PROCESS_ONLY = { staff: true, judicial: false, capabilities: [MANAGE_PROCESS_CONFIG] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findProcessSettings).mockResolvedValue(PROCESS);
  vi.mocked(findGazetteSettings).mockResolvedValue(GAZETTE);
  vi.mocked(saveProcessSettings).mockResolvedValue(PROCESS);
  vi.mocked(saveGazetteSettings).mockResolvedValue(GAZETTE);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(options: { body?: unknown; query?: Record<string, unknown>; access?: unknown } = {}) {
  return pageRequest({ deliveryManager: true, accessToken: "dm-token", ...options });
}

function model(res: ReturnType<typeof pageResponse>) {
  return res.render.mock.calls[0]?.[1];
}

describe("service settings GET", () => {
  it("should read both sections with the caller's token and show the processing window in days", async () => {
    const res = pageResponse();

    await showSettings(request(), res);

    expect(findProcessSettings).toHaveBeenCalledExactlyOnceWith(CALLER);
    expect(findGazetteSettings).toHaveBeenCalledExactlyOnceWith(CALLER);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render.mock.calls[0]?.[0]).toBe("deed-polls/settings/index");
    expect(model(res).process).toEqual({
      isAvailable: true,
      values: STORED_VALUES,
      errors: {},
      isNeverChanged: false,
      updatedBy: "Dee Manager",
      updatedAt: "20 October 2026 at 10:30"
    });
    expect(model(res).gazette).toMatchObject({ isAvailable: true, values: { recipientEmail: "lg@example.com", revision: "2" }, isUnset: false });
    expect(model(res).errorList).toEqual([]);
  });

  it("should say the referral process has never been changed when api reports no attribution", async () => {
    vi.mocked(findProcessSettings).mockResolvedValue({ ...PROCESS, revision: 0, updatedBy: null, updatedAt: null });
    const res = pageResponse();

    await showSettings(request(), res);

    expect(model(res).process).toEqual({
      isAvailable: true,
      values: { ...STORED_VALUES, revision: "0" },
      errors: {},
      isNeverChanged: true,
      updatedBy: undefined,
      updatedAt: undefined
    });
  });

  it.each([
    [1440, "1"],
    [43200, "30"],
    [1470, "1.02"]
  ])("should show a processing window of %i minutes as %j days, never rounding a part-day", async (minutes, days) => {
    vi.mocked(findProcessSettings).mockResolvedValue({ ...PROCESS, referralClaimExpiryMinutes: minutes });
    const res = pageResponse();

    await showSettings(request(), res);

    expect(model(res).process.values.processingDays).toBe(days);
  });

  it("should draw a window time api holds no value for as an empty control", async () => {
    vi.mocked(findProcessSettings).mockResolvedValue({ ...PROCESS, afternoonWindowEnd: null });
    const res = pageResponse();

    await showSettings(request(), res);

    expect(model(res).process.values.afternoonWindowEnd).toBe("");
  });

  it("should neither read nor show the Gazette section when the caller does not hold ACCESS_GAZETTE", async () => {
    const res = pageResponse();

    await showSettings(request({ access: PROCESS_ONLY, query: { saved: "gazette-recipient" } }), res);

    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(model(res).gazette).toBeUndefined();
    expect(model(res).savedSection).toBeUndefined();
  });

  it("should degrade only the Gazette section when its read fails, and log why", async () => {
    vi.mocked(findGazetteSettings).mockRejectedValue(new Error("gazette down\nforged"));
    const res = pageResponse();

    await showSettings(request(), res);

    expect(model(res).gazette).toEqual({ isAvailable: false });
    expect(model(res).process.isAvailable).toBe(true);
    expect(console.error).toHaveBeenCalledWith("gazette settings unavailable: gazette downforged");
  });

  it("should still show the saved banner when the follow-up read of the saved section fails", async () => {
    vi.mocked(findProcessSettings).mockRejectedValue(new Error("api unavailable"));
    const res = pageResponse();

    await showSettings(request({ query: { saved: "process-settings" } }), res);

    expect(model(res).savedSection).toBe("process-settings");
    expect(model(res).process).toEqual({ isAvailable: false });
    expect(model(res).gazette.isAvailable).toBe(true);
    expect(findProcessSettings).toHaveBeenCalledTimes(1);
  });

  it("should ignore a saved value that names no section", async () => {
    const res = pageResponse();

    await showSettings(request({ query: { saved: "<script>" } }), res);

    expect(model(res).savedSection).toBeUndefined();
  });

  it("should let api's 401 end the session rather than degrade a section", async () => {
    const error = new UnauthorizedError("token rejected");
    vi.mocked(findProcessSettings).mockRejectedValue(error);

    await expect(showSettings(request(), pageResponse())).rejects.toBe(error);
  });
});

describe("process section POST", () => {
  const body = { ...STORED_VALUES, processingDays: " 14 ", morningWindowStart: "07:15" };

  it("should save every field, the window in minutes, with the original revision and redirect to the saved section", async () => {
    const res = pageResponse();

    await saveProcessSection(request({ body: { ...body, updatedBy: "forged" } }), res);

    expect(saveProcessSettings).toHaveBeenCalledExactlyOnceWith(
      {
        referralClaimExpiryMinutes: 20160,
        reminderIntervalHours: 48,
        masterWindowCap: 10,
        morningWindowStart: "07:15",
        morningWindowEnd: "10:30",
        afternoonWindowStart: "14:00",
        afternoonWindowEnd: "14:30",
        revision: 4
      },
      CALLER
    );
    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/settings?saved=process-settings#process-settings");
    expect(findProcessSettings).not.toHaveBeenCalled();
    expect(findGazetteSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["processing window", { processingDays: "31" }, "processingDays", "Enter the processing window as a whole number of days from 1 to 30"],
    ["reminder interval", { reminderIntervalHours: "+2" }, "reminderIntervalHours", "Enter the reminder interval as a whole number of hours from 1 to 168"],
    ["cap", { masterWindowCap: "" }, "masterWindowCap", "Enter the referrals per Master as a whole number from 1 to 100"],
    ["morning start", { morningWindowStart: "7:00" }, "morningWindowStart", expect.stringContaining("morning window’s start")],
    ["afternoon end", { afternoonWindowEnd: "14:20" }, "afternoonWindowEnd", expect.stringContaining("afternoon window’s end")],
    ["morning ordering", { morningWindowEnd: "06:00" }, "morningWindowEnd", "The morning window must end after it starts"],
    ["window ordering", { afternoonWindowStart: "10:00" }, "afternoonWindowStart", "The afternoon window must start after the morning window ends"],
    [
      "afternoon ordering",
      { afternoonWindowEnd: "13:00", afternoonWindowStart: "13:00" },
      "afternoonWindowEnd",
      "The afternoon window must end after it starts"
    ]
  ])("should refuse an invalid %s with no write, keeping the typed text and original revision", async (_name, change, control, message) => {
    const res = pageResponse();
    const input = { ...body, ...change };

    await saveProcessSection(request({ body: input }), res);

    expect(saveProcessSettings).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).process).toEqual({ isAvailable: true, values: input, errors: { [control]: message } });
    expect(model(res).errorList).toEqual([{ text: message, href: `#${control}` }]);
    expect(findProcessSettings).not.toHaveBeenCalled();
    expect(findGazetteSettings).toHaveBeenCalledExactlyOnceWith(CALLER);
  });

  it("should list every refused control in the page's order", async () => {
    const res = pageResponse();

    await saveProcessSection(request({ body: { ...body, afternoonWindowEnd: "x", processingDays: "0" } }), res);

    expect(model(res).errorList.map((each: { href: string }) => each.href)).toEqual(["#processingDays", "#afternoonWindowEnd"]);
  });

  it("should redraw a repeated control empty and refuse it", async () => {
    const res = pageResponse();

    await saveProcessSection(request({ body: { ...body, processingDays: ["1", "2"] } }), res);

    expect(saveProcessSettings).not.toHaveBeenCalled();
    expect(model(res).process.values.processingDays).toBe("");
    expect(model(res).process.errors.processingDays).toBeDefined();
  });

  it("should require a reload for a missing revision rather than read a fresh one", async () => {
    const res = pageResponse();
    const { revision: _revision, ...withoutRevision } = body;

    await saveProcessSection(request({ body: withoutRevision }), res);

    expect(saveProcessSettings).not.toHaveBeenCalled();
    expect(model(res).process.reloadText).toBe("Reload the settings before saving");
    expect(model(res).errorList).toEqual([{ text: "Reload the settings before saving", href: "#reload-process-settings" }]);
    expect(findProcessSettings).not.toHaveBeenCalled();
  });

  it("should keep the typed text and original revision on api's 409, and require a reload", async () => {
    vi.mocked(saveProcessSettings).mockRejectedValue(new ConflictError("private prose"));
    const res = pageResponse();

    await saveProcessSection(request({ body }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(model(res).process).toMatchObject({ values: body, errors: {}, reloadText: expect.stringContaining("has changed") });
    expect(findProcessSettings).not.toHaveBeenCalled();
    expect(saveProcessSettings).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it.each([
    [
      [{ field: "referralClaimExpiryMinutes", message: "x" }],
      { errors: { processingDays: "Enter the processing window as a whole number of days from 1 to 30" } }
    ],
    [[{ field: "masterWindowCap", message: "x" }], { errors: { masterWindowCap: "Enter the referrals per Master as a whole number from 1 to 100" } }],
    [[{ field: "afternoonWindowStart", message: "x" }], { errors: { afternoonWindowStart: "The afternoon window must start after the morning window ends" } }],
    [[{ field: "morningWindowEnd", message: "x" }], { errors: { morningWindowEnd: "The morning window must end after it starts" } }],
    [[{ field: "revision", message: "x" }], { errors: {}, reloadText: "Reload the settings before saving" }],
    [[{ field: "constructor", message: "x" }], { errors: {}, reloadText: "The referral process could not be saved. Reload the settings and try again." }],
    [[], { errors: {}, reloadText: "The referral process could not be saved. Reload the settings and try again." }]
  ])("should map api's 400 naming %j to its control", async (errors, expected) => {
    vi.mocked(saveProcessSettings).mockRejectedValue(new InvalidInputError("private prose", errors));
    const res = pageResponse();

    await saveProcessSection(request({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).process).toEqual({ isAvailable: true, values: body, ...expected });
  });

  it.each([
    ["local validation", () => undefined, { ...body, processingDays: "x" }, 400],
    ["api 400", () => vi.mocked(saveProcessSettings).mockRejectedValue(new InvalidInputError("x", [])), body, 400],
    ["api 409", () => vi.mocked(saveProcessSettings).mockRejectedValue(new ConflictError("x")), body, 409]
  ])("should degrade the Gazette section with no form when its read fails after %s, keeping the primary errors", async (_name, arrange, input, status) => {
    arrange();
    vi.mocked(findGazetteSettings).mockRejectedValue(new Error("gazette down"));
    const res = pageResponse();

    await saveProcessSection(request({ body: input }), res);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(model(res).gazette).toEqual({ isAvailable: false });
    expect(model(res).errorList.length).toBeGreaterThan(0);
  });

  it("should never read the Gazette settings for a caller without ACCESS_GAZETTE", async () => {
    const res = pageResponse();

    await saveProcessSection(request({ access: PROCESS_ONLY, body: { ...body, revision: "x" } }), res);

    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(model(res).gazette).toBeUndefined();
  });

  it.each([new Error("unavailable"), new ForbiddenError("forbidden"), new UnauthorizedError("unauthorized")])(
    "should propagate $name unchanged without rendering",
    async (error) => {
      vi.mocked(saveProcessSettings).mockRejectedValue(error);
      const res = pageResponse();

      await expect(saveProcessSection(request({ body }), res)).rejects.toBe(error);

      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    }
  );
});

describe("Gazette section POST", () => {
  const body = { recipientEmail: "  new@example.com  ", revision: "2" };

  it("should save only validated settings with the original revision and redirect to the saved section", async () => {
    const res = pageResponse();

    await saveGazetteSection(request({ body: { ...body, updatedBy: "forged" } }), res);

    expect(saveGazetteSettings).toHaveBeenCalledExactlyOnceWith({ recipientEmail: "new@example.com", revision: 2 }, CALLER);
    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/settings?saved=gazette-recipient#gazette-recipient");
  });

  it("should refuse a Delivery Manager without ACCESS_GAZETTE before reading or writing anything", async () => {
    const res = pageResponse();

    const refusal = saveGazetteSection(request({ access: PROCESS_ONLY, body }), res);

    await expect(refusal).rejects.toBeInstanceOf(ForbiddenError);
    await expect(refusal).rejects.toMatchObject({ reason: "role", requiredCapability: "ACCESS_GAZETTE" });
    expect(saveGazetteSettings).not.toHaveBeenCalled();
    expect(findProcessSettings).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
  });

  it.each(["", "bad", "a@example.com,b@example.com"])("should keep invalid input %j with no write and read the process section", async (recipientEmail) => {
    const res = pageResponse();

    await saveGazetteSection(request({ body: { recipientEmail, revision: "2" } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).gazette.values).toEqual({ recipientEmail, revision: "2" });
    expect(model(res).errorList[0].href).toBe("#recipientEmail");
    expect(saveGazetteSettings).not.toHaveBeenCalled();
    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(findProcessSettings).toHaveBeenCalledExactlyOnceWith(CALLER);
  });

  it("should keep the typed text and original revision on api's 409, and require a reload", async () => {
    vi.mocked(saveGazetteSettings).mockRejectedValue(new ConflictError("private prose"));
    const res = pageResponse();

    await saveGazetteSection(request({ body }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(model(res).gazette).toMatchObject({ values: body, reloadText: expect.stringContaining("has changed") });
    expect(model(res).errorList).toEqual([{ text: expect.stringContaining("has changed"), href: "#reload-gazette-recipient" }]);
    expect(findGazetteSettings).not.toHaveBeenCalled();
  });

  it.each([
    [[{ field: "recipientEmail", message: "x" }], { emailError: "Enter a valid email address, like name@example.com" }],
    [[{ field: "revision", message: "x" }], { reloadText: "The recipient could not be saved. Reload the settings and try again." }]
  ])("should map api's 400 naming %j", async (errors, expected) => {
    vi.mocked(saveGazetteSettings).mockRejectedValue(new InvalidInputError("private prose", errors));
    const res = pageResponse();

    await saveGazetteSection(request({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).gazette).toEqual({ isAvailable: true, values: body, isUnset: false, ...expected });
  });

  it.each([new Error("unavailable"), new ForbiddenError("forbidden"), new UnauthorizedError("unauthorized")])(
    "should propagate $name from the Gazette save unchanged without rendering",
    async (error) => {
      vi.mocked(saveGazetteSettings).mockRejectedValue(error);
      const res = pageResponse();

      await expect(saveGazetteSection(request({ body }), res)).rejects.toBe(error);

      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    }
  );

  it("should degrade the process section with no form when its read fails after a refusal", async () => {
    vi.mocked(findProcessSettings).mockRejectedValue(new Error("down"));
    vi.mocked(saveGazetteSettings).mockRejectedValue(new ConflictError("x"));
    const res = pageResponse();

    await saveGazetteSection(request({ body }), res);

    expect(model(res).process).toEqual({ isAvailable: false });
    expect(model(res).errorList).toHaveLength(1);
  });
});
