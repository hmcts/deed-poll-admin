import { describe, expect, it } from "vitest";
import { closesAt, isWeekdayNotIn, londonDay, nextToOpen, openAt, opensAt } from "./referral-windows.js";

const TIMES = { morningStart: "07:00", morningEnd: "10:30", afternoonStart: "14:00", afternoonEnd: "14:30" };
const HOLIDAYS = new Set(["2026-08-31", "2026-12-25", "2026-12-28", "2027-01-01"]);
const WORKING = isWeekdayNotIn((day) => HOLIDAYS.has(day));

describe("openAt", () => {
  describe("on a working day in GMT (Wednesday 28 October 2026)", () => {
    it.each([
      ["2026-10-28T06:59:59Z", null],
      ["2026-10-28T07:00:00Z", "AM"],
      ["2026-10-28T10:29:59Z", "AM"],
      ["2026-10-28T10:30:00Z", null],
      ["2026-10-28T13:59:59Z", null],
      ["2026-10-28T14:00:00Z", "PM"],
      ["2026-10-28T14:29:00Z", "PM"],
      ["2026-10-28T14:30:00Z", null],
      ["2026-10-28T23:59:00Z", null]
    ])("should find %s in window %s", (at, slot) => {
      expect(openAt(new Date(at), TIMES, WORKING)).toEqual(slot === null ? null : { date: "2026-10-28", slot });
    });
  });

  it("should read the boundaries in London time during British Summer Time", () => {
    // 07:00 and 10:30 BST are 06:00 and 09:30 UTC.
    expect(openAt(new Date("2026-07-15T05:59:00Z"), TIMES, WORKING)).toBeNull();
    expect(openAt(new Date("2026-07-15T06:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-07-15", slot: "AM" });
    expect(openAt(new Date("2026-07-15T09:30:00Z"), TIMES, WORKING)).toBeNull();
    expect(openAt(new Date("2026-07-15T13:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-07-15", slot: "PM" });
  });

  it("should use each side of both 2026 clock changes", () => {
    // Monday 30 March is the first working day of BST; Monday 26 October the first of GMT.
    expect(openAt(new Date("2026-03-30T06:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-03-30", slot: "AM" });
    expect(openAt(new Date("2026-03-30T09:30:00Z"), TIMES, WORKING)).toBeNull();
    expect(openAt(new Date("2026-10-26T06:59:00Z"), TIMES, WORKING)).toBeNull();
    expect(openAt(new Date("2026-10-26T07:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-10-26", slot: "AM" });
  });

  it("should open no window at a weekend or on a bank holiday, whatever the time", () => {
    expect(openAt(new Date("2026-10-31T08:00:00Z"), TIMES, WORKING)).toBeNull();
    expect(openAt(new Date("2026-11-01T14:10:00Z"), TIMES, WORKING)).toBeNull();
    expect(openAt(new Date("2026-08-31T08:00:00Z"), TIMES, WORKING)).toBeNull();
  });

  it("should follow the stored window times rather than the defaults", () => {
    const late = { morningStart: "09:00", morningEnd: "12:00", afternoonStart: "15:00", afternoonEnd: "17:00" };
    expect(openAt(new Date("2026-10-28T08:00:00Z"), late, WORKING)).toBeNull();
    expect(openAt(new Date("2026-10-28T11:00:00Z"), late, WORKING)).toEqual({ date: "2026-10-28", slot: "AM" });
    expect(openAt(new Date("2026-10-28T16:59:00Z"), late, WORKING)).toEqual({ date: "2026-10-28", slot: "PM" });
  });
});

describe("nextToOpen", () => {
  it.each([
    ["2026-10-28T06:59:00Z", "2026-10-28", "AM"],
    // Inside a window, its successor.
    ["2026-10-28T07:00:00Z", "2026-10-28", "PM"],
    ["2026-10-28T12:00:00Z", "2026-10-28", "PM"],
    ["2026-10-28T14:00:00Z", "2026-10-29", "AM"],
    ["2026-10-28T20:00:00Z", "2026-10-29", "AM"]
  ])("should answer %s with %s %s", (at, date, slot) => {
    expect(nextToOpen(new Date(at), TIMES, WORKING)).toEqual({ date, slot });
  });

  it("should send a Friday afternoon to Monday morning, and a weekend morning too", () => {
    expect(nextToOpen(new Date("2026-10-30T14:10:00Z"), TIMES, WORKING)).toEqual({ date: "2026-11-02", slot: "AM" });
    expect(nextToOpen(new Date("2026-10-31T06:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-11-02", slot: "AM" });
  });

  it("should skip the whole Christmas run to the next working day", () => {
    expect(nextToOpen(new Date("2026-12-24T15:00:00Z"), TIMES, WORKING)).toEqual({ date: "2026-12-29", slot: "AM" });
    expect(nextToOpen(new Date("2026-12-31T15:00:00Z"), TIMES, WORKING)).toEqual({ date: "2027-01-04", slot: "AM" });
  });

  it("should refuse a calendar with no working day within a year, as api does", () => {
    expect(() => nextToOpen(new Date("2026-10-31T08:00:00Z"), TIMES, () => false)).toThrow("No working day within 366 days");
  });
});

describe("opensAt and closesAt", () => {
  it("should place a window's times in London, in GMT and in BST", () => {
    expect(opensAt({ date: "2026-10-28", slot: "PM" }, TIMES).toISOString()).toBe("2026-10-28T14:00:00.000Z");
    expect(closesAt({ date: "2026-10-28", slot: "AM" }, TIMES).toISOString()).toBe("2026-10-28T10:30:00.000Z");
    expect(opensAt({ date: "2026-07-15", slot: "AM" }, TIMES).toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(closesAt({ date: "2026-07-15", slot: "PM" }, TIMES).toISOString()).toBe("2026-07-15T13:30:00.000Z");
  });

  it("should take the offset of the day itself on both clock-change days", () => {
    expect(opensAt({ date: "2026-03-29", slot: "AM" }, TIMES).toISOString()).toBe("2026-03-29T06:00:00.000Z");
    expect(opensAt({ date: "2026-10-25", slot: "AM" }, TIMES).toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });
});

describe("londonDay", () => {
  it("should take the London day, not the UTC day, just after midnight in summer", () => {
    expect(londonDay(new Date("2026-07-15T23:30:00Z"))).toBe("2026-07-16");
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
