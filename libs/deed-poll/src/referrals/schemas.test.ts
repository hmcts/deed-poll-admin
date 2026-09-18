import { REFERRAL_REASON, URGENCY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { zodErrorToFieldErrors } from "../errors.js";
import { createReferralSchema, MAX_REFERRAL_NOTES, MAX_REFERRAL_URGENCY_REASON } from "./schemas.js";

describe("referrals/schemas", () => {
  describe("createReferralSchema", () => {
    it("should accept one reason and a standard urgency, which is the shortest valid referral", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Normal" });

      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ reasons: ["Minor"], urgency: "Normal", notes: undefined, urgencyReason: undefined });
    });

    it("should accept every reason api publishes, so a member added at its end needs no edit here", () => {
      const parsed = createReferralSchema.safeParse({ reasons: [...REFERRAL_REASON], urgency: "Normal", notes: "Several concerns" });

      expect(parsed.success).toBe(true);
      expect(parsed.data?.reasons).toEqual([...REFERRAL_REASON]);
    });

    it("should reject a reason api does not publish", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Whatever"], urgency: "Normal" });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].path).toEqual(["reasons", 0]);
    });

    it("should reject an empty reason set, addressed to the checkbox group", () => {
      const parsed = createReferralSchema.safeParse({ reasons: [], urgency: "Normal" });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ["reasons"], message: "Select at least one reason for referring this case" });
    });

    it("should reject an untouched checkbox group, which posts no reasons at all, in the same words", () => {
      const parsed = createReferralSchema.safeParse({ urgency: "Normal" });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "reasons", message: "Select at least one reason for referring this case" });
    });

    it("should require notes when Other is among the reasons, addressed to the textarea", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Other"], urgency: "Normal" });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "notes", message: "Enter the other reason for referring this case" });
    });

    it("should require notes when Other is ticked alongside another reason", () => {
      expect(createReferralSchema.safeParse({ reasons: ["Minor", "Other"], urgency: "Normal" }).success).toBe(false);
      expect(createReferralSchema.safeParse({ reasons: ["Minor", "Other"], urgency: "Normal", notes: "Something else" }).success).toBe(true);
    });

    it("should treat notes of only whitespace as absent, so it cannot satisfy the Other rule", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Other"], urgency: "Normal", notes: "   " });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "notes", message: "Enter the other reason for referring this case" });
    });

    it("should accept notes without Other, because api takes them for any reason", () => {
      expect(createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Normal", notes: "Born 2009" }).success).toBe(true);
    });

    it("should store the trimmed notes, so surrounding whitespace never reaches api", () => {
      expect(createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Normal", notes: "  Born 2009  " }).data?.notes).toBe("Born 2009");
    });

    it("should turn blank notes into no notes, because api takes no null on a create", () => {
      expect(createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Normal", notes: "" }).data?.notes).toBeUndefined();
    });

    it("should refuse notes over api's published maximum", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Normal", notes: "n".repeat(MAX_REFERRAL_NOTES + 1) });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ["notes"], message: "Notes must be 1000 characters or fewer" });
    });

    it("should require a reason for urgency when Urgent is chosen, addressed to that textarea", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Urgent" });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "urgencyReason", message: "Enter why this referral is urgent" });
    });

    it("should accept Urgent once its reason is given", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Urgent", urgencyReason: "Hearing on Friday" });

      expect(parsed.success).toBe(true);
      expect(parsed.data?.urgencyReason).toBe("Hearing on Friday");
    });

    it("should treat a whitespace-only urgency reason as absent", () => {
      expect(createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Urgent", urgencyReason: "  " }).success).toBe(false);
    });

    it("should not require an urgency reason for a standard referral", () => {
      expect(createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Normal" }).success).toBe(true);
    });

    it("should refuse an urgency reason over api's published maximum", () => {
      const parsed = createReferralSchema.safeParse({
        reasons: ["Minor"],
        urgency: "Urgent",
        urgencyReason: "u".repeat(MAX_REFERRAL_URGENCY_REASON + 1)
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ["urgencyReason"], message: "The reason for urgency must be 500 characters or fewer" });
    });

    it("should reject a missing urgency, because the form always offers both radios", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Minor"] });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "urgency", message: "Select how urgent this referral is" });
    });

    it("should reject an urgency api does not publish", () => {
      expect(createReferralSchema.safeParse({ reasons: ["Minor"], urgency: "Immediately" }).success).toBe(false);
    });

    it("should report both conditional failures at once, so a form failing two fields costs one submission", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Other"], urgency: "Urgent" });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toEqual([
        { field: "notes", message: "Enter the other reason for referring this case" },
        { field: "urgencyReason", message: "Enter why this referral is urgent" }
      ]);
    });

    it("should offer exactly the members api publishes, built from its arrays rather than restated", () => {
      expect(REFERRAL_REASON).toEqual(["Minor", "DomesticAbuse", "NonPublication", "DeclarantRequirementsNotMet", "SeparatedOrEstranged", "Other"]);
      expect(URGENCY).toEqual(["Normal", "Urgent"]);
    });

    it("should keep the bounds no wider than api's, which is the rule that may only be tightened", () => {
      expect(MAX_REFERRAL_NOTES).toBeLessThanOrEqual(1000);
      expect(MAX_REFERRAL_URGENCY_REASON).toBeLessThanOrEqual(500);
    });
  });
});
