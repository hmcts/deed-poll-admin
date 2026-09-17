import { describe, expect, it } from "vitest";
import type { CaseCondition } from "./case-query.js";
import type { FieldKind } from "./form-fields.js";
import {
  builderAction,
  builderDateErrors,
  buildQueryRows,
  conditionsFromBuilder,
  fieldControlName,
  operatorControlName,
  type QueryLabels,
  type QueryOption,
  type QueryRow,
  type QueryScriptLabels,
  queryBuilderMetadata,
  queryErrors,
  unusedConditionRows,
  valueControlName
} from "./query-builder.js";
import { CHOOSABLE_FIELDS, OPERATOR_LABELS, operatorsFor, QUERYABLE_FIELDS } from "./query-fields.js";

const LABELS: QueryLabels = {
  chooseField: "Choose a case field",
  chooseOperator: "Choose a comparison",
  chooseValue: "Choose a value",
  yes: "Yes",
  no: "No",
  enterValue: "Enter a value to use this condition",
  enterBothValues: "Enter both values to use this condition"
};

/** The page's words as the browser receives them, which the metadata carries and nothing here interprets. */
const SCRIPT_LABELS: QueryScriptLabels = {
  chooseOperator: LABELS.chooseOperator,
  chooseValue: LABELS.chooseValue,
  yes: LABELS.yes,
  no: LABELS.no,
  value: "Value for condition",
  lowerBound: "Lower value for condition",
  upperBound: "Upper value for condition",
  day: "Day",
  month: "Month",
  year: "Year",
  enterValue: LABELS.enterValue,
  enterBothValues: LABELS.enterBothValues,
  announceValue: "Condition {n} now asks for a value.",
  announceValues: "Condition {n} now asks for two values.",
  announceNoValue: "Condition {n} needs no value."
};

/** One row of a submitted builder, in the control names a GET form actually sends. */
const submission = (index: number, field: string, operator: string, values: Record<string, string> = {}) => ({
  [fieldControlName(index)]: field,
  [operatorControlName(index)]: operator,
  ...values
});

const rowFor = (condition: Partial<CaseCondition>): QueryRow => buildQueryRows([{ field: "", operator: "", values: [], ...condition }], LABELS)[0];

/** Every option of the field chooser, placeholder first: the chooser is grouped, so its options are nested. */
const fieldOptions = (row: QueryRow): QueryOption[] => [row.field.placeholder, ...row.field.groups.flatMap((group) => group.options)];

const chosen = (row: QueryRow, part: "field" | "operator") =>
  (part === "field" ? fieldOptions(row) : row.operator.options).filter((option) => option.selected).map((option) => option.value);

describe("deed-poll/query-builder", () => {
  describe("builderAction", () => {
    it("should answer null for a canonical URL, so a query it carries is never mistaken for an empty builder", () => {
      expect(builderAction({ filter: "open", where: ["type:is:Adult"] })).toBeNull();
    });

    it("should read the row a remove button named", () => {
      expect(builderAction({ remove: "2" })).toEqual({ kind: "remove", index: 2 });
    });

    it("should treat a remove naming no row as an apply, rather than losing a query on screen", () => {
      expect(builderAction({ remove: "not-a-row" })).toEqual({ kind: "apply" });
      expect(builderAction({ remove: "-1" })).toEqual({ kind: "apply" });
    });

    it("should read an add and an apply", () => {
      expect(builderAction({ add: "condition" })).toEqual({ kind: "add" });
      expect(builderAction({ apply: "true" })).toEqual({ kind: "apply" });
    });
  });

  describe("conditionsFromBuilder", () => {
    it("should read a text row from its three controls", () => {
      const query = submission(0, "newForename", "contains", { [valueControlName(0, 0)]: "Ada" });

      expect(conditionsFromBuilder(query, { kind: "apply" })).toEqual([{ field: "newForename", operator: "contains", values: ["Ada"] }]);
    });

    it("should read rows in index order rather than in the order the parameters arrived", () => {
      const query = {
        ...submission(1, "type", "is", { [valueControlName(1, 0)]: "Adult" }),
        ...submission(0, "newForename", "is", { [valueControlName(0, 0)]: "Ada" })
      };

      expect(conditionsFromBuilder(query, { kind: "apply" }).map((condition) => condition.field)).toEqual(["newForename", "type"]);
    });

    it("should take no value for an operator that compares without one", () => {
      const query = submission(0, "parents", "isEmpty", { [valueControlName(0, 0)]: "ignored" });

      expect(conditionsFromBuilder(query, { kind: "apply" })).toEqual([{ field: "parents", operator: "isEmpty", values: [] }]);
    });

    it("should read both bounds of between", () => {
      const query = submission(0, "ageOfMinor", "between", { [valueControlName(0, 0)]: "3", [valueControlName(0, 1)]: "9" });

      expect(conditionsFromBuilder(query, { kind: "apply" })).toEqual([{ field: "ageOfMinor", operator: "between", values: ["3", "9"] }]);
    });

    it("should read every ticked box of isOneOf, which share one control name", () => {
      const query = submission(0, "type", "isOneOf", { [valueControlName(0, 0)]: ["Adult", "Minor"] } as unknown as Record<string, string>);

      expect(conditionsFromBuilder(query, { kind: "apply" })).toEqual([{ field: "type", operator: "isOneOf", values: ["Adult", "Minor"] }]);
    });

    it("should assemble a date from its parts as YYYY-MM-DD, which is what api parses", () => {
      const query = submission(0, "dateReceived", "is", {
        [`${valueControlName(0, 0)}-day`]: "1",
        [`${valueControlName(0, 0)}-month`]: "3",
        [`${valueControlName(0, 0)}-year`]: "2026"
      });

      expect(conditionsFromBuilder(query, { kind: "apply" })).toEqual([{ field: "dateReceived", operator: "is", values: ["2026-03-01"] }]);
    });

    it("should refuse to compose a date that does not exist, rather than rolling it over to another one", () => {
      const query = submission(0, "dateReceived", "is", {
        [`${valueControlName(0, 0)}-day`]: "31",
        [`${valueControlName(0, 0)}-month`]: "2",
        [`${valueControlName(0, 0)}-year`]: "2026"
      });

      expect(conditionsFromBuilder(query, { kind: "apply" })).toEqual([{ field: "dateReceived", operator: "is", values: [""] }]);
    });

    it("should drop an operator the chosen field's kind cannot admit, so changing the field re-offers the right ones", () => {
      // What arrives when a caseworker changes the field from a text one to a date one: the operator
      // control still holds the text kind's `contains`.
      const query = submission(0, "dateReceived", "contains", { [valueControlName(0, 0)]: "Ada" });

      expect(conditionsFromBuilder(query, { kind: "apply" })).toEqual([{ field: "dateReceived", operator: "", values: [] }]);
    });

    it("should keep an unchosen row, because a row mid-edit still has to render", () => {
      expect(conditionsFromBuilder(submission(0, "", ""), { kind: "apply" })).toEqual([{ field: "", operator: "", values: [] }]);
    });

    it("should append an empty row for add, which is what makes it work without JavaScript", () => {
      const query = submission(0, "type", "is", { [valueControlName(0, 0)]: "Adult" });

      expect(conditionsFromBuilder(query, { kind: "add" })).toEqual([
        { field: "type", operator: "is", values: ["Adult"] },
        { field: "", operator: "", values: [] }
      ]);
    });

    it("should drop the row remove named and keep the others in order", () => {
      const query = {
        ...submission(0, "type", "is", { [valueControlName(0, 0)]: "Adult" }),
        ...submission(1, "newForename", "is", { [valueControlName(1, 0)]: "Ada" }),
        ...submission(2, "newSurname", "is", { [valueControlName(2, 0)]: "Lovelace" })
      };

      expect(conditionsFromBuilder(query, { kind: "remove", index: 1 }).map((condition) => condition.field)).toEqual(["type", "newSurname"]);
    });
  });

  describe("builderDateErrors", () => {
    const parts = (index: number, slot: number, day: string, month: string, year: string) => ({
      [`${valueControlName(index, slot)}-day`]: day,
      [`${valueControlName(index, slot)}-month`]: month,
      [`${valueControlName(index, slot)}-year`]: year
    });

    it("should report a date that does not exist against the row it was typed into", () => {
      const conditions: CaseCondition[] = [{ field: "dateReceived", operator: "is", values: [""] }];

      expect(builderDateErrors(parts(0, 0, "31", "2", "2026"), conditions)).toEqual([{ row: 0, message: "Date received must be a real date" }]);
    });

    it("should report a date missing a part, naming the part", () => {
      const conditions: CaseCondition[] = [{ field: "dateReceived", operator: "is", values: [""] }];

      expect(builderDateErrors(parts(0, 0, "1", "", "2026"), conditions)).toEqual([{ row: 0, message: "Date received must include a month" }]);
    });

    it("should report the upper bound of a between separately from the lower", () => {
      const conditions: CaseCondition[] = [{ field: "dateReceived", operator: "between", values: ["2026-03-01", ""] }];
      const query = { ...parts(0, 0, "1", "3", "2026"), ...parts(0, 1, "31", "2", "2026") };

      expect(builderDateErrors(query, conditions)).toEqual([{ row: 0, message: "Date received must be a real date" }]);
    });

    it("should say nothing about a blank date, since an unfinished row is a normal state of the builder", () => {
      const conditions: CaseCondition[] = [{ field: "dateReceived", operator: "is", values: [""] }];

      expect(builderDateErrors(parts(0, 0, "", "", ""), conditions)).toEqual([]);
    });

    it("should say nothing about a row whose field is not a date", () => {
      const conditions: CaseCondition[] = [{ field: "newForename", operator: "is", values: ["Ada"] }];

      expect(builderDateErrors(parts(0, 0, "31", "2", "2026"), conditions)).toEqual([]);
    });
  });

  describe("queryErrors", () => {
    it("should address a refusal to the row the condition occupies, not to its position on the wire", () => {
      // The first row is incomplete, so it is never sent — api's `where.0` is the second row.
      const conditions: CaseCondition[] = [
        { field: "type", operator: "", values: [] },
        { field: "state", operator: "is", values: ["Nonsense"] }
      ];

      const split = queryErrors([{ field: "where.0", message: "is not a member of state" }], conditions);

      expect(split.rows).toEqual([{ row: 1, message: "is not a member of state" }]);
      expect(split.unaddressed).toEqual([]);
    });

    it("should leave a refusal of the query as a whole unaddressed, since no row can carry it", () => {
      const split = queryErrors([{ field: "where", message: "takes at most 20 conditions" }], []);

      expect(split.rows).toEqual([]);
      expect(split.unaddressed).toEqual([{ field: "where", message: "takes at most 20 conditions" }]);
    });

    it("should leave a refusal naming a position no row holds unaddressed rather than throwing", () => {
      const conditions: CaseCondition[] = [{ field: "type", operator: "is", values: ["Adult"] }];

      expect(queryErrors([{ field: "where.7", message: "nonsense" }], conditions).unaddressed).toHaveLength(1);
    });
  });

  describe("buildQueryRows", () => {
    it("should render one empty row for a list with no query, because an empty row is the invitation to filter", () => {
      const rows = buildQueryRows([], LABELS);

      expect(rows).toHaveLength(1);
      expect(rows[0].control).toBe("none");
      expect(chosen(rows[0], "field")).toEqual([""]);
    });

    it("should scope every control name to the row, so the rows do not overwrite each other", () => {
      const rows = buildQueryRows(
        [
          { field: "newForename", operator: "is", values: ["Ada"] },
          { field: "newSurname", operator: "is", values: ["Lovelace"] }
        ],
        LABELS
      );

      expect(rows.map((row) => row.field.name)).toEqual(["field-0", "field-1"]);
      expect(rows.map((row) => row.values[0].name)).toEqual(["value-0-0", "value-1-0"]);
      expect(rows.map((row) => row.number)).toEqual([1, 2]);
    });

    it("should offer only the operators the chosen field's kind admits", () => {
      const row = rowFor({ field: "dateReceived" });

      expect(row.operator.options.map((option) => option.value)).toEqual(["", "is", "before", "after", "between", "isEmpty", "isNotEmpty"]);
    });

    it("should offer no operators until a field is chosen, since which comparisons exist depends on the field", () => {
      expect(rowFor({}).operator.options.map((option) => option.value)).toEqual([""]);
    });

    it("should mark the chosen field and operator so the choosers come back showing them", () => {
      const row = rowFor({ field: "type", operator: "is", values: ["Adult"] });

      expect(chosen(row, "field")).toEqual(["type"]);
      expect(chosen(row, "operator")).toEqual(["is"]);
    });

    it("should leave the operator unset when the URL names one the kind cannot admit, so the row is fixable", () => {
      const row = rowFor({ field: "type", operator: "startsWith", values: ["Ad"] });

      expect(chosen(row, "operator")).toEqual([""]);
      expect(row.control).toBe("none");
    });

    it.each([
      ["newForename", "is", "text"],
      ["returnReason", "contains", "text"],
      ["ageOfMinor", "is", "number"],
      ["dateReceived", "is", "date"],
      ["type", "is", "select"],
      ["type", "isOneOf", "checkboxes"],
      ["iShall", "contains", "checkboxes"],
      ["inPerson", "is", "radios"],
      ["parents", "isEmpty", "none"],
      ["parents", "isNotEmpty", "none"]
    ])("should ask for %s %s with a %s control", (field, operator, control) => {
      expect(rowFor({ field, operator, values: ["x"] }).control).toBe(control);
    });

    it("should render two value inputs for between and one for every other operator that takes a value", () => {
      expect(rowFor({ field: "dateReceived", operator: "between", values: ["2026-03-01", "2026-04-01"] }).values).toHaveLength(2);
      expect(rowFor({ field: "dateReceived", operator: "before", values: ["2026-03-01"] }).values).toHaveLength(1);
    });

    it("should render no value control at all for isEmpty, rather than a disabled box implying one is wanted", () => {
      const row = rowFor({ field: "parents", operator: "isEmpty", values: [] });

      expect(row.values).toEqual([]);
      expect(row.valueOptions).toEqual([]);
    });

    it("should split a date value into the three parts the input renders", () => {
      const row = rowFor({ field: "dateReceived", operator: "is", values: ["2026-03-01"] });

      expect(row.values[0].dateParts).toEqual({ day: "1", month: "3", year: "2026" });
    });

    it("should keep the submitted date parts on a re-render, so a date that did not compose stays on screen", () => {
      const submitted = {
        [`${valueControlName(0, 0)}-day`]: "31",
        [`${valueControlName(0, 0)}-month`]: "2",
        [`${valueControlName(0, 0)}-year`]: "2026"
      };

      const rows = buildQueryRows([{ field: "dateReceived", operator: "is", values: [""] }], LABELS, { submitted });

      expect(rows[0].values[0].dateParts).toEqual({ day: "31", month: "2", year: "2026" });
    });

    it("should offer an enum's members with the chosen one selected, behind a placeholder", () => {
      const row = rowFor({ field: "type", operator: "is", values: ["MinorTransgender"] });

      expect(row.valueOptions[0]).toEqual({ value: "", text: LABELS.chooseValue, selected: false, checked: false });
      expect(row.valueOptions.filter((option) => option.selected).map((option) => option.text)).toEqual(["Minor Transgender"]);
    });

    it("should select the placeholder when an enum row has no value yet", () => {
      expect(rowFor({ field: "type", operator: "is", values: [] }).valueOptions[0].selected).toBe(true);
    });

    it("should tick every chosen member of isOneOf, with no placeholder among checkboxes", () => {
      const row = rowFor({ field: "type", operator: "isOneOf", values: ["Adult", "Minor"] });

      expect(row.valueOptions.some((option) => option.value === "")).toBe(false);
      expect(row.valueOptions.filter((option) => option.checked).map((option) => option.value)).toEqual(["Adult", "Minor"]);
    });

    it("should offer a multiselect's Dynamics values, which is what a condition on one compares against", () => {
      const row = rowFor({ field: "iShall", operator: "contains", values: ["4"] });

      expect(row.valueOptions.filter((option) => option.checked)).toEqual([{ value: "4", text: "and my children", selected: true, checked: true }]);
    });

    it("should ask a boolean as Yes and No, sending the true and false api compares", () => {
      const row = rowFor({ field: "inPerson", operator: "is", values: ["false"] });

      expect(row.valueOptions).toEqual([
        { value: "true", text: "Yes", selected: false, checked: false },
        { value: "false", text: "No", selected: true, checked: true }
      ]);
    });

    it("should not offer the derived fields, since api can only refuse a condition on one", () => {
      const names = fieldOptions(rowFor({})).map((option) => option.value);

      expect(names).not.toContain("daysReceivedToEnroled");
      expect(names).toContain("state");
    });

    it("should group the field chooser by the tab and section each field sits on, in form order", () => {
      const groups = rowFor({}).field.groups;

      expect(groups.map((group) => group.label)).toEqual([
        "Application: General",
        "Application: Names",
        "Application: Applicant address and contact details",
        "Application: Representative address and contact details",
        "Application: Nationality",
        "Application: Declarations",
        "Referral to Master",
        "Signature",
        "Enrolment",
        "Return",
        "Refund"
      ]);
      expect(groups[1].options.map((option) => option.value)).toEqual([
        "newForename",
        "newMiddleName",
        "newSurname",
        "oldForename",
        "oldMiddleName",
        "oldSurname"
      ]);
    });

    it("should keep the placeholder out of every group, since Choose a case field belongs to no section", () => {
      const row = rowFor({});

      expect(row.field.placeholder).toEqual({ value: "", text: LABELS.chooseField, selected: true, checked: false });
      expect(row.field.groups.flatMap((group) => group.options).some((option) => option.value === "")).toBe(false);
    });

    it("should put every choosable field in exactly one group, and leave no group empty", () => {
      const grouped = rowFor({}).field.groups.flatMap((group) => group.options.map((option) => option.value));

      expect(grouped).toEqual(CHOOSABLE_FIELDS.map((field) => field.name));
      expect(new Set(grouped).size).toBe(grouped.length);
      expect(rowFor({}).field.groups.every((group) => group.options.length > 0)).toBe(true);
    });

    it("should mark the chosen field inside its own group, so the chooser comes back showing it", () => {
      const groups = rowFor({ field: "dateReceived", operator: "is", values: ["2026-03-01"] }).field.groups;
      const selected = groups.filter((group) => group.options.some((option) => option.selected));

      expect(selected.map((group) => group.label)).toEqual(["Application: General"]);
      expect(groups[0].options.filter((option) => option.selected).map((option) => option.text)).toEqual(["Date received"]);
    });

    it("should render a field the chooser does not offer, so a hand-edited URL is visible rather than silently dropped", () => {
      const row = rowFor({ field: "daysReceivedToEnroled", operator: "is", values: ["4"] });

      expect(row.control).toBe("number");
      expect(chosen(row, "field")).toEqual([]);
    });

    it("should put a refusal against the row it belongs to and no other", () => {
      const rows = buildQueryRows(
        [
          { field: "type", operator: "is", values: ["Adult"] },
          { field: "state", operator: "is", values: ["Nonsense"] }
        ],
        LABELS,
        { rowErrors: [{ row: 1, message: "is not a member of state" }] }
      );

      expect(rows.map((row) => row.error)).toEqual([undefined, "is not a member of state"]);
    });

    it("should ask for the value of a row whose comparison takes one, since choosing it is what reveals the control", () => {
      const row = rowFor({ field: "type", operator: "is", values: [""] });

      expect(row.hint).toBe(LABELS.enterValue);
      expect(row.error).toBeUndefined();
      expect(row.control).toBe("select");
    });

    it("should ask nothing of a complete row", () => {
      expect(rowFor({ field: "type", operator: "is", values: ["Adult"] }).hint).toBeUndefined();
    });

    it("should ask nothing of a row with no comparison yet, since the operator chooser already says what to do", () => {
      expect(rowFor({ field: "type", operator: "", values: [] }).hint).toBeUndefined();
      expect(rowFor({}).hint).toBeUndefined();
    });

    it.each(["isEmpty", "isNotEmpty"])("should ask nothing of %s, which is complete without a value", (operator) => {
      expect(rowFor({ field: "parents", operator, values: [] }).hint).toBeUndefined();
    });

    it("should ask for both bounds of a between holding one of two", () => {
      expect(rowFor({ field: "ageOfMinor", operator: "between", values: ["3"] }).hint).toBe(LABELS.enterBothValues);
      expect(rowFor({ field: "ageOfMinor", operator: "between", values: ["3", "9"] }).hint).toBeUndefined();
    });

    it("should ask for a value of isOneOf until one box is ticked, since one member is a whole condition", () => {
      expect(rowFor({ field: "type", operator: "isOneOf", values: [] }).hint).toBe(LABELS.enterValue);
      expect(rowFor({ field: "type", operator: "isOneOf", values: ["Adult"] }).hint).toBeUndefined();
    });

    it("should say nothing beside a refusal, so one unfinished row does not read as two problems", () => {
      const rows = buildQueryRows([{ field: "state", operator: "is", values: [""] }], LABELS, {
        rowErrors: [{ row: 0, message: "is not a member of state" }]
      });

      expect(rows[0].error).toBe("is not a member of state");
      expect(rows[0].hint).toBeUndefined();
    });
  });

  describe("unusedConditionRows", () => {
    it("should name the row a value-less condition occupies, which is the one the query ran without", () => {
      const conditions: CaseCondition[] = [
        { field: "type", operator: "is", values: ["Adult"] },
        { field: "newForename", operator: "is", values: [""] }
      ];

      expect(unusedConditionRows(conditions)).toEqual([1]);
    });

    it("should name a between holding one of two bounds, and not one holding both", () => {
      expect(unusedConditionRows([{ field: "ageOfMinor", operator: "between", values: ["3"] }])).toEqual([0]);
      expect(unusedConditionRows([{ field: "ageOfMinor", operator: "between", values: ["3", "9"] }])).toEqual([]);
    });

    it.each(["isEmpty", "isNotEmpty"])("should not name a %s row, which is complete and was sent", (operator) => {
      expect(unusedConditionRows([{ field: "parents", operator, values: [] }])).toEqual([]);
    });

    it("should not name an entirely blank row, since nothing was asked of it", () => {
      expect(unusedConditionRows([{ field: "", operator: "", values: [] }])).toEqual([]);
    });

    it("should name a row holding a field and no comparison, which is unfinished and so was not sent", () => {
      expect(unusedConditionRows([{ field: "type", operator: "", values: [] }])).toEqual([0]);
    });

    it("should not name a row api refused, whose own message already says what happened", () => {
      const conditions: CaseCondition[] = [{ field: "state", operator: "is", values: [""] }];

      expect(unusedConditionRows(conditions, [{ row: 0, message: "is not a member of state" }])).toEqual([]);
    });
  });

  /**
   * The metadata the browser swaps a control in from. Every assertion here is about it agreeing with the
   * rows the server renders, because that agreement is the whole reason the function exists — a browser
   * carrying its own operator table is the drift the plan's decision 4 forbids.
   */
  describe("queryBuilderMetadata", () => {
    const metadata = queryBuilderMetadata(SCRIPT_LABELS);

    it("should offer each kind exactly the operators the server offers it", () => {
      for (const kind of Object.keys(metadata.kinds) as FieldKind[]) {
        expect(metadata.kinds[kind].operators).toEqual(operatorsFor(kind));
      }
    });

    it("should state every operator's arity and label from the domain's own table", () => {
      expect(Object.keys(metadata.operators)).toEqual(Object.keys(OPERATOR_LABELS));
      expect(metadata.operators.between).toEqual({ label: "is between", arity: 2 });
      expect(metadata.operators.isOneOf).toEqual({ label: "is one of", arity: "many" });
      expect(metadata.operators.isEmpty.arity).toBe(0);
    });

    it("should name the control each kind asks a value with, which is what the browser must not decide", () => {
      expect(metadata.kinds.date.controls["1"]).toBe("date");
      expect(metadata.kinds.number.controls["2"]).toBe("number");
      expect(metadata.kinds.boolean.controls["1"]).toBe("radios");
      expect(metadata.kinds.enum.controls["1"]).toBe("select");
      // The same field asks with checkboxes once the comparison takes a set of values rather than one.
      expect(metadata.kinds.enum.controls.many).toBe("checkboxes");
      expect(metadata.kinds.multiselect.controls["1"]).toBe("checkboxes");
      expect(metadata.kinds.text.controls["1"]).toBe("text");
      expect(metadata.kinds.textarea.controls["1"]).toBe("text");
    });

    it("should ask for no control at all where the comparison takes no value", () => {
      for (const kind of Object.keys(metadata.kinds)) {
        expect(metadata.kinds[kind].controls["0"]).toBe("none");
      }
    });

    it("should carry every queryable field, not only the ones the chooser offers, since a URL can name one", () => {
      expect(Object.keys(metadata.fields)).toHaveLength(QUERYABLE_FIELDS.length);
      expect(metadata.fields.displayReference.kind).toBe("text");
      // Curated out of the chooser and still answerable by api — the row a hand-edited URL renders has to
      // go on working.
      expect(CHOOSABLE_FIELDS.some((field) => field.name === "applicantTelephone")).toBe(false);
      expect(metadata.fields.applicantTelephone.kind).toBe("text");
    });

    it("should carry an option set's members, which is what a select or a checkbox set is built from", () => {
      expect(metadata.fields.type.options).toEqual(expect.arrayContaining([{ value: "Adult", text: "Adult" }]));
      expect(metadata.fields.newForename.options).toEqual([]);
    });

    it("should name a kind for every field, so no field leaves the browser without a control to ask with", () => {
      for (const field of QUERYABLE_FIELDS) {
        expect(metadata.kinds[metadata.fields[field.name].kind]).toBeDefined();
      }
    });

    it("should carry the page's words, since the controls it builds have no macro to default them", () => {
      expect(metadata.labels).toEqual(SCRIPT_LABELS);
    });

    it("should survive the round trip through JSON, which is how the browser receives it", () => {
      expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
    });
  });
});
