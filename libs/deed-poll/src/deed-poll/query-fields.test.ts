import { describe, expect, it } from "vitest";
import { FIELD_BY_NAME, type FieldKind, FORM_TABS } from "./form-fields.js";
import {
  CHOOSABLE_FIELD_GROUPS,
  CHOOSABLE_FIELDS,
  isOperatorValidFor,
  isQueryOperator,
  OPERATOR_LABELS,
  operatorsFor,
  QUERYABLE_FIELDS,
  type QueryOperator,
  queryableField,
  valueArity
} from "./query-fields.js";

/** api's operator table, restated here so a drift from it fails rather than passing quietly. */
const EXPECTED_OPERATORS: Record<FieldKind, QueryOperator[]> = {
  text: ["is", "contains", "startsWith", "isEmpty", "isNotEmpty"],
  textarea: ["is", "contains", "startsWith", "isEmpty", "isNotEmpty"],
  date: ["is", "before", "after", "between", "isEmpty", "isNotEmpty"],
  number: ["is", "gt", "lt", "between", "isEmpty", "isNotEmpty"],
  enum: ["is", "isOneOf", "isEmpty", "isNotEmpty"],
  multiselect: ["contains", "isEmpty", "isNotEmpty"],
  boolean: ["is"]
};

describe("deed-poll/query-fields", () => {
  describe("QUERYABLE_FIELDS", () => {
    it("should offer every form field, so a field added to the form becomes queryable without a second edit", () => {
      // The drift guard: enumerating the queryable fields separately is what this test exists to prevent.
      const formFields = FORM_TABS.flatMap((tab) => tab.sections.flatMap((section) => section.fields)).map((field) => field.name);

      expect(QUERYABLE_FIELDS.map((field) => field.name)).toEqual(formFields);
    });

    it("should still carry the fields the chooser declines to offer, because api answers a condition on them", () => {
      // `queryable: false` curates the chooser, not the queryable surface: narrowing this list would turn
      // "every form field" into "every form field except the ones someone remembered".
      const names = QUERYABLE_FIELDS.map((field) => field.name);

      expect(names).toContain("feeReference");
      expect(names).toContain("iShall");
      expect(QUERYABLE_FIELDS).toHaveLength(70);
    });

    it("should include the read-only fields, because reference number and state are the most useful to query", () => {
      const readOnly = QUERYABLE_FIELDS.filter((field) => field.readOnly).map((field) => field.name);

      expect(readOnly).toEqual(["referencenumber", "displayReference", "state", "daysReceivedToEnroled", "daysReceivedToReturned"]);
    });

    it("should carry the label and enum set from the form, not a restatement of them", () => {
      const state = QUERYABLE_FIELDS.find((field) => field.name === "state");

      expect(state).toBe(FIELD_BY_NAME.state);
      expect(state?.label).toBe("State");
      expect(state?.enumSet).toBe("state");
    });

    it("should exclude the subgrid tabs, whose rows are child entities rather than case fields", () => {
      const subgridTabs = FORM_TABS.filter((tab) => tab.subgrid);

      expect(subgridTabs.map((tab) => tab.id)).toEqual(["notes", "witnesses", "documents"]);
      expect(subgridTabs.every((tab) => tab.sections.length === 0)).toBe(true);
    });
  });

  describe("CHOOSABLE_FIELDS", () => {
    it("should leave out the two fields api computes at read time, which no condition can name", () => {
      const names = CHOOSABLE_FIELDS.map((field) => field.name);

      expect(names).not.toContain("daysReceivedToEnroled");
      expect(names).not.toContain("daysReceivedToReturned");
    });

    it("should leave out the fields the form marks unqueryable, alongside the derived pair rather than instead of it", () => {
      const names = CHOOSABLE_FIELDS.map((field) => field.name);

      expect(names).not.toContain("feeReference");
      expect(names).not.toContain("referralNotes");
      expect(names).not.toContain("applicantAddress1");
    });

    it("should offer everything else queryable, in form order, so it tracks the form as the queryable list does", () => {
      const expected = QUERYABLE_FIELDS.filter((field) => field.queryable !== false && !field.name.startsWith("daysReceivedTo")).map((field) => field.name);

      expect(CHOOSABLE_FIELDS.map((field) => field.name)).toEqual(expected);
    });

    it("should offer the 43 curated fields, so a cut or an addition to the table is a deliberate edit here", () => {
      // Pinned as a count because the point of the curation is that the list stays short: 68 options in
      // one chooser is what plan 10 was written to fix, and a silent drift back is the regression.
      expect(CHOOSABLE_FIELDS).toHaveLength(43);
    });

    it("should keep the fields the curation deliberately spared, which a caseworker really does filter by", () => {
      const names = CHOOSABLE_FIELDS.map((field) => field.name);

      expect(names).toContain("referencenumber");
      expect(names).toContain("displayReference");
      expect(names).toContain("parents");
      expect(names).toContain("masterName");
      expect(names).toContain("representativeName");
      expect(names).toContain("representativeCompany");
    });

    it("should still keep the derived pair queryable, so a hand-edited URL naming one renders its refusal", () => {
      expect(queryableField("daysReceivedToEnroled")).toBeDefined();
    });

    it("should still resolve an unqueryable field, so a hand-edited URL naming one renders rather than vanishing", () => {
      expect(queryableField("feeReference")?.label).toBe("Fee reference");
    });
  });

  describe("CHOOSABLE_FIELD_GROUPS", () => {
    it("should hold exactly the choosable fields, in the same order, since the flat list is derived from these", () => {
      const grouped = CHOOSABLE_FIELD_GROUPS.flatMap((group) => group.fields);

      expect(grouped).toEqual(CHOOSABLE_FIELDS);
    });

    it("should put each field in one group only, so a caseworker meets it once", () => {
      const names = CHOOSABLE_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.name));

      expect(new Set(names).size).toBe(names.length);
    });

    it("should contribute no empty group, since a section whose every field was curated out has nothing to label", () => {
      expect(CHOOSABLE_FIELD_GROUPS.every((group) => group.fields.length > 0)).toBe(true);
    });

    it("should label a group from its tab and section, and from the tab alone where the two say the same thing", () => {
      const labels = CHOOSABLE_FIELD_GROUPS.map((group) => group.label);

      expect(labels).toContain("Application: Names");
      // The Signature tab holds one section named after it, and "Signature: Signature" says nothing twice.
      expect(labels).toContain("Signature");
      expect(labels).not.toContain("Signature: Signature");
    });

    it("should take the labels from the form rather than restating them, so renaming a tab renames its group", () => {
      const application = FORM_TABS.find((tab) => tab.id === "application");

      expect(CHOOSABLE_FIELD_GROUPS[0].label).toBe(`${application?.label}: ${application?.sections[0].label}`);
    });

    it("should group in form order, so the groups follow the case tabs a caseworker already knows", () => {
      const tabOrder = FORM_TABS.filter((tab) => tab.sections.length > 0).map((tab) => tab.label);
      const groupTabs = [...new Set(CHOOSABLE_FIELD_GROUPS.map((group) => group.label.split(":")[0]))];

      expect(groupTabs).toEqual(tabOrder);
    });
  });

  describe("operatorsFor", () => {
    it.each(Object.keys(EXPECTED_OPERATORS) as FieldKind[])("should offer only api's operators for kind %s", (kind) => {
      expect(operatorsFor(kind)).toEqual(EXPECTED_OPERATORS[kind]);
    });

    it("should cover every kind used by a queryable field", () => {
      const kinds = new Set(QUERYABLE_FIELDS.map((field) => field.kind));

      for (const kind of kinds) {
        expect(operatorsFor(kind).length).toBeGreaterThan(0);
      }
    });

    it("should offer boolean equality only, because there is nothing else to ask of two values", () => {
      expect(operatorsFor("boolean")).toEqual(["is"]);
    });

    it("should compare a textarea exactly as it compares text", () => {
      expect(operatorsFor("textarea")).toEqual(operatorsFor("text"));
    });
  });

  describe("valueArity", () => {
    it("should take no value for isEmpty and isNotEmpty, so no value control renders", () => {
      expect(valueArity("isEmpty")).toBe(0);
      expect(valueArity("isNotEmpty")).toBe(0);
    });

    it("should take two values for between", () => {
      expect(valueArity("between")).toBe(2);
    });

    it("should take a set for isOneOf", () => {
      expect(valueArity("isOneOf")).toBe("many");
    });

    it.each(["is", "contains", "startsWith", "before", "after", "gt", "lt"] as QueryOperator[])("should take one value for %s", (operator) => {
      expect(valueArity(operator)).toBe(1);
    });
  });

  describe("isOperatorValidFor", () => {
    it("should accept an operator the kind offers", () => {
      expect(isOperatorValidFor("date", "between")).toBe(true);
    });

    it("should reject an operator belonging to another kind", () => {
      expect(isOperatorValidFor("text", "before")).toBe(false);
      expect(isOperatorValidFor("boolean", "contains")).toBe(false);
    });

    it("should reject an unknown operator without throwing, since it arrives from a URL", () => {
      expect(isOperatorValidFor("text", "sqlInjection")).toBe(false);
    });
  });

  describe("isQueryOperator", () => {
    it("should accept every operator any kind offers", () => {
      for (const operator of new Set(Object.values(EXPECTED_OPERATORS).flat())) {
        expect(isQueryOperator(operator)).toBe(true);
      }
    });

    it("should reject a token that is not an operator, or is not a string at all", () => {
      expect(isQueryOperator("nonsense")).toBe(false);
      expect(isQueryOperator(undefined)).toBe(false);
      expect(isQueryOperator(["is"])).toBe(false);
    });

    it("should not accept an object prototype member as an operator", () => {
      expect(isQueryOperator("toString")).toBe(false);
      expect(isQueryOperator("constructor")).toBe(false);
    });
  });

  describe("queryableField", () => {
    it("should resolve a field by name", () => {
      expect(queryableField("referencenumber")?.label).toBe("Reference number");
    });

    it("should answer undefined for a name the form does not have", () => {
      expect(queryableField("nonsense")).toBeUndefined();
    });

    it("should answer undefined for a non-string, since the name arrives unvalidated from a URL", () => {
      expect(queryableField(undefined)).toBeUndefined();
      expect(queryableField(["state"])).toBeUndefined();
    });

    it("should not resolve an object prototype member as a field", () => {
      expect(queryableField("toString")).toBeUndefined();
      expect(queryableField("constructor")).toBeUndefined();
    });
  });

  describe("OPERATOR_LABELS", () => {
    it("should label every operator any kind offers", () => {
      const offered = new Set(Object.values(EXPECTED_OPERATORS).flat());

      for (const operator of offered) {
        expect(OPERATOR_LABELS[operator]).toBeTruthy();
      }
    });
  });
});
