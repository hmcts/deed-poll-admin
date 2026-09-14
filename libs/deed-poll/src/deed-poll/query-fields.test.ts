import { describe, expect, it } from "vitest";
import { FIELD_BY_NAME, type FieldKind, FORM_TABS } from "./form-fields.js";
import { isOperatorValidFor, OPERATOR_LABELS, operatorsFor, QUERYABLE_FIELDS, type QueryOperator, queryableField, valueArity } from "./query-fields.js";

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
