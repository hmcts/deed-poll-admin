import { describe, expect, it } from "vitest";
import { FIELD_BY_NAME, type FieldDef } from "./form-fields.js";
import { collectDateErrors, collectFormErrors, collectNumericErrors } from "./form-validation.js";

const DATES: FieldDef[] = [
  { name: "signatureRequestedDate", label: "Signature requested date", kind: "date" },
  { name: "signatureReceivedDate", label: "Signature received date", kind: "date" }
];

const parts = (name: string, day: string, month: string, year: string) => ({
  [`${name}-day`]: day,
  [`${name}-month`]: month,
  [`${name}-year`]: year
});

describe("collectDateErrors", () => {
  it("accepts a complete real date", () => {
    const errors = collectDateErrors(parts("signatureRequestedDate", "3", "8", "2026"), DATES);
    expect(errors).toEqual([]);
  });

  it("accepts all three parts blank as a deliberate clear", () => {
    // The clear path must stay open: blanking a signature date is how a caseworker
    // walks a case back, and it is what un-derives the state.
    const errors = collectDateErrors(parts("signatureRequestedDate", "", "", ""), DATES);
    expect(errors).toEqual([]);
  });

  it("rejects a partial date and names the missing parts", () => {
    // Regression: a day with no month or year was silently stored as null, so the
    // page read back "not entered" and the caseworker had no idea the save dropped it.
    const errors = collectDateErrors(parts("signatureRequestedDate", "3", "", ""), DATES);
    expect(errors).toEqual([
      {
        field: "signatureRequestedDate",
        message: "Signature requested date must include a month and year"
      }
    ]);
  });

  it("rejects garbage parts", () => {
    const errors = collectDateErrors(parts("signatureRequestedDate", "99", "99", "abcd"), DATES);
    expect(errors).toEqual([
      {
        field: "signatureRequestedDate",
        message: "Signature requested date must be a real date"
      }
    ]);
  });

  it("rejects a date that would roll over rather than storing the rolled value", () => {
    // Date.UTC(2026, 12, 32) is 2027-02-01. Storing that for "32/13/2026" turns a
    // typo into plausible-looking data on the wrong side of a year boundary.
    const errors = collectDateErrors(parts("signatureRequestedDate", "32", "13", "2026"), DATES);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("must be a real date");
  });

  it("rejects 31 February", () => {
    const errors = collectDateErrors(parts("signatureRequestedDate", "31", "2", "2026"), DATES);
    expect(errors).toHaveLength(1);
  });

  it("rejects a two-digit year", () => {
    // Date.UTC(26, …) is 1926. Nobody typing "26" means 1926, and a case dated
    // 1926 sorts and filters as garbage rather than announcing itself.
    const errors = collectDateErrors(parts("signatureRequestedDate", "1", "1", "26"), DATES);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("must be a real date");
  });

  it("reports each bad date field separately", () => {
    const errors = collectDateErrors(
      {
        ...parts("signatureRequestedDate", "1", "", ""),
        ...parts("signatureReceivedDate", "99", "99", "9999")
      },
      DATES
    );
    expect(errors.map((e) => e.field)).toEqual(["signatureRequestedDate", "signatureReceivedDate"]);
  });

  it("ignores non-date and read-only fields", () => {
    const fields: FieldDef[] = [
      { name: "returnReason", label: "Return reason", kind: "textarea" },
      { name: "dateOfApplication", label: "Date of application", kind: "date", readOnly: true }
    ];
    const errors = collectDateErrors({ returnReason: "x", ...parts("dateOfApplication", "99", "99", "x") }, fields);
    expect(errors).toEqual([]);
  });
});

const NUMBERS: FieldDef[] = [
  { name: "ageOfMinor", label: "Age of minor years", kind: "number", numberFormat: "integer" },
  { name: "refundAmount", label: "Refund amount", kind: "number" }
];

describe("collectNumericErrors", () => {
  it("should name each field whose text is not a number of its format", () => {
    const errors = collectNumericErrors({ ageOfMinor: "7.5", refundAmount: "£25.00" }, NUMBERS);

    expect(errors).toEqual([
      { field: "ageOfMinor", message: "Age of minor years must be a whole number" },
      { field: "refundAmount", message: "Refund amount must be a number" }
    ]);
  });

  it("should accept blank, absent and valid values, zero included", () => {
    expect(collectNumericErrors({ ageOfMinor: "0", refundAmount: "  " }, NUMBERS)).toEqual([]);
    expect(collectNumericErrors({}, NUMBERS)).toEqual([]);
  });

  it("should ignore read-only and non-number fields, which are never patched", () => {
    const fields: FieldDef[] = [
      { name: "referencenumber", label: "Reference", kind: "number", readOnly: true },
      { name: "newSurname", label: "New surname", kind: "text" }
    ];

    expect(collectNumericErrors({ referencenumber: "x", newSurname: "12x" }, fields)).toEqual([]);
  });
});

describe("collectFormErrors", () => {
  it("should report date and number errors together in the order the fields render", () => {
    const fields: FieldDef[] = [DATES[0], NUMBERS[1], DATES[1]];

    const errors = collectFormErrors(
      { ...parts("signatureRequestedDate", "3", "", ""), refundAmount: "12x", ...parts("signatureReceivedDate", "31", "2", "2026") },
      fields
    );

    expect(errors.map((error) => error.field)).toEqual(["signatureRequestedDate", "refundAmount", "signatureReceivedDate"]);
  });

  it("should be empty for a clean body", () => {
    expect(collectFormErrors({ refundAmount: "10", ...parts("signatureRequestedDate", "", "", "") }, [...DATES, ...NUMBERS])).toEqual([]);
  });
});

describe("input the rendered form could not have sent (review finding R08)", () => {
  const SHAPED = ["newForename", "returnReason", "maritalStatus", "dateReceived", "inPerson", "retainPermanently", "iShall"].map((name) => FIELD_BY_NAME[name]);

  it.each([
    ["an array in a text field", { newForename: ["Ada", "Eve"] }, "newForename", "Enter a single value for New forename"],
    ["an object in a text field", { newForename: { first: "Ada" } }, "newForename", "Enter a single value for New forename"],
    ["an array in a textarea", { returnReason: ["a", "b"] }, "returnReason", "Enter a single value for Return reason"],
    ["an array in a select", { maritalStatus: ["Single", "Married"] }, "maritalStatus", "Enter a single value for Marital status"],
    [
      "an array in a date part",
      { "dateReceived-day": ["1", "2"], "dateReceived-month": "3", "dateReceived-year": "2026" },
      "dateReceived",
      "Enter a single value for Date received"
    ],
    ["an object in a date part", { "dateReceived-day": { a: "1" } }, "dateReceived", "Enter a single value for Date received"],
    ["an array in a checkbox", { retainPermanently: ["true"] }, "retainPermanently", "Select a valid answer for Retain permanently"],
    ["a checkbox value the form never renders", { retainPermanently: "TRUE" }, "retainPermanently", "Select a valid answer for Retain permanently"],
    ["a Yes / No answer the form never renders", { inPerson: "yes" }, "inPerson", "Select a valid answer for In person"],
    ["an array in a Yes / No answer", { inPerson: ["true", "false"] }, "inPerson", "Select a valid answer for In person"]
  ])("should refuse %s", (_name, body, field, message) => {
    const errors = collectFormErrors(body, SHAPED);

    expect(errors).toEqual([{ field, message }]);
  });

  it.each([["1e0"], ["0x2"], [" 3 "], [""], ["2.5"], ["abc"], ["99"], ["0"]])("should refuse a multiselect member of %j", (member) => {
    const errors = collectFormErrors({ iShall: ["1", member] }, SHAPED);

    expect(errors).toEqual([{ field: "iShall", message: "Select only options from the list for I shall" }]);
  });

  it("should refuse a multiselect member that is not a string", () => {
    expect(collectFormErrors({ iShall: { 0: "1" } }, SHAPED)).toHaveLength(1);
    expect(collectFormErrors({ iShall: [["1"]] }, SHAPED)).toHaveLength(1);
  });

  it("should report one error for a date whose part is malformed, not a shape error and a missing-part error", () => {
    const errors = collectDateErrors({ "dateReceived-day": ["1"] }, [FIELD_BY_NAME.dateReceived]);

    expect(errors).toEqual([{ field: "dateReceived", message: "Enter a single value for Date received" }]);
  });

  it("should accept every value the rendered form sends", () => {
    const body = {
      newForename: "  Ada  ",
      returnReason: "",
      maritalStatus: "Single",
      "dateReceived-day": "1",
      "dateReceived-month": "3",
      "dateReceived-year": "2026",
      inPerson: "false",
      retainPermanently: "on",
      iShall: ["1", "5"]
    };

    expect(collectFormErrors(body, SHAPED)).toEqual([]);
    expect(collectFormErrors({ retainPermanently: "true", iShall: "4" }, SHAPED)).toEqual([]);
    expect(collectFormErrors({}, SHAPED)).toEqual([]);
  });

  it("should report shape errors in field order beside date and number errors", () => {
    const errors = collectFormErrors({ newForename: ["a"], "dateReceived-day": "3", iShall: "9", ageOfMinor: "x" }, [...SHAPED, FIELD_BY_NAME.ageOfMinor]);

    expect(errors.map((error) => error.field)).toEqual(["newForename", "dateReceived", "iShall", "ageOfMinor"]);
  });

  it("should ignore read-only fields whatever they carry", () => {
    const fields: FieldDef[] = [{ name: "displayReference", label: "Display reference", kind: "text", readOnly: true }];

    expect(collectFormErrors({ displayReference: ["a", "b"] }, fields)).toEqual([]);
  });
});
