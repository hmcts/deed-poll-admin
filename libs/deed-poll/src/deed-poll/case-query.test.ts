import { describe, expect, it } from "vitest";
import {
  type CaseCondition,
  caseConditionSchema,
  caseListSearch,
  caseQueryWhere,
  isBlankCondition,
  isCompleteCondition,
  parseConditions,
  rowForSentCondition,
  serialiseConditions
} from "./case-query.js";

/**
 * A query string built and read exactly as the wire does it: `URLSearchParams` percent-encodes on the
 * way out and decodes on the way in, and a repeated key arrives as a list — which is what Express's
 * `qs` gives `req.query.where` too. The round trip is asserted through this rather than by handing
 * `serialiseConditions`' output straight back to `parseConditions`, because a format that survived only
 * when the URL was skipped would be a format that does not survive a URL.
 */
const throughAUrl = (conditions: CaseCondition[]): CaseCondition[] => {
  const params = new URLSearchParams();
  for (const where of serialiseConditions(conditions)) {
    params.append("where", where);
  }

  return parseConditions(new URLSearchParams(params.toString()).getAll("where"));
};

describe("deed-poll/case-query", () => {
  describe("parseConditions", () => {
    it("should read a single condition from the one string Express gives for one parameter", () => {
      expect(parseConditions("type:is:Adult")).toEqual([{ field: "type", operator: "is", values: ["Adult"] }]);
    });

    it("should read every repeated parameter, in the order the URL sent them", () => {
      const conditions = parseConditions(["type:is:Adult", "state:is:Received"]);

      expect(conditions).toEqual([
        { field: "type", operator: "is", values: ["Adult"] },
        { field: "state", operator: "is", values: ["Received"] }
      ]);
    });

    it("should answer no conditions for a list with no query", () => {
      expect(parseConditions(undefined)).toEqual([]);
      expect(parseConditions([])).toEqual([]);
    });

    it("should answer no conditions for a where that is not a string or a list of them", () => {
      // `?where[a]=b` — no builder produces it, and there is no row to render it as.
      expect(parseConditions({ a: "b" })).toEqual([]);
      expect(parseConditions(7)).toEqual([]);
    });

    it("should split on the first two colons only, so a value keeps its own colons", () => {
      expect(parseConditions("masterDirections:contains:10:30 on Tuesday")).toEqual([
        { field: "masterDirections", operator: "contains", values: ["10:30 on Tuesday"] }
      ]);
    });

    it("should take no value from an entry with no second colon, which is how a no-value operator is written", () => {
      expect(parseConditions("parents:isEmpty")).toEqual([{ field: "parents", operator: "isEmpty", values: [] }]);
    });

    it("should split a list-taking operator's values on commas and trim each one", () => {
      expect(parseConditions("type:isOneOf:Adult, Minor")).toEqual([{ field: "type", operator: "isOneOf", values: ["Adult", "Minor"] }]);
      expect(parseConditions("dateReceived:between:2024-06-01,2024-06-30")).toEqual([
        { field: "dateReceived", operator: "between", values: ["2024-06-01", "2024-06-30"] }
      ]);
    });

    it("should keep a comma inside a single-valued operator's value, because no such operator takes a list", () => {
      expect(parseConditions("applicantAddress1:contains:Flat 2, Rose Court")).toEqual([
        { field: "applicantAddress1", operator: "contains", values: ["Flat 2, Rose Court"] }
      ]);
    });

    it("should keep a half-filled row rather than dropping it, since a builder submits one on Add condition", () => {
      expect(parseConditions([":", "type:"])).toEqual([
        { field: "", operator: "", values: [] },
        { field: "type", operator: "", values: [] }
      ]);
    });

    it("should keep an unrecognised field and operator verbatim, so the row can be re-rendered", () => {
      expect(parseConditions("nonsense:sqlInjection:x")).toEqual([{ field: "nonsense", operator: "sqlInjection", values: ["x"] }]);
    });

    it("should not split an unknown operator's value, since no arity was ever published for it", () => {
      expect(parseConditions("type:nonsense:a,b")).toEqual([{ field: "type", operator: "nonsense", values: ["a,b"] }]);
    });

    it("should trim the field name and the operator, as api does", () => {
      expect(parseConditions(" type : is :Adult")).toEqual([{ field: "type", operator: "is", values: ["Adult"] }]);
    });

    it("should read a field with no colon at all as a field and nothing asked of it", () => {
      expect(parseConditions("type")).toEqual([{ field: "type", operator: "", values: [] }]);
    });
  });

  describe("serialiseConditions", () => {
    it("should write field:operator:value", () => {
      expect(serialiseConditions([{ field: "type", operator: "is", values: ["Adult"] }])).toEqual(["type:is:Adult"]);
    });

    it("should write no value part for an operator that takes none", () => {
      expect(serialiseConditions([{ field: "parents", operator: "isEmpty", values: [] }])).toEqual(["parents:isEmpty"]);
    });

    it("should comma-separate the values of a list-taking operator", () => {
      expect(serialiseConditions([{ field: "type", operator: "isOneOf", values: ["Adult", "Minor"] }])).toEqual(["type:isOneOf:Adult,Minor"]);
    });

    it("should write only the first value of a single-valued operator, rather than inventing a comma", () => {
      expect(serialiseConditions([{ field: "type", operator: "is", values: ["Adult", "Minor"] }])).toEqual(["type:is:Adult"]);
    });
  });

  describe("a round trip through a URL", () => {
    it("should survive a value containing a colon", () => {
      const conditions = [{ field: "masterDirections", operator: "contains", values: ["Hearing at 10:30"] }];

      expect(throughAUrl(conditions)).toEqual(conditions);
    });

    it("should survive a value containing a comma", () => {
      const conditions = [{ field: "applicantAddress1", operator: "contains", values: ["Flat 2, Rose Court"] }];

      expect(throughAUrl(conditions)).toEqual(conditions);
    });

    it("should survive a value containing an ampersand, a plus and a percent", () => {
      const conditions = [{ field: "representativeCompany", operator: "contains", values: ["Smith & Co + 100% Ltd"] }];

      expect(throughAUrl(conditions)).toEqual(conditions);
    });

    it("should survive several conditions of different arities at once", () => {
      const conditions = [
        { field: "type", operator: "is", values: ["Adult"] },
        { field: "dateReceived", operator: "between", values: ["2024-06-01", "2024-06-30"] },
        { field: "state", operator: "isOneOf", values: ["Received", "AwaitingFurtherDocsInfo"] },
        { field: "parents", operator: "isEmpty", values: [] }
      ];

      expect(throughAUrl(conditions)).toEqual(conditions);
    });

    it("should survive a half-filled row, which is the state a builder is in mid-edit", () => {
      const conditions = [
        { field: "", operator: "", values: [] },
        { field: "type", operator: "", values: [] }
      ];

      expect(throughAUrl(conditions)).toEqual(conditions);
    });
  });

  describe("caseConditionSchema", () => {
    it("should accept a complete condition", () => {
      expect(caseConditionSchema.safeParse({ field: "type", operator: "is", values: ["Adult"] }).success).toBe(true);
    });

    it("should reject a field the form does not have, addressing the message to the field", () => {
      const result = caseConditionSchema.safeParse({ field: "nonsense", operator: "is", values: ["x"] });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["field"], message: "Select a case field to filter on" });
    });

    it("should reject an operator the field's kind does not admit, naming the field a caseworker sees", () => {
      const result = caseConditionSchema.safeParse({ field: "newForename", operator: "before", values: ["2024-06-01"] });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["operator"], message: "Select how to compare New forename" });
    });

    it("should reject a single-valued operator with no value, because isEmpty is what that was reaching for", () => {
      const result = caseConditionSchema.safeParse({ field: "newForename", operator: "contains", values: [""] });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["values"], message: "Enter a value for New forename" });
    });

    it("should reject a between with one bound", () => {
      const result = caseConditionSchema.safeParse({ field: "dateReceived", operator: "between", values: ["2024-06-01"] });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["values"], message: "Enter both values for Date received" });
    });

    it("should reject an isOneOf with nothing chosen", () => {
      expect(caseConditionSchema.safeParse({ field: "type", operator: "isOneOf", values: [] }).success).toBe(false);
    });

    it("should accept an isOneOf with one member chosen, and with several", () => {
      expect(caseConditionSchema.safeParse({ field: "type", operator: "isOneOf", values: ["Adult"] }).success).toBe(true);
      expect(caseConditionSchema.safeParse({ field: "type", operator: "isOneOf", values: ["Adult", "Minor"] }).success).toBe(true);
    });

    it("should reject a value beside an operator that is compared without one", () => {
      const result = caseConditionSchema.safeParse({ field: "parents", operator: "isEmpty", values: ["x"] });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["values"], message: "Remove the value from Parents, which is compared without one" });
    });

    it("should not judge what a value means, which is api's answer and not this app's", () => {
      // A date that is not a date and an enum member that does not exist both pass the shape guard and
      // are refused by api, whose error the page renders against the row.
      expect(caseConditionSchema.safeParse({ field: "dateReceived", operator: "is", values: ["not a date"] }).success).toBe(true);
      expect(caseConditionSchema.safeParse({ field: "type", operator: "is", values: ["Wombat"] }).success).toBe(true);
    });
  });

  describe("caseQueryWhere", () => {
    it("should send the complete conditions and leave the half-filled rows behind", () => {
      const conditions = parseConditions(["type:is:Adult", ":", "state:"]);

      expect(caseQueryWhere(conditions)).toEqual(["type:is:Adult"]);
    });

    it("should send nothing for a builder whose rows are all empty, so an added row does not break the list", () => {
      expect(caseQueryWhere(parseConditions([":", ":"]))).toEqual([]);
    });

    it("should send a condition beyond api's cap rather than truncating to it, so api's refusal is what a caseworker sees", () => {
      const conditions = Array.from({ length: 21 }, () => ({ field: "type", operator: "is", values: ["Adult"] }));

      expect(caseQueryWhere(conditions)).toHaveLength(21);
    });
  });

  describe("isCompleteCondition", () => {
    it("should be true for a condition that can go on the wire and false for a row mid-edit", () => {
      expect(isCompleteCondition({ field: "type", operator: "is", values: ["Adult"] })).toBe(true);
      expect(isCompleteCondition({ field: "", operator: "", values: [] })).toBe(false);
    });
  });

  describe("isBlankCondition", () => {
    it("should be true only for a row holding nothing at all", () => {
      expect(isBlankCondition({ field: "", operator: "", values: [] })).toBe(true);
      expect(isBlankCondition({ field: "", operator: "", values: ["", " "] })).toBe(true);
      expect(isBlankCondition({ field: "type", operator: "", values: [] })).toBe(false);
    });
  });

  describe("caseListSearch", () => {
    it("should write nothing for the unfiltered list, so a default is api's to apply and not this app's to pin", () => {
      expect(caseListSearch({})).toBe("");
      expect(caseListSearch({ conditions: [], page: 1 })).toBe("");
    });

    it("should carry the tab and the conditions together, because a query narrows within the selected tab", () => {
      const search = caseListSearch({ filter: "open", conditions: parseConditions(["type:is:Adult", "state:is:Received"]) });

      expect(new URLSearchParams(search).get("filter")).toBe("open");
      expect(new URLSearchParams(search).getAll("where")).toEqual(["type:is:Adult", "state:is:Received"]);
    });

    it("should encode a value holding a colon, a comma, an ampersand or a space rather than letting it re-split the URL", () => {
      const conditions: CaseCondition[] = [{ field: "parents", operator: "contains", values: ["Flat 2, Rose & Court: A"] }];

      const read = new URLSearchParams(caseListSearch({ conditions })).getAll("where");

      expect(read).toEqual(["parents:contains:Flat 2, Rose & Court: A"]);
    });

    it("should round-trip through the URL back to the conditions it was given", () => {
      const conditions = parseConditions(["dateReceived:between:2026-03-01,2026-04-01", "parents:isEmpty"]);

      expect(parseConditions(new URLSearchParams(caseListSearch({ conditions })).getAll("where"))).toEqual(conditions);
    });

    it("should carry a blank row, because the row Add condition adds has to survive the redirect", () => {
      const search = caseListSearch({ conditions: parseConditions([":", ":"]) });

      expect(new URLSearchParams(search).getAll("where")).toEqual([":", ":"]);
    });

    it("should leave out a lone blank row, which is what the unfiltered list renders anyway", () => {
      expect(caseListSearch({ conditions: parseConditions([":"]) })).toBe("");
    });

    it("should write a page only once it is not the first, and a sort only when there is one", () => {
      expect(caseListSearch({ page: 2, sort: "dateReceived:desc" })).toBe("?sort=dateReceived%3Adesc&page=2");
    });
  });

  describe("rowForSentCondition", () => {
    it("should skip the rows that were never sent, so api's where.0 is the first complete condition", () => {
      const conditions = parseConditions([":", "type:is:Adult", "state:", "state:is:Received"]);

      expect(rowForSentCondition(conditions, 0)).toBe(1);
      expect(rowForSentCondition(conditions, 1)).toBe(3);
    });

    it("should answer undefined for a position no row holds", () => {
      expect(rowForSentCondition(parseConditions(["type:is:Adult"]), 3)).toBeUndefined();
    });
  });
});
