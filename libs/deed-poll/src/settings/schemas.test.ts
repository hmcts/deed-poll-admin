import { describe, expect, it } from "vitest";
import { processSettingsFormSchema } from "./schemas.js";

const MESSAGES = { hours: "hours", minutes: "minutes", required: "required", range: "range", reload: "reload" };
const schema = processSettingsFormSchema(MESSAGES);

function issuesFor(body: Record<string, unknown>) {
  const result = schema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("processSettingsFormSchema", () => {
  it.each([
    ["0", "30", 30],
    ["0", "29", null],
    ["24", "0", 1440],
    ["24", "1", null],
    ["2", "0", 120],
    ["", "45", 45],
    ["1", "", 60],
    [" 2 ", "0", 120],
    ["0024", "00", 1440]
  ])("should read %j hours and %j minutes as %j minutes", (hours, minutes, expected) => {
    // Arrange
    const body = { claimWindowHours: hours, claimWindowMinutes: minutes, revision: "3" };

    // Act
    const result = schema.safeParse(body);

    // Assert
    if (expected === null) {
      expect(result.success).toBe(false);
      expect(issuesFor(body)).toEqual([{ path: "claimWindow", message: "range" }]);
    } else {
      expect(result.success && result.data).toEqual({ referralClaimExpiryMinutes: expected, revision: 3 });
    }
  });

  it("should accept 1,440 minutes and refuse 1,441 as a total", () => {
    expect(issuesFor({ claimWindowHours: "23", claimWindowMinutes: "59", revision: "0" })).toEqual([]);
    expect(issuesFor({ claimWindowHours: "24", claimWindowMinutes: "1", revision: "0" })).toEqual([{ path: "claimWindow", message: "range" }]);
  });

  it("should refuse both controls blank as the fieldset's error", () => {
    expect(issuesFor({ claimWindowHours: " ", claimWindowMinutes: "", revision: "0" })).toEqual([{ path: "claimWindow", message: "required" }]);
  });

  it.each(["+2", "-1", "2.0", "1.5", "1e1", "0x2", "1,000", "١", "２", "25", "12345", ["2"], { value: "2" }, undefined])(
    "should refuse hours %j as the hours input's error",
    (hours) => {
      expect(issuesFor({ claimWindowHours: hours, claimWindowMinutes: "0", revision: "0" })).toEqual([{ path: "claimWindowHours", message: "hours" }]);
    }
  );

  it.each(["+2", "-1", "2.0", "1.5", "1e1", "0x2", "1,000", "١", "60", ["30"], { value: "30" }, undefined])(
    "should refuse minutes %j as the minutes input's error",
    (minutes) => {
      expect(issuesFor({ claimWindowHours: "1", claimWindowMinutes: minutes, revision: "0" })).toEqual([{ path: "claimWindowMinutes", message: "minutes" }]);
    }
  );

  it("should report both inputs and not the total when both are invalid", () => {
    expect(issuesFor({ claimWindowHours: "x", claimWindowMinutes: "y", revision: "0" })).toEqual([
      { path: "claimWindowHours", message: "hours" },
      { path: "claimWindowMinutes", message: "minutes" }
    ]);
  });

  it.each([undefined, "", "-1", "+1", "01", "1.5", "2147483648", ["0"]])("should refuse revision %j as the reload control's error", (revision) => {
    expect(issuesFor({ claimWindowHours: "2", claimWindowMinutes: "0", revision })).toEqual([{ path: "revision", message: "reload" }]);
  });

  it("should send only the total and the revision, whatever else is posted", () => {
    const result = schema.parse({ claimWindowHours: "1", claimWindowMinutes: "30", revision: "7", referralClaimExpiryMinutes: "999", extra: "x" });

    expect(result).toEqual({ referralClaimExpiryMinutes: 90, revision: 7 });
  });
});
