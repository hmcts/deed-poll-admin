import { describe, expect, it } from "vitest";
import { InvalidInputError } from "../errors.js";
import { FIELD_BY_NAME } from "./form-fields.js";
import { buildUpdatePatch } from "./form-payload.js";

const NUMBER_FIELDS = ["ageOfMinor", "ageOfMinorMonths", "refundAmount"].map((name) => FIELD_BY_NAME[name]);

function rejectionOf(body: Record<string, unknown>): InvalidInputError {
  try {
    buildUpdatePatch(body, NUMBER_FIELDS);
  } catch (error) {
    if (error instanceof InvalidInputError) return error;
    throw error;
  }
  throw new Error("buildUpdatePatch built a patch from invalid numeric input");
}

describe("buildUpdatePatch", () => {
  it("composes GOV.UK date parts into an ISO string", () => {
    const patch = buildUpdatePatch({
      "dateReceived-day": "15",
      "dateReceived-month": "3",
      "dateReceived-year": "2026"
    });
    expect(patch.dateReceived).toBe("2026-03-15T00:00:00.000Z");
  });

  it("nulls an incomplete or empty date", () => {
    const patch = buildUpdatePatch({ "dateReceived-day": "15" });
    expect(patch.dateReceived).toBeNull();
  });

  it("treats a present checkbox as true and an absent one as false", () => {
    const patch = buildUpdatePatch({ inPerson: "true" });
    expect(patch.inPerson).toBe(true);
    expect(patch.retainPermanently).toBe(false);
  });

  it("parses number fields and nulls blanks", () => {
    const patch = buildUpdatePatch({ ageOfMinor: "7", ageOfMinorMonths: "" });
    expect(patch.ageOfMinor).toBe(7);
    expect(patch.ageOfMinorMonths).toBeNull();
  });

  describe("number fields", () => {
    it("should keep zero, decimal amounts and integer ages exactly as typed", () => {
      const patch = buildUpdatePatch({ ageOfMinor: "0", ageOfMinorMonths: " 11 ", refundAmount: "25.50" }, NUMBER_FIELDS);

      expect(patch).toEqual({ ageOfMinor: 0, ageOfMinorMonths: 11, refundAmount: 25.5 });
    });

    it("should clear a nullable number submitted blank or whitespace-only", () => {
      const patch = buildUpdatePatch({ ageOfMinor: "", ageOfMinorMonths: "   ", refundAmount: "" }, NUMBER_FIELDS);

      expect(patch).toEqual({ ageOfMinor: null, ageOfMinorMonths: null, refundAmount: null });
    });

    it("should omit a number field absent from the body rather than clearing it", () => {
      const patch = buildUpdatePatch({ refundAmount: "10" }, NUMBER_FIELDS);

      expect(patch).toEqual({ refundAmount: 10 });
    });

    it("should leave a read-only number out even when the body carries one", () => {
      const patch = buildUpdatePatch({ referencenumber: "9", daysReceivedToEnroled: "4", refundAmount: "1" }, [
        FIELD_BY_NAME.referencenumber,
        FIELD_BY_NAME.daysReceivedToEnroled,
        FIELD_BY_NAME.refundAmount
      ]);

      expect(patch).toEqual({ refundAmount: 1 });
    });

    it.each([
      ["a typo", "12x"],
      ["a currency symbol", "£25.00"],
      ["an overflow", "1e999"],
      ["NaN", "NaN"],
      ["Infinity", "Infinity"],
      ["a duplicated field", ["10", "20"]],
      ["an object", { amount: "10" }]
    ])("should refuse %s instead of building a patch that clears the field", (_name, raw) => {
      const error = rejectionOf({ refundAmount: raw });

      expect(error.errors).toEqual([{ field: "refundAmount", message: "Refund amount must be a number" }]);
    });

    it("should refuse a fraction in an integer field rather than rounding it", () => {
      const error = rejectionOf({ ageOfMinor: "7.5", refundAmount: "7.5" });

      expect(error.errors).toEqual([{ field: "ageOfMinor", message: "Age of minor years must be a whole number" }]);
    });

    it("should refuse an integer beyond int32 rather than sending one api cannot hold", () => {
      const error = rejectionOf({ ageOfMinorMonths: "9007199254740993" });

      expect(error.errors).toEqual([{ field: "ageOfMinorMonths", message: "Age of minor months must be a whole number" }]);
    });

    it("should name every invalid number field in one refusal, so one save shows them all", () => {
      const error = rejectionOf({ ageOfMinor: "x", ageOfMinorMonths: "3", refundAmount: "£1" });

      expect(error.errors.map((fieldError) => fieldError.field)).toEqual(["ageOfMinor", "refundAmount"]);
    });

    it("should refuse the whole patch when one number is invalid, so valid fields beside it are not written alone", () => {
      expect(() => buildUpdatePatch({ newForename: "Ada", refundAmount: "12x" })).toThrow(InvalidInputError);
    });

    it("should never put a non-finite number or a clearing null in a patch from non-blank text", () => {
      const patch = buildUpdatePatch({ ageOfMinor: "2147483647", refundAmount: "0.1" }, NUMBER_FIELDS);
      const values = Object.values(patch) as number[];

      expect(values.every(Number.isFinite)).toBe(true);
      expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
    });
  });

  it("collects multi-checkbox values into an int array", () => {
    const patch = buildUpdatePatch({ iShall: ["1", "4"] });
    expect(patch.iShall).toEqual([1, 4]);
  });

  it("trims text and nulls empty strings", () => {
    const patch = buildUpdatePatch({ newForename: "  Alex  ", newSurname: "" });
    expect(patch.newForename).toBe("Alex");
    expect(patch.newSurname).toBeNull();
  });

  it("omits a non-nullable enum that is absent from the body", () => {
    // Regression: `privacy` renders `disabled` for a non-admin, and browsers do not
    // submit a disabled control. Nulling it wrote null to a NOT NULL column, so a
    // non-admin saving the Application tab got a 500. Absent must mean "leave alone",
    // NOT "clear" — the blank-means-clear rule only holds for nullable columns.
    const patch = buildUpdatePatch({ newForename: "Ada" });
    expect(patch).not.toHaveProperty("privacy");
    expect(patch).not.toHaveProperty("urgency");
  });

  it("still writes a non-nullable enum that IS submitted", () => {
    const patch = buildUpdatePatch({ privacy: "Private" });
    expect(patch.privacy).toBe("Private");
  });

  it("still clears a nullable field submitted blank", () => {
    // The counterpart: the blank-means-clear behaviour must survive for nullable
    // columns, or clearing dateEnroled would stop un-enrolling a case.
    const patch = buildUpdatePatch({ urgencyreason: "" });
    expect(patch.urgencyreason).toBeNull();
  });

  it("ignores read-only/derived fields (state, referencenumber)", () => {
    const patch = buildUpdatePatch({ state: "Enroled", referencenumber: "9" });
    expect(patch).not.toHaveProperty("state");
    expect(patch).not.toHaveProperty("referencenumber");
  });
});
