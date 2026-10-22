import { describe, expect, it } from "vitest";
import { FIELD_BY_NAME, type FieldDef, TEXTAREA_MAX_LENGTH } from "./form-fields.js";
import { collectDateErrors, collectFormErrors } from "./form-validation.js";

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

describe("collectFormErrors on number fields", () => {
  it("should name each field whose text is not a number of its format", () => {
    const errors = collectFormErrors({ ageOfMinor: "7.5", refundAmount: "£25.00" }, NUMBERS);

    expect(errors).toEqual([
      { field: "ageOfMinor", message: "Age of minor years must be a whole number" },
      { field: "refundAmount", message: "Refund amount must be a number" }
    ]);
  });

  it("should accept blank, absent and valid values, zero included", () => {
    expect(collectFormErrors({ ageOfMinor: "0", refundAmount: "  " }, NUMBERS)).toEqual([]);
    expect(collectFormErrors({}, NUMBERS)).toEqual([]);
  });

  it("should ignore read-only and non-number fields, which are never patched", () => {
    const fields: FieldDef[] = [
      { name: "referencenumber", label: "Reference", kind: "number", readOnly: true },
      { name: "newSurname", label: "New surname", kind: "text" }
    ];

    expect(collectFormErrors({ referencenumber: "x", newSurname: "12x" }, fields)).toEqual([]);
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
    ["an array in a select", { maritalStatus: ["Single", "Married"] }, "maritalStatus", "Select an option from the list for Marital status"],
    ["a select value outside its option set", { maritalStatus: "NotAStatus" }, "maritalStatus", "Select an option from the list for Marital status"],
    ["a select value differing from an option only in case", { maritalStatus: "single" }, "maritalStatus", "Select an option from the list for Marital status"],
    ["a select value padded with whitespace", { maritalStatus: " Single " }, "maritalStatus", "Select an option from the list for Marital status"],
    ["a whitespace-only select value", { maritalStatus: "   " }, "maritalStatus", "Select an option from the list for Marital status"],
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

  it("should refuse a multiselect option sent twice, which a rendered checkbox group cannot do", () => {
    expect(collectFormErrors({ iShall: ["1", "1"] }, SHAPED)).toEqual([{ field: "iShall", message: "Select only options from the list for I shall" }]);
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
    expect(collectFormErrors({ retainPermanently: "true", iShall: "4", maritalStatus: "" }, SHAPED)).toEqual([]);
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

describe("the textarea limit the edit form advertises (review finding R15)", () => {
  const RETURN = [FIELD_BY_NAME.dateReturned, FIELD_BY_NAME.returnReason];

  it("should be the 2,000 characters the field definitions describe", () => {
    expect(TEXTAREA_MAX_LENGTH).toBe(2000);
  });

  it("should accept text of exactly the limit", () => {
    expect(collectFormErrors({ returnReason: "x".repeat(TEXTAREA_MAX_LENGTH) }, RETURN)).toEqual([]);
  });

  it("should refuse text one character over the limit, naming the limit", () => {
    const errors = collectFormErrors({ returnReason: "x".repeat(TEXTAREA_MAX_LENGTH + 1) }, RETURN);

    expect(errors).toEqual([{ field: "returnReason", message: "Return reason must be 2,000 characters or less" }]);
  });

  it("should measure after trimming, as the saved value is trimmed", () => {
    expect(collectFormErrors({ returnReason: `  ${"x".repeat(TEXTAREA_MAX_LENGTH)}\n ` }, RETURN)).toEqual([]);
  });

  it("should count UTF-16 code units, as a browser's maxlength does", () => {
    // "😀" is two code units, so 1,000 of them fill the limit and one more character is over it.
    expect(collectFormErrors({ returnReason: "😀".repeat(1000) }, RETURN)).toEqual([]);
    expect(collectFormErrors({ returnReason: `${"😀".repeat(1000)}x` }, RETURN)).toHaveLength(1);
  });

  it("should leave text fields unlimited, since none advertises a limit", () => {
    expect(collectFormErrors({ newForename: "x".repeat(TEXTAREA_MAX_LENGTH + 1) }, [FIELD_BY_NAME.newForename])).toEqual([]);
  });

  it("should report the limit in field order beside a date error", () => {
    const errors = collectFormErrors({ ...parts("dateReturned", "3", "", ""), returnReason: "x".repeat(TEXTAREA_MAX_LENGTH + 1) }, RETURN);

    expect(errors.map((error) => error.field)).toEqual(["dateReturned", "returnReason"]);
  });
});
