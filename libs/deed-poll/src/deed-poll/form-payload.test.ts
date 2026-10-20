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
    expect(buildUpdatePatch({ retainPermanently: "true" }).retainPermanently).toBe(true);
    expect(buildUpdatePatch({}).retainPermanently).toBe(false);
  });

  describe("a nullable boolean, rendered as Yes / No radios (review finding R07)", () => {
    const IN_PERSON = [FIELD_BY_NAME.inPerson];

    it.each([
      ["true", true],
      ["false", false]
    ])("should send the answer a radio of %s gives", (submitted, expected) => {
      const patch = buildUpdatePatch({ inPerson: submitted }, IN_PERSON);

      expect(patch).toEqual({ inPerson: expected });
    });

    it("should omit it when no radio was selected, so an unanswered question stays unanswered", () => {
      const patch = buildUpdatePatch({}, IN_PERSON);

      expect(patch).not.toHaveProperty("inPerson");
    });
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

    it.each([undefined, "", "   "])("should omit an absent or blank non-nullable number (%j)", (raw) => {
      const patch = buildUpdatePatch({ refundAmount: raw }, [{ ...FIELD_BY_NAME.refundAmount, notNullable: true }]);

      expect(patch).toEqual({});
    });

    it.each([
      ["0", 0],
      [" 25.50 ", 25.5]
    ])("should retain a valid non-nullable number (%s)", (raw, expected) => {
      const patch = buildUpdatePatch({ refundAmount: raw }, [{ ...FIELD_BY_NAME.refundAmount, notNullable: true }]);

      expect(patch).toEqual({ refundAmount: expected });
    });

    it("should ignore malformed read-only numbers and numeric fields outside the submitted tab", () => {
      const patch = buildUpdatePatch({ daysReceivedToEnroled: "invalid", ageOfMinor: "invalid", refundAmount: " 2.50 " }, [
        FIELD_BY_NAME.daysReceivedToEnroled,
        FIELD_BY_NAME.refundAmount
      ]);

      expect(patch).toEqual({ refundAmount: 2.5 });
    });

    it("should preserve the distinct blank and absent behaviour in a mixed-field patch", () => {
      const patch = buildUpdatePatch(
        { newForename: "  Ada  ", newSurname: "", ageOfMinor: "", retainPermanently: "on" },
        ["newForename", "newSurname", "ageOfMinor", "refundAmount", "privacy", "retainPermanently", "iShall"].map((name) => FIELD_BY_NAME[name])
      );

      expect(patch).toEqual({ newForename: "Ada", newSurname: null, ageOfMinor: null, retainPermanently: true, iShall: [] });
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

  describe("fields absent from the body (review finding R02)", () => {
    const FIELDS = ["newForename", "returnReason", "maritalStatus", "dateNoticeSentToLondonGazette", "retainPermanently", "iShall"].map(
      (name) => FIELD_BY_NAME[name]
    );

    it("should omit an absent text, textarea, enum or date field, because a rendered one is always submitted", () => {
      const patch = buildUpdatePatch({}, FIELDS);

      expect(patch).not.toHaveProperty("newForename");
      expect(patch).not.toHaveProperty("returnReason");
      expect(patch).not.toHaveProperty("maritalStatus");
      expect(patch).not.toHaveProperty("dateNoticeSentToLondonGazette");
    });

    it("should still clear a text, textarea, enum or date field submitted empty", () => {
      const body = {
        newForename: "",
        returnReason: "  ",
        maritalStatus: "",
        "dateNoticeSentToLondonGazette-day": "",
        "dateNoticeSentToLondonGazette-month": "",
        "dateNoticeSentToLondonGazette-year": ""
      };

      const patch = buildUpdatePatch(body, FIELDS);

      expect(patch).toMatchObject({ newForename: null, returnReason: null, maritalStatus: null, dateNoticeSentToLondonGazette: null });
    });

    it("should read a date as present when any one of its parts is submitted", () => {
      const patch = buildUpdatePatch({ "dateNoticeSentToLondonGazette-year": "2026" }, FIELDS);

      expect(patch.dateNoticeSentToLondonGazette).toBeNull();
    });

    it("should still read an absent checkbox as unticked, because an unticked one is never submitted", () => {
      const patch = buildUpdatePatch({}, FIELDS);

      expect(patch.retainPermanently).toBe(false);
      expect(patch.iShall).toEqual([]);
    });

    it("should still refuse to clear a notNullable enum submitted empty", () => {
      const patch = buildUpdatePatch({ privacy: "" }, [FIELD_BY_NAME.privacy]);

      expect(patch).not.toHaveProperty("privacy");
    });
  });

  describe("input the rendered form could not have sent (review finding R08)", () => {
    const SHAPED = ["newForename", "maritalStatus", "dateReceived", "inPerson", "retainPermanently", "iShall"].map((name) => FIELD_BY_NAME[name]);

    it.each([
      ["a repeated text field", { newForename: ["Ada", "Eve"] }],
      ["a bracketed text field", { newForename: { first: "Ada" } }],
      ["a repeated select", { maritalStatus: ["Single", "Married"] }],
      ["bracketed date parts", { dateReceived: { day: "1" }, "dateReceived-day": { 0: "1" } }],
      ["a checkbox of TRUE", { retainPermanently: "TRUE" }],
      ["a repeated checkbox", { retainPermanently: ["true"] }],
      ["a Yes / No answer of yes", { inPerson: "yes" }],
      ["multiselect members that only Number() reads", { iShall: ["1e0", "0x2", " 3 ", "", "99"] }],
      ["a multiselect member that is not a number", { iShall: "abc" }],
      ["a multiselect member with a fraction", { iShall: ["1", "2.5"] }],
      ["a multiselect option sent twice", { iShall: ["1", "1"] }]
    ])("should build no patch from %s", (_name, body) => {
      expect(() => buildUpdatePatch(body, SHAPED)).toThrow(InvalidInputError);
    });

    it("should name every malformed field in one refusal", () => {
      try {
        buildUpdatePatch({ newForename: ["a"], iShall: "9", ageOfMinor: "x" }, [...SHAPED, FIELD_BY_NAME.ageOfMinor]);
        expect.unreachable();
      } catch (error) {
        expect((error as InvalidInputError).errors.map((e) => e.field)).toEqual(["newForename", "iShall", "ageOfMinor"]);
      }
    });

    it("should still save every value the rendered form sends exactly as before", () => {
      const patch = buildUpdatePatch(
        {
          newForename: "  Ada  ",
          maritalStatus: "",
          "dateReceived-day": "1",
          "dateReceived-month": "3",
          "dateReceived-year": "2026",
          inPerson: "true",
          retainPermanently: "on",
          iShall: ["1", "5"]
        },
        SHAPED
      );

      expect(patch).toEqual({
        newForename: "Ada",
        maritalStatus: null,
        dateReceived: "2026-03-01T00:00:00.000Z",
        inPerson: true,
        retainPermanently: true,
        iShall: [1, 5]
      });
    });

    it("should read one ticked multiselect option sent as a plain string", () => {
      expect(buildUpdatePatch({ iShall: "4" }, SHAPED).iShall).toEqual([4]);
    });

    it("should still clear a multiselect with nothing ticked", () => {
      expect(buildUpdatePatch({}, SHAPED).iShall).toEqual([]);
    });
  });

  it("ignores read-only/derived fields (state, referencenumber)", () => {
    const patch = buildUpdatePatch({ state: "Enroled", referencenumber: "9" });
    expect(patch).not.toHaveProperty("state");
    expect(patch).not.toHaveProperty("referencenumber");
  });
});
