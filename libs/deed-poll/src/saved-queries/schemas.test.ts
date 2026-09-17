import { describe, expect, it } from "vitest";
import { MAX_SAVED_QUERY_DESCRIPTION, MAX_SAVED_QUERY_NAME, savedQueryFormSchema } from "./schemas.js";

describe("saved-queries/schemas", () => {
  describe("savedQueryFormSchema", () => {
    it("should accept a name with an optional description and an unticked share box", () => {
      const parsed = savedQueryFormSchema.safeParse({ name: "Awaiting enrolment", description: "Received cases", shared: undefined });

      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ name: "Awaiting enrolment", description: "Received cases", shared: false });
    });

    it("should store the trimmed name, so surrounding whitespace never reaches the column", () => {
      expect(savedQueryFormSchema.safeParse({ name: "  Awaiting enrolment  " }).data?.name).toBe("Awaiting enrolment");
    });

    it("should reject a name of only whitespace, which would otherwise smuggle a blank past the check", () => {
      const parsed = savedQueryFormSchema.safeParse({ name: "   " });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toBe("Enter a name for this query");
    });

    it("should reject a missing name with the words a caseworker needs rather than zod's", () => {
      const parsed = savedQueryFormSchema.safeParse({});

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ["name"], message: "Enter a name for this query" });
    });

    it("should accept a name at api's published maximum and refuse one character more", () => {
      expect(savedQueryFormSchema.safeParse({ name: "n".repeat(MAX_SAVED_QUERY_NAME) }).success).toBe(true);

      const parsed = savedQueryFormSchema.safeParse({ name: "n".repeat(MAX_SAVED_QUERY_NAME + 1) });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toBe("Name must be 100 characters or fewer");
    });

    it("should refuse a description over api's published maximum", () => {
      const parsed = savedQueryFormSchema.safeParse({ name: "Mine", description: "d".repeat(MAX_SAVED_QUERY_DESCRIPTION + 1) });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ["description"], message: "Description must be 500 characters or fewer" });
    });

    it("should turn a blank description into no description, because api takes no null on a create", () => {
      expect(savedQueryFormSchema.safeParse({ name: "Mine", description: "   " }).data?.description).toBeUndefined();
    });

    it("should read a ticked share box as shared", () => {
      expect(savedQueryFormSchema.safeParse({ name: "Mine", shared: "true" }).data?.shared).toBe(true);
    });

    it("should read anything other than the control's own value as not shared, so a forged value is a no", () => {
      expect(savedQueryFormSchema.safeParse({ name: "Mine", shared: "maybe" }).data?.shared).toBe(false);
      expect(savedQueryFormSchema.safeParse({ name: "Mine", shared: "on" }).data?.shared).toBe(false);
    });

    it("should keep the bounds no wider than api's, which is the rule that may only be tightened", () => {
      expect(MAX_SAVED_QUERY_NAME).toBeLessThanOrEqual(100);
      expect(MAX_SAVED_QUERY_DESCRIPTION).toBeLessThanOrEqual(500);
    });
  });
});
