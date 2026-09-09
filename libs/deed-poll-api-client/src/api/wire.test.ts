/**
 * The date-time conversion the wire schemas perform.
 *
 * api serialises `LocalDateTime`, so every date-time it publishes is **zoneless** —
 * `2026-03-10T00:00:00` — which `new Date()` reads as LOCAL time. Every date column in this model is
 * date-only in meaning, and both `formatValue` and `daysBetween` read them in UTC: taken as local, a
 * midnight date west of Greenwich renders as the previous day and "days received to enroled" comes out one
 * short. The conversion is the fix, and these are the cases that prove it is applied.
 *
 * Tested here rather than only through the mock so the guarantee does not rest on what format the mock
 * happens to emit — a mock that serialised with `toISOString()` would take the pass-through branch every
 * time and leave the deployed path covered by nothing.
 */
import { describe, expect, it } from "vitest";
import { WIRE_SCHEMAS } from "./wire.js";

const NOTE = { id: "note-1", note: "Text", createdBy: "Someone", modifiedBy: "Someone" };

/** One value through the schema that carries the conversion, as the UTC instant it became. */
function createdOn(value: unknown): string | undefined {
  return WIRE_SCHEMAS.NoteResponse.parse({ ...NOTE, createdOn: value })?.createdOn?.toISOString();
}

describe("the wire date-time conversion", () => {
  it("should read a zoneless date-time as UTC, which is what api means by one", () => {
    expect(createdOn("2026-03-10T00:00:00")).toBe("2026-03-10T00:00:00.000Z");
  });

  it("should read a zoneless date-time carrying milliseconds as UTC too", () => {
    expect(createdOn("2026-03-10T09:30:15.250")).toBe("2026-03-10T09:30:15.250Z");
  });

  it("should read a zoneless date-time with no seconds as UTC, the form Jackson emits for a whole minute", () => {
    expect(createdOn("2026-03-10T00:00")).toBe("2026-03-10T00:00:00.000Z");
  });

  it("should read a bare date as midnight UTC rather than midnight local", () => {
    expect(createdOn("2026-03-10")).toBe("2026-03-10T00:00:00.000Z");
  });

  it("should leave a value carrying Z alone, because it already says which instant it is", () => {
    expect(createdOn("2026-03-10T00:00:00Z")).toBe("2026-03-10T00:00:00.000Z");
  });

  it("should leave a value carrying an offset alone rather than re-reading it as UTC", () => {
    expect(createdOn("2026-03-10T01:00:00+01:00")).toBe("2026-03-10T00:00:00.000Z");
  });

  it("should pass a Date through unchanged, which is what lets a write schema share the read field list", () => {
    expect(createdOn(new Date("2026-03-10T00:00:00Z"))).toBe("2026-03-10T00:00:00.000Z");
  });

  it("should refuse a date-time that is not a date rather than yielding an Invalid Date", () => {
    expect(() => createdOn("not-a-date")).toThrow();
  });
});
