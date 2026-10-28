import { describe, expect, it } from "vitest";
import { isWeekdayNotIn, windowFor } from "./referral-windows.js";

const TIMES = { morningEnd: "10:30", afternoonEnd: "14:30" };
const HOLIDAYS = new Set(["2026-08-31", "2026-12-25", "2026-12-28", "2027-01-01"]);
const WORKING = isWeekdayNotIn((day) => HOLIDAYS.has(day));

describe("windowFor", () => {
  describe("on a working day in GMT (Wednesday 28 October 2026)", () => {
    it.each([
      ["2026-10-28T00:00:00Z", "2026-10-28", "AM"],
      ["2026-10-28T06:59:00Z", "2026-10-28", "AM"],
      ["2026-10-28T10:29:00Z", "2026-10-28", "AM"],
      ["2026-10-28T10:29:59Z", "2026-10-28", "AM"],
      ["2026-10-28T10:30:00Z", "2026-10-28", "PM"],
      ["2026-10-28T12:00:00Z", "2026-10-28", "PM"],
      ["2026-10-28T14:29:00Z", "2026-10-28", "PM"],
      ["2026-10-28T14:30:00Z", "2026-10-29", "AM"],
      ["2026-10-28T23:59:00Z", "2026-10-29", "AM"]
    ])("should count %s towards %s %s", (at, date, slot) => {
      expect(windowFor(new Date(at), TIMES, WORKING)).toEqual({ date, slot });
    });
  });

  it("should read the boundaries in London time during British Summer Time", () => {
    // 10:29 and 10:30 BST are 09:29 and 09:30 UTC.
    expect(windowFor(new Date("2026-07-15T09:29:00Z"), TIMES, WORKING)).toEqual({ date: "2026-07-15", slot: "AM" });
    expect(windowFor(new Date("2026-07-15T09:30:00Z"), TIMES, WORKING)).toEqual({ date: "2026-07-15", slot: "PM" });
    expect(windowFor(new Date("2026-07-15T13:30:00Z"), TIMES, WORKING)).toEqual({ date: "2026-07-16", slot: "AM" });
  });

  it("should take the London day, not the UTC day, just after midnight in summer", () => {
    // 00:30 BST on Thursday 16 July is 23:30 UTC on the Wednesday.
    expect(windowFor(new Date("2026-07-15T23:30:00Z"), TIMES, WORKING)).toEqual({ date: "2026-07-16", slot: "AM" });
  });

  it("should use each side of both 2026 clock changes", () => {
    // Monday 30 March is the first working day of BST; Monday 26 October the first of GMT.
    expect(windowFor(new Date("2026-03-30T09:29:00Z"), TIMES, WORKING)).toEqual({ date: "2026-03-30", slot: "AM" });
    expect(windowFor(new Date("2026-03-30T09:30:00Z"), TIMES, WORKING)).toEqual({ date: "2026-03-30", slot: "PM" });
    expect(windowFor(new Date("2026-10-26T10:29:00Z"), TIMES, WORKING)).toEqual({ date: "2026-10-26", slot: "AM" });
    expect(windowFor(new Date("2026-10-26T10:30:00Z"), TIMES, WORKING)).toEqual({ date: "2026-10-26", slot: "PM" });
  });

  it("should send a Friday afternoon's close to Monday morning", () => {
    expect(windowFor(new Date("2026-10-30T14:30:00Z"), TIMES, WORKING)).toEqual({ date: "2026-11-02", slot: "AM" });
  });

  it("should send a weekend to the next working day's morning, whatever the time", () => {
    expect(windowFor(new Date("2026-10-31T08:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-11-02", slot: "AM" });
    expect(windowFor(new Date("2026-11-01T12:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-11-02", slot: "AM" });
  });

  it("should treat a bank holiday as a day with no windows", () => {
    expect(windowFor(new Date("2026-08-31T08:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-09-01", slot: "AM" });
  });

  it("should skip the whole Christmas run to the next working day", () => {
    // Thursday 24 December after the afternoon window: Friday and Monday are holidays, so Tuesday 29 December.
    expect(windowFor(new Date("2026-12-24T15:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-12-29", slot: "AM" });
    // Thursday 31 December after hours: Friday 1 January is a holiday, so Monday 4 January.
    expect(windowFor(new Date("2026-12-31T15:00:00Z"), TIMES, WORKING)).toEqual({ date: "2027-01-04", slot: "AM" });
  });

  it("should follow the stored window times rather than the defaults", () => {
    const late = { morningEnd: "12:00", afternoonEnd: "17:00" };
    expect(windowFor(new Date("2026-10-28T11:00:00Z"), late, WORKING)).toEqual({ date: "2026-10-28", slot: "AM" });
    expect(windowFor(new Date("2026-10-28T16:59:00Z"), late, WORKING)).toEqual({ date: "2026-10-28", slot: "PM" });
  });

  it("should refuse a calendar with no working day within a year, as api does", () => {
    expect(() => windowFor(new Date("2026-10-31T08:00:00Z"), TIMES, () => false)).toThrow("No working day within 366 days");
  });
});

describe("isWeekdayNotIn", () => {
  it("should admit a weekday that is not a holiday and refuse weekends and holidays", () => {
    expect(WORKING("2026-10-28")).toBe(true);
    expect(WORKING("2026-10-31")).toBe(false);
    expect(WORKING("2026-11-01")).toBe(false);
    expect(WORKING("2026-12-25")).toBe(false);
  });
});
