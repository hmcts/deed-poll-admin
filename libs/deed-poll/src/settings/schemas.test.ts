import { PROCESS_SETTINGS_LIMITS } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { PROCESSING_DAYS_LIMITS, processSettingsFormSchema } from "./schemas.js";

const MESSAGES = {
  processingDays: "days",
  reminderIntervalHours: "reminder",
  masterWindowCap: "cap",
  morningWindowStart: "morning start",
  morningWindowEnd: "morning end",
  afternoonWindowStart: "afternoon start",
  afternoonWindowEnd: "afternoon end",
  morningOrder: "morning order",
  windowsOrder: "windows order",
  afternoonOrder: "afternoon order",
  reload: "reload"
};
const schema = processSettingsFormSchema(MESSAGES);
const VALID = {
  processingDays: "7",
  reminderIntervalHours: "48",
  masterWindowCap: "10",
  morningWindowStart: "07:00",
  morningWindowEnd: "10:30",
  afternoonWindowStart: "14:00",
  afternoonWindowEnd: "14:30",
  revision: "3"
};

function issuesFor(body: Record<string, unknown>) {
  const result = schema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("processSettingsFormSchema", () => {
  it("should read every field into api's request, the processing window as days × 1,440 minutes", () => {
    // Arrange
    const body = { ...VALID, processingDays: " 07 ", morningWindowStart: " 07:15 " };

    // Act
    const result = schema.parse(body);

    // Assert
    expect(result).toEqual({
      referralClaimExpiryMinutes: 10080,
      reminderIntervalHours: 48,
      masterWindowCap: 10,
      morningWindowStart: "07:15",
      morningWindowEnd: "10:30",
      afternoonWindowStart: "14:00",
      afternoonWindowEnd: "14:30",
      revision: 3
    });
  });

  it("should take the days bounds from api's minutes", () => {
    expect(PROCESSING_DAYS_LIMITS).toEqual({ min: 1, max: 30 });
    expect(PROCESS_SETTINGS_LIMITS.minProcessingMinutes).toBe(1440);
  });

  it.each([
    ["processingDays", "1", 1440],
    ["processingDays", "30", 43200]
  ])("should accept %s %j at its bound", (field, value, minutes) => {
    expect(schema.parse({ ...VALID, [field]: value }).referralClaimExpiryMinutes).toBe(minutes);
  });

  it.each([
    ["reminderIntervalHours", "1"],
    ["reminderIntervalHours", "168"],
    ["masterWindowCap", "1"],
    ["masterWindowCap", "100"]
  ])("should accept %s %j at its bound", (field, value) => {
    expect(issuesFor({ ...VALID, [field]: value })).toEqual([]);
  });

  const NOT_WHOLE = ["", " ", "+2", "-1", "2.0", "1.5", "1e1", "0x2", "1,000", "١", "２", "12345", ["2"], { value: "2" }, undefined];

  it.each([
    ...[...NOT_WHOLE, "0", "31"].map((value) => ["processingDays", value, "days"] as const),
    ...[...NOT_WHOLE, "0", "169"].map((value) => ["reminderIntervalHours", value, "reminder"] as const),
    ...[...NOT_WHOLE, "0", "101"].map((value) => ["masterWindowCap", value, "cap"] as const)
  ])("should refuse %s %j as its own control's error", (field, value, message) => {
    expect(issuesFor({ ...VALID, [field]: value })).toEqual([{ path: field, message }]);
  });

  it.each(["", "7:00", "07:10", "24:00", "07:00:00", "0700", "07.00", "٠٧:٠٠", ["07:00"], undefined])(
    "should refuse window time %j as that time's error",
    (value) => {
      expect(issuesFor({ ...VALID, afternoonWindowStart: value })).toEqual([{ path: "afternoonWindowStart", message: "afternoon start" }]);
    }
  );

  it.each([
    ["the morning window ends when it starts", { morningWindowEnd: "07:00" }, "morningWindowEnd", "morning order"],
    ["the morning window ends before it starts", { morningWindowStart: "11:00" }, "morningWindowEnd", "morning order"],
    ["the afternoon window starts when the morning one ends", { afternoonWindowStart: "10:30" }, "afternoonWindowStart", "windows order"],
    [
      "the afternoon window starts before the morning one ends",
      { morningWindowEnd: "15:00", afternoonWindowStart: "14:00" },
      "afternoonWindowStart",
      "windows order"
    ],
    ["the afternoon window ends when it starts", { afternoonWindowEnd: "14:00" }, "afternoonWindowEnd", "afternoon order"]
  ])("should refuse the ordering when %s", (_name, change, path, message) => {
    expect(issuesFor({ ...VALID, ...change })).toEqual([{ path, message }]);
  });

  it("should not apply the ordering rule while a time is itself invalid", () => {
    expect(issuesFor({ ...VALID, morningWindowStart: "x", afternoonWindowStart: "10:00" })).toEqual([{ path: "morningWindowStart", message: "morning start" }]);
  });

  it("should report every invalid control at once", () => {
    expect(issuesFor({ ...VALID, processingDays: "x", masterWindowCap: "y" })).toEqual([
      { path: "processingDays", message: "days" },
      { path: "masterWindowCap", message: "cap" }
    ]);
  });

  it.each([undefined, "", "-1", "+1", "01", "1.5", "2147483648", ["0"]])("should refuse revision %j as the reload control's error", (revision) => {
    expect(issuesFor({ ...VALID, revision })).toEqual([{ path: "revision", message: "reload" }]);
  });

  it("should send only api's fields, whatever else is posted", () => {
    const result = schema.parse({ ...VALID, referralClaimExpiryMinutes: "999", updatedBy: "forged", extra: "x" });

    expect(Object.keys(result).sort()).toEqual([
      "afternoonWindowEnd",
      "afternoonWindowStart",
      "masterWindowCap",
      "morningWindowEnd",
      "morningWindowStart",
      "referralClaimExpiryMinutes",
      "reminderIntervalHours",
      "revision"
    ]);
    expect(result.referralClaimExpiryMinutes).toBe(10080);
  });
});
