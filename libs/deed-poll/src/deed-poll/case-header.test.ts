import { describe, expect, it, vi } from "vitest";
import { buildCaseHeader, type CaseHeaderInput, ENTITY_LABEL, formatShortDate, formatTimestamp, NOT_RECORDED } from "./case-header.js";
import { DeedPollState, DeedPollType } from "./enums/option-sets.js";

/** Flatten the header rows to key = value for easy assertions. */
const flatten = (header: ReturnType<typeof buildCaseHeader>) => Object.fromEntries(header.rows.map((r) => [r.key, r.value]));

describe("formatShortDate", () => {
  it("should give the London day as dd-mm-yy, so a time just after midnight BST is not the day before", () => {
    expect(formatShortDate("2026-08-01T23:30:00Z")).toBe("02-08-26");
  });

  it("should give the same day in GMT, when London is on UTC", () => {
    expect(formatShortDate(new Date("2026-10-29T23:30:00Z"))).toBe("29-10-26");
  });

  it("should say not recorded for anything that is not a readable instant", () => {
    expect(formatShortDate("not a date")).toBe(NOT_RECORDED);
    expect(formatShortDate(null)).toBe(NOT_RECORDED);
  });
});

describe("formatTimestamp", () => {
  it("formats a timestamp GOV.UK style with a lowercase meridiem", () => {
    // 09:44 UTC in May is 10:44 British Summer Time.
    expect(formatTimestamp(new Date("2026-05-13T09:44:00Z"))).toBe("13 May 2026 at 10:44am");
  });

  it("renders British Summer Time, not UTC", () => {
    // The regression this guards: a save made at 09:44 local BST is stored as
    // 08:44Z and must read back as 9:44am, not 8:44am.
    expect(formatTimestamp(new Date("2026-05-13T08:44:00Z"))).toBe("13 May 2026 at 9:44am");
  });

  it("renders GMT correctly outside summer time", () => {
    expect(formatTimestamp(new Date("2026-01-13T09:44:00Z"))).toBe("13 January 2026 at 9:44am");
  });

  it("formats an afternoon time as pm", () => {
    expect(formatTimestamp(new Date("2026-01-13T15:05:00Z"))).toBe("13 January 2026 at 3:05pm");
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(formatTimestamp("2026-01-13T15:05:00Z")).toBe("13 January 2026 at 3:05pm");
  });

  it.each([
    ["a number", 2026],
    ["an array containing an ISO string", ["2026-01-13T15:05:00Z"]],
    ["a null-prototype object", Object.create(null) as Record<string, unknown>]
  ])("rejects %s instead of coercing it to a timestamp", (_description, raw) => {
    expect(formatTimestamp(raw)).toBe(NOT_RECORDED);
  });

  it.each(["toString", Symbol.toPrimitive])("does not invoke the timestamp's %s hook", (key) => {
    const coerce = vi.fn(() => "2026-01-13T15:05:00Z");

    expect(formatTimestamp({ [key]: coerce })).toBe(NOT_RECORDED);
    expect(coerce).not.toHaveBeenCalled();
  });

  it.each([null, undefined, "", "not a date"])("renders %p as the placeholder", (raw) => {
    expect(formatTimestamp(raw)).toBe(NOT_RECORDED);
  });
});

describe("buildCaseHeader", () => {
  const record = {
    type: DeedPollType.Adult,
    state: DeedPollState.Received,
    createdBy: "Bence Luo",
    modifiedBy: "# svc_HMCTS_LCPT_Dev",
    modifiedOn: new Date("2026-05-13T08:44:00Z")
  };

  it("reproduces every field from the Dynamics header", () => {
    expect(flatten(buildCaseHeader(record))).toEqual({
      Type: "Adult",
      Status: "Received",
      "Modified By": "# svc_HMCTS_LCPT_Dev",
      "Modified On": "13 May 2026 at 9:44am",
      "Created By": "Bence Luo"
    });
  });

  it("captions the record with the entity name", () => {
    expect(buildCaseHeader(record).entityLabel).toBe(ENTITY_LABEL);
  });

  it("marks only State as a tag", () => {
    const tagged = buildCaseHeader(record)
      .rows.filter((r) => r.tag)
      .map((r) => r.key);
    expect(tagged).toEqual(["Status"]);
  });

  it("labels enums rather than leaking member names", () => {
    const header = flatten(
      buildCaseHeader({
        ...record,
        type: DeedPollType.AdultTransgender,
        state: DeedPollState.AwaitingFurtherDocs
      })
    );
    expect(header.Type).toBe("Adult Transgender");
    expect(header.Status).toBe("Awaiting Further Docs/Info");
  });

  it.each(["constructor", "toString", "__proto__"])("keeps an unmapped enum name %s as text", (value) => {
    const input: unknown = { type: value, state: value };
    const header = flatten(buildCaseHeader(input as CaseHeaderInput));

    expect(header.Type).toBe(value);
    expect(header.Status).toBe(value);
  });

  it("keeps the text fallback for an unknown enum member", () => {
    const input: unknown = { type: "FutureType", state: "FutureState" };
    const header = flatten(buildCaseHeader(input as CaseHeaderInput));

    expect(header.Type).toBe("FutureType");
    expect(header.Status).toBe("FutureState");
  });

  it.each([
    ["an object", {}],
    ["an array", ["Adult"]],
    ["a null-prototype object", Object.create(null) as Record<string, unknown>]
  ])("renders an unsupported enum value (%s) as unrecorded", (_description, value) => {
    // Deliberately malformed runtime input; the normal API schema rejects these shapes.
    const input: unknown = { type: value, state: value };
    const header = flatten(buildCaseHeader(input as CaseHeaderInput));

    expect(header.Type).toBe(NOT_RECORDED);
    expect(header.Status).toBe(NOT_RECORDED);
  });

  it("does not invoke enum conversion hooks", () => {
    const coerce = vi.fn(() => "Adult");
    const input: unknown = { type: { [Symbol.toPrimitive]: coerce }, state: { toString: coerce } };
    const header = flatten(buildCaseHeader(input as CaseHeaderInput));

    expect(header.Type).toBe(NOT_RECORDED);
    expect(header.Status).toBe(NOT_RECORDED);
    expect(coerce).not.toHaveBeenCalled();
  });

  it("renders a row predating the audit columns as Not recorded", () => {
    // The backward-compatibility case: rows created before createdBy/modifiedBy
    // existed have null in both, and must not render "null" or an empty cell.
    const header = flatten(buildCaseHeader({ ...record, createdBy: null, modifiedBy: null }));
    expect(header["Created By"]).toBe(NOT_RECORDED);
    expect(header["Modified By"]).toBe(NOT_RECORDED);
  });

  it("treats a whitespace-only author as unrecorded", () => {
    const header = flatten(buildCaseHeader({ ...record, createdBy: "   " }));
    expect(header["Created By"]).toBe(NOT_RECORDED);
  });

  it("keeps all five rows even when nothing is populated", () => {
    // The header is a fixed set of facts: rows must not appear and disappear per
    // case the way the tab sections' optional fields do.
    const header = buildCaseHeader({});
    expect(header.rows.map((r) => r.key)).toEqual(["Type", "Status", "Modified By", "Modified On", "Created By"]);
    expect(header.rows.every((r) => r.value === NOT_RECORDED)).toBe(true);
  });
});
