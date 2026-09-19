import { MASTER_DECISION } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { directionSchema, MAX_DIRECTIONS_TEXT } from "./schemas.js";

describe("judicial/schemas", () => {
  describe("directionSchema", () => {
    it("should accept a decision and a publication choice with no directions text, because api requires only those two", async () => {
      // `JudicialDirectionRequest.required` is `[decision, publishToGazette]` — an approval that needs no
      // comment is a real answer, and a required textarea here would refuse a direction api accepts.
      const result = directionSchema.safeParse({ decision: "Approved", publishToGazette: false });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ decision: "Approved", publishToGazette: false });
    });

    it("should accept all three fields, trimming the directions text", async () => {
      const result = directionSchema.safeParse({ decision: "Rejected", publishToGazette: true, directionsText: "  Not satisfied  " });

      expect(result.data).toEqual({ decision: "Rejected", publishToGazette: true, directionsText: "Not satisfied" });
    });

    it("should reject a missing decision, addressed to the radios that were not answered", async () => {
      const result = directionSchema.safeParse({ publishToGazette: true });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toMatchObject([{ path: ["decision"], message: "Select whether the application is approved or rejected" }]);
    });

    it("should reject a missing publication choice, because publication cannot be taken back", async () => {
      const result = directionSchema.safeParse({ decision: "Approved" });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toMatchObject([{ path: ["publishToGazette"], message: "Select whether this direction is published in the Gazette" }]);
    });

    it('should reject the string "false" a radio posts, rather than reading it as the truthy value it is', async () => {
      // The whole reason the page compares to two literals: `Boolean("false")` is `true`, so a coerced schema
      // here would publish a direction the judge said not to publish.
      const result = directionSchema.safeParse({ decision: "Approved", publishToGazette: "false" });

      expect(result.success).toBe(false);
    });

    it("should reject a decision that is not one of api's members", async () => {
      const result = directionSchema.safeParse({ decision: "Maybe", publishToGazette: true });

      expect(result.success).toBe(false);
    });

    it("should take its decision members from the client's published array rather than restating them", async () => {
      // A member added at api's end reaches this form without an edit here — the rule
      // `deed-poll/enums/option-sets.ts` holds for every option set.
      for (const decision of MASTER_DECISION) {
        expect(directionSchema.safeParse({ decision, publishToGazette: true }).success, decision).toBe(true);
      }
    });

    it("should treat blank and whitespace-only directions as no comment at all", async () => {
      for (const directionsText of ["", "   "]) {
        const result = directionSchema.safeParse({ decision: "Approved", publishToGazette: true, directionsText });

        expect(result.data?.directionsText, JSON.stringify(directionsText)).toBeUndefined();
      }
    });

    it("should reject directions longer than api's own bound rather than paying a round trip to learn it", async () => {
      const result = directionSchema.safeParse({ decision: "Approved", publishToGazette: true, directionsText: "x".repeat(MAX_DIRECTIONS_TEXT + 1) });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: ["directionsText"], message: `Directions must be ${MAX_DIRECTIONS_TEXT} characters or fewer` });
    });

    it("should accept directions of exactly the maximum length", async () => {
      expect(directionSchema.safeParse({ decision: "Approved", publishToGazette: true, directionsText: "x".repeat(MAX_DIRECTIONS_TEXT) }).success).toBe(true);
    });

    it("should carry no state, decider or decision date, because api stamps all three", async () => {
      const result = directionSchema.safeParse({
        decision: "Approved",
        publishToGazette: true,
        state: "Decided",
        decidedBy: "somebody else",
        decisionDate: "2026-09-19T09:00:00"
      });

      expect(Object.keys(result.data ?? {}).sort()).toEqual(["decision", "publishToGazette"]);
    });
  });
});
