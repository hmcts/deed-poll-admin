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
const PROCESS = { referralClaimExpiryMinutes: 150, revision: 4, updatedBy: "Dee Manager", updatedAt: new Date("2026-10-20T09:30:00Z") };
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
  it("should read both sections with the caller's token and show the claim window in hours and minutes", async () => {
    const res = pageResponse();

    await showSettings(request(), res);

    expect(findProcessSettings).toHaveBeenCalledExactlyOnceWith(CALLER);
    expect(findGazetteSettings).toHaveBeenCalledExactlyOnceWith(CALLER);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render.mock.calls[0]?.[0]).toBe("deed-polls/settings/index");
    expect(model(res).process).toEqual({
      isAvailable: true,
      values: { hours: "2", minutes: "30", revision: "4" },
      isNeverChanged: false,
      updatedBy: "Dee Manager",
      updatedAt: "20 October 2026 at 10:30"
    });
    expect(model(res).gazette).toMatchObject({ isAvailable: true, values: { recipientEmail: "lg@example.com", revision: "2" }, isUnset: false });
    expect(model(res).errorList).toEqual([]);
  });

  it("should say the claim window has never been changed when api reports no attribution", async () => {
    vi.mocked(findProcessSettings).mockResolvedValue({ referralClaimExpiryMinutes: 120, revision: 0, updatedBy: null, updatedAt: null });
    const res = pageResponse();

    await showSettings(request(), res);

    expect(model(res).process).toEqual({
      isAvailable: true,
      values: { hours: "2", minutes: "0", revision: "0" },
      isNeverChanged: true,
      updatedBy: undefined,
      updatedAt: undefined
    });
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
  const body = { claimWindowHours: " 3 ", claimWindowMinutes: "", revision: "4" };

  it("should save the total in minutes with the original revision and redirect to the saved section", async () => {
    const res = pageResponse();

    await saveProcessSection(request({ body: { ...body, updatedBy: "forged" } }), res);

    expect(saveProcessSettings).toHaveBeenCalledExactlyOnceWith({ referralClaimExpiryMinutes: 180, revision: 4 }, CALLER);
    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/settings?saved=process-settings#process-settings");
    expect(findProcessSettings).not.toHaveBeenCalled();
    expect(findGazetteSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["hours", { claimWindowHours: "+2", claimWindowMinutes: "0" }, { hoursError: "Enter hours as a whole number from 0 to 24" }, "#claimWindowHours"],
    ["minutes", { claimWindowHours: "1", claimWindowMinutes: "60" }, { minutesError: "Enter minutes as a whole number from 0 to 59" }, "#claimWindowMinutes"],
    [
      "range",
      { claimWindowHours: "24", claimWindowMinutes: "1" },
      { windowError: "The claim window must be between 30 minutes and 24 hours" },
      "#claimWindowHours"
    ],
    [
      "both blank",
      { claimWindowHours: "", claimWindowMinutes: " " },
      { windowError: "Enter how long a judge can hold a claimed referral" },
      "#claimWindowHours"
    ]
  ])("should refuse an invalid %s with no write, keeping the typed text and original revision", async (_name, input, errors, href) => {
    const res = pageResponse();

    await saveProcessSection(request({ body: { ...input, revision: "4" } }), res);

    expect(saveProcessSettings).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).process).toEqual({
      isAvailable: true,
      values: { hours: input.claimWindowHours, minutes: input.claimWindowMinutes, revision: "4" },
      ...errors
    });
    expect(model(res).errorList).toEqual([{ text: Object.values(errors)[0], href }]);
    expect(findProcessSettings).not.toHaveBeenCalled();
    expect(findGazetteSettings).toHaveBeenCalledExactlyOnceWith(CALLER);
  });

  it("should redraw a repeated control empty and refuse it", async () => {
    const res = pageResponse();

    await saveProcessSection(request({ body: { claimWindowHours: ["1", "2"], claimWindowMinutes: "0", revision: "4" } }), res);

    expect(saveProcessSettings).not.toHaveBeenCalled();
    expect(model(res).process.values.hours).toBe("");
    expect(model(res).process.hoursError).toBeDefined();
  });

  it("should require a reload for a missing revision rather than read a fresh one", async () => {
    const res = pageResponse();

    await saveProcessSection(request({ body: { claimWindowHours: "2", claimWindowMinutes: "0" } }), res);

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
    expect(model(res).process).toMatchObject({ values: { hours: " 3 ", minutes: "", revision: "4" }, reloadText: expect.stringContaining("has changed") });
    expect(findProcessSettings).not.toHaveBeenCalled();
    expect(saveProcessSettings).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it.each([
    [[{ field: "referralClaimExpiryMinutes", message: "x" }], { windowError: "The claim window must be between 30 minutes and 24 hours" }],
    [[{ field: "revision", message: "x" }], { reloadText: "Reload the settings before saving" }],
    [[], { reloadText: "The claim window could not be saved. Reload the settings and try again." }]
  ])("should map api's 400 naming %j to its control", async (errors, expected) => {
    vi.mocked(saveProcessSettings).mockRejectedValue(new InvalidInputError("private prose", errors));
    const res = pageResponse();

    await saveProcessSection(request({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(model(res).process).toEqual({ isAvailable: true, values: { hours: " 3 ", minutes: "", revision: "4" }, ...expected });
  });

  it.each([
    ["local validation", () => undefined, { claimWindowHours: "x", claimWindowMinutes: "0", revision: "4" }, 400],
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
