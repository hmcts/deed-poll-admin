import { CONFIRMATION_OUTCOME, REFERRAL_REASON, URGENCY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { zodErrorToFieldErrors } from "../errors.js";
import { createReferralSchema, MAX_CONFIRMATION_NOTE, MAX_REFERRAL_NOTES, MAX_REFERRAL_URGENCY_REASON, recordConfirmationSchema } from "./schemas.js";

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

    it("should report the missing urgency and the missing other reason at once, not one submission each", () => {
      // The reason `urgency` is optional in the shape: zod skips an object's refinements once a field has
      // failed its own parse, so a required enum here would have withheld the `notes` message.
      const parsed = createReferralSchema.safeParse({ reasons: ["Other"] });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toEqual([
        { field: "urgency", message: "Select how urgent this referral is" },
        { field: "notes", message: "Enter the other reason for referring this case" }
      ]);
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

    it("should accept every urgency api publishes, built from its array rather than restated", () => {
      for (const urgency of URGENCY) {
        const parsed = createReferralSchema.safeParse({ reasons: ["Minor"], urgency, urgencyReason: "Hearing on Friday" });

        expect(parsed.success).toBe(true);
      }
    });

    it("should say the same sentence for an unpublished reason as for none, rather than printing api's members", () => {
      // zod's own message for an enum lists every member it accepts, which is api's vocabulary and not
      // something to show a caseworker — reachable only by a tampered or stale post, but reachable.
      const parsed = createReferralSchema.safeParse({ reasons: ["Whatever"], urgency: "Normal" });

      // The `message` is what a page renders (the issue object still carries zod's `values`, which nothing
      // reads), so that is what this asserts: no member names in the sentence.
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "reasons.0", message: "Select at least one reason for referring this case" });
      expect(parsed.error?.issues[0].message).not.toContain("DeclarantRequirementsNotMet");
    });

    it("should keep the bounds no wider than api's, which is the rule that may only be tightened", () => {
      expect(MAX_REFERRAL_NOTES).toBeLessThanOrEqual(1000);
      expect(MAX_REFERRAL_URGENCY_REASON).toBeLessThanOrEqual(500);
    });
  });

  describe("recordConfirmationSchema", () => {
    it("should accept an answer with no note, because the note is evidence and not a second decision", () => {
      const parsed = recordConfirmationSchema.safeParse({ outcome: "Confirmed" });

      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ outcome: "Confirmed", note: undefined });
    });

    it("should accept every outcome api publishes, so a member added at its end needs no edit here", () => {
      for (const outcome of CONFIRMATION_OUTCOME) {
        const parsed = recordConfirmationSchema.safeParse({ outcome, note: "Replied by email" });

        expect(parsed.success, outcome).toBe(true);
        expect(parsed.data).toEqual({ outcome, note: "Replied by email" });
      }
    });

    it("should reject an untouched radio group, addressed to the control the summary links to", () => {
      const parsed = recordConfirmationSchema.safeParse({ note: "They replied by post" });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "outcome", message: "Select what the applicant said about proceeding" });
    });

    it("should say the same sentence for an outcome api does not publish, rather than printing its members", () => {
      // Only a tampered or stale post reaches this, and zod's default message for an enum lists api's whole
      // vocabulary — which is a wire contract and not something to show a caseworker.
      const parsed = recordConfirmationSchema.safeParse({ outcome: "Maybe" });

      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "outcome", message: "Select what the applicant said about proceeding" });
      expect(parsed.error?.issues[0].message).not.toContain("Withdrawn");
    });

    it("should treat a note of nothing but whitespace as none, as api treats it", () => {
      const parsed = recordConfirmationSchema.safeParse({ outcome: "Withdrawn", note: "   " });

      expect(parsed.success).toBe(true);
      expect(parsed.data?.note).toBeUndefined();
    });

    it("should trim a note before measuring it, so padding cannot push it past the cap", () => {
      const parsed = recordConfirmationSchema.safeParse({ outcome: "Confirmed", note: `  ${"x".repeat(MAX_CONFIRMATION_NOTE)}  ` });

      expect(parsed.success).toBe(true);
      expect(parsed.data?.note).toHaveLength(MAX_CONFIRMATION_NOTE);
    });

    it("should reject a note past the cap against the field, rather than letting api answer 400", () => {
      const parsed = recordConfirmationSchema.safeParse({ outcome: "Confirmed", note: "x".repeat(MAX_CONFIRMATION_NOTE + 1) });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "note", message: `The note must be ${MAX_CONFIRMATION_NOTE} characters or fewer` });
    });

    it("should accept no property but the two api takes, so nothing can assert an identity api never verified", () => {
      const parsed = recordConfirmationSchema.safeParse({
        outcome: "Confirmed",
        confirmationRecordedBy: "Somebody Else",
        confirmationReceivedAt: "2020-01-01"
      });

      expect(parsed.success).toBe(true);
      // Stripped rather than refused, which is zod's default for an object — but stripped is what matters: api
      // publishes this body with `additionalProperties: true`, so anything that reached the wire would be
      // silently ignored instead of answered with a 400.
      expect(Object.keys(parsed.data ?? {})).toEqual(["outcome"]);
    });

    it("should keep the note's bound no wider than api's, which is the rule that may only be tightened", () => {
      expect(MAX_CONFIRMATION_NOTE).toBeLessThanOrEqual(1000);
    });
  });
});
