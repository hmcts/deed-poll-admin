import { PROCESS_SETTINGS_LIMITS } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { bankHolidayFormSchema, masterChangeFormSchema, masterFormSchema, PROCESSING_DAYS_LIMITS, processSettingsFormSchema } from "./schemas.js";

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
      windowCap: 10,
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
      "morningWindowEnd",
      "morningWindowStart",
      "referralClaimExpiryMinutes",
      "reminderIntervalHours",
      "revision",
      "windowCap"
    ]);
    expect(result.referralClaimExpiryMinutes).toBe(10080);
  });
});

describe("masterFormSchema", () => {
  const masterSchema = masterFormSchema({ name: "name", email: "email" });

  function masterIssues(body: Record<string, unknown>) {
    const result = masterSchema.safeParse(body);
    return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  }

  it("should read a trimmed name and email into api's request, leaving available to api's default", () => {
    // Arrange
    const body = { name: "  Master Wren ", email: " wren@example.test " };

    // Act
    const result = masterSchema.parse(body);

    // Assert
    expect(result).toEqual({ name: "Master Wren", email: "wren@example.test" });
  });

  it("should accept a name and an email at api's bounds", () => {
    expect(masterIssues({ name: "n".repeat(200), email: `${"a".repeat(307)}@example.test` })).toEqual([]);
  });

  it.each(["", "   ", "n".repeat(201), ["Master"], undefined])("should refuse name %j as the name's error", (name) => {
    expect(masterIssues({ name, email: "wren@example.test" })).toEqual([{ path: "name", message: "name" }]);
  });

  it.each([
    "",
    "wren",
    "wren@",
    "@example.test",
    "wren@@example.test",
    "wr en@example.test",
    `${"a".repeat(308)}@example.test`,
    ["wren@example.test"],
    undefined
  ])("should refuse email %j as the email's error", (email) => {
    expect(masterIssues({ name: "Master Wren", email })).toEqual([{ path: "email", message: "email" }]);
  });
});

describe("masterChangeFormSchema", () => {
  const changeSchema = masterChangeFormSchema({ name: "name", email: "email", available: "available", reload: "reload" });
  const CHANGE = { name: "Master Wren", email: "wren@example.test", available: "false", revision: "2" };

  it("should read every field, available as a boolean and the revision as a number", () => {
    expect(changeSchema.parse(CHANGE)).toEqual({ name: "Master Wren", email: "wren@example.test", available: false, revision: 2 });
    expect(changeSchema.parse({ ...CHANGE, available: "true" }).available).toBe(true);
  });

  it.each(["", "on", "TRUE", ["true"], undefined])("should refuse available %j as its own error", (available) => {
    const result = changeSchema.safeParse({ ...CHANGE, available });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([["available", "available"]]);
  });

  it.each(["", "-1", "01", "2.0", "2147483648", undefined])("should refuse revision %j as a reload", (revision) => {
    const result = changeSchema.safeParse({ ...CHANGE, revision });

    expect(result.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([["revision", "reload"]]);
  });
});

describe("bankHolidayFormSchema", () => {
  const holidaySchema = bankHolidayFormSchema({ date: "date", name: "name" });
  const HOLIDAY = { "date-day": "1", "date-month": "1", "date-year": "2029", name: "New Year's Day" };

  function holidayIssues(body: Record<string, unknown>) {
    const result = holidaySchema.safeParse(body);
    return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  }

  it("should read the three date parts as api's yyyy-MM-dd and trim the name", () => {
    expect(holidaySchema.parse({ ...HOLIDAY, "date-day": " 01 ", name: "  New Year's Day " })).toEqual({ date: "2029-01-01", name: "New Year's Day" });
  });

  it("should accept a leap day in a leap year", () => {
    expect(holidaySchema.parse({ ...HOLIDAY, "date-day": "29", "date-month": "2", "date-year": "2028" }).date).toBe("2028-02-29");
  });

  it.each([
    ["date-day", ""],
    ["date-day", "32"],
    ["date-day", "1.0"],
    ["date-day", "١"],
    ["date-month", "13"],
    ["date-month", "0"],
    ["date-year", "29"],
    ["date-year", "20290"],
    ["date-day", ["1"]]
  ])("should refuse %s %j as the date's error", (part, value) => {
    expect(holidayIssues({ ...HOLIDAY, [part]: value })).toEqual([{ path: "date", message: "date" }]);
  });

  it("should refuse a day the month does not have", () => {
    expect(holidayIssues({ ...HOLIDAY, "date-day": "29", "date-month": "2", "date-year": "2029" })).toEqual([{ path: "date", message: "date" }]);
  });

  it.each(["", "  ", "n".repeat(201), undefined])("should refuse name %j as the name's error", (name) => {
    expect(holidayIssues({ ...HOLIDAY, name })).toEqual([{ path: "name", message: "name" }]);
  });
});
