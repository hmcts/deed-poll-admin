import { CONFIRMATION_OUTCOME, REFERRAL_REASON, URGENCY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { zodErrorToFieldErrors } from "../errors.js";
import {
  createReferralSchema,
  MAX_CONFIRMATION_NOTE,
  MAX_REFERRAL_NOTES,
  MAX_REFERRAL_URGENCY_REASON,
  recordConfirmationSchema,
  SEND_SELECTION_MESSAGES,
  sendSelectionSchema
} from "./schemas.js";

describe("referrals/schemas", () => {
  // Master Sullivan's feedback (Steve, 2026-10-27): what kind of minor's application this is, beneath "Applicant is a
  // minor" — several may apply, at least one must, and a contradictory pair may not.
  describe("createReferralSchema, a minor's details", () => {
    const issues = (reasons: string[]) =>
      createReferralSchema.safeParse({ reasons, urgency: "Normal" }).error?.issues.map((issue) => ({ path: issue.path, message: issue.message }));

    it("should accept Applicant is a minor with the details that apply", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Minor", "MinorTransgender", "MinorParentalConsent"], urgency: "Normal" });

      expect(parsed.data?.reasons).toEqual(["Minor", "MinorTransgender", "MinorParentalConsent"]);
    });

    it("should ask for a detail when Applicant is a minor is ticked alone, addressed to the revealed boxes", () => {
      expect(issues(["Minor"])).toEqual([{ path: ["minorDetails"], message: "Select what applies to the minor's application" }]);
    });

    it("should refuse a detail without Applicant is a minor, addressed to the reasons, since the boxes are hidden", () => {
      expect(issues(["DomesticAbuse", "MinorCourtOrder"])).toEqual([
        { path: ["reasons"], message: "Select Applicant is a minor, or untick what applies to the minor's application" }
      ]);
    });

    it.each([
      ["MinorParentalConsent", "MinorNoParentalConsent", "Have parental consent", "Do not have parental consent"],
      ["MinorStepparentConsent", "MinorNoStepparentConsent", "Stepparent parental consent", "Do not have stepparent consent"],
      ["MinorAged16Or17Consented", "MinorAged16Or17NotConsented", "16/17 year old applicant has consented", "16/17 year old applicant has not consented"]
    ])("should refuse both %s and %s, naming them in the Masters' words", (first, second, firstLabel, secondLabel) => {
      expect(issues(["Minor", second, first])).toEqual([{ path: ["minorDetails"], message: `Select either ${firstLabel} or ${secondLabel}, not both` }]);
    });
  });

  describe("createReferralSchema", () => {
    it("should accept one reason and a standard urgency, which is the shortest valid referral", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Normal" });

      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ reasons: ["DomesticAbuse"], urgency: "Normal", notes: undefined, urgencyReason: undefined });
    });

    it("should ask no Master, because a raised referral waits in the queue to be sent (plan Fa1)", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Normal", masterId: "3f0c8a52-1d6e-4b7a-9c1e-2a4b6d8f0e13" });

      expect(parsed.success).toBe(true);
      expect(parsed.data).not.toHaveProperty("masterId");
    });

    it("should accept every reason api publishes, so a member added at its end needs no edit here", () => {
      // Two passes, because one referral may not name both halves of a contradictory pair of a minor's details.
      for (const left of [
        ["MinorNoParentalConsent", "MinorNoStepparentConsent", "MinorAged16Or17NotConsented"],
        ["MinorParentalConsent", "MinorStepparentConsent", "MinorAged16Or17Consented"]
      ]) {
        const reasons = REFERRAL_REASON.filter((reason) => !left.includes(reason));
        const parsed = createReferralSchema.safeParse({ reasons, urgency: "Normal", notes: "Several concerns" });

        expect(parsed.success).toBe(true);
        expect(parsed.data?.reasons).toEqual(reasons);
      }
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
      expect(createReferralSchema.safeParse({ reasons: ["NonPublication", "Other"], urgency: "Normal" }).success).toBe(false);
      expect(createReferralSchema.safeParse({ reasons: ["NonPublication", "Other"], urgency: "Normal", notes: "Something else" }).success).toBe(true);
    });

    it("should treat notes of only whitespace as absent, so it cannot satisfy the Other rule", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["Other"], urgency: "Normal", notes: "   " });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "notes", message: "Enter the other reason for referring this case" });
    });

    it("should accept notes without Other, because api takes them for any reason", () => {
      expect(createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Normal", notes: "Born 2009" }).success).toBe(true);
    });

    it("should store the trimmed notes, so surrounding whitespace never reaches api", () => {
      expect(createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Normal", notes: "  Born 2009  " }).data?.notes).toBe("Born 2009");
    });

    it("should turn blank notes into no notes, because api takes no null on a create", () => {
      expect(createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Normal", notes: "" }).data?.notes).toBeUndefined();
    });

    it("should refuse notes over api's published maximum", () => {
      const parsed = createReferralSchema.safeParse({
        reasons: ["DomesticAbuse"],
        urgency: "Normal",
        notes: "n".repeat(MAX_REFERRAL_NOTES + 1)
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ["notes"], message: "Notes must be 1000 characters or fewer" });
    });

    it("should require a reason for urgency when Urgent is chosen, addressed to that textarea", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Urgent" });

      expect(parsed.success).toBe(false);
      expect(zodErrorToFieldErrors(parsed.error!)).toContainEqual({ field: "urgencyReason", message: "Enter why this referral is urgent" });
    });

    it("should accept Urgent once its reason is given", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Urgent", urgencyReason: "Hearing on Friday" });

      expect(parsed.success).toBe(true);
      expect(parsed.data?.urgencyReason).toBe("Hearing on Friday");
    });

    it("should treat a whitespace-only urgency reason as absent", () => {
      expect(createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Urgent", urgencyReason: "  " }).success).toBe(false);
    });

    it("should not require an urgency reason for a standard referral", () => {
      expect(createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Normal" }).success).toBe(true);
    });

    it("should refuse an urgency reason over api's published maximum", () => {
      const parsed = createReferralSchema.safeParse({
        reasons: ["DomesticAbuse"],
        urgency: "Urgent",
        urgencyReason: "u".repeat(MAX_REFERRAL_URGENCY_REASON + 1)
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ["urgencyReason"], message: "The reason for urgency must be 500 characters or fewer" });
    });

    it("should reject a missing urgency, because the form always offers both radios", () => {
      const parsed = createReferralSchema.safeParse({ reasons: ["DomesticAbuse"] });

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
      expect(createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency: "Immediately" }).success).toBe(false);
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
        const parsed = createReferralSchema.safeParse({ reasons: ["DomesticAbuse"], urgency, urgencyReason: "Hearing on Friday" });

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

  describe("sendSelectionSchema", () => {
    const REFERRAL_1 = "11111111-1111-4111-8111-111111111111";
    const REFERRAL_2 = "22222222-2222-4222-8222-222222222222";
    const MASTER_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const MASTER_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const errors = (body: Record<string, unknown>) => {
      const parsed = sendSelectionSchema.safeParse(body);
      return parsed.success ? [] : zodErrorToFieldErrors(parsed.error);
    };

    it("should pair each ticked referral with its Master, in the order ticked", () => {
      const parsed = sendSelectionSchema.parse({ referrals: [REFERRAL_2, REFERRAL_1], [`master-${REFERRAL_1}`]: MASTER_1, [`master-${REFERRAL_2}`]: MASTER_2 });

      expect(parsed.allocations).toEqual([
        { referralId: REFERRAL_2, masterId: MASTER_2 },
        { referralId: REFERRAL_1, masterId: MASTER_1 }
      ]);
    });

    it("should read a single ticked referral posted as one string", () => {
      expect(sendSelectionSchema.parse({ referrals: REFERRAL_1, [`master-${REFERRAL_1}`]: MASTER_1 }).allocations).toHaveLength(1);
    });

    it("should drop a Master chosen on a row that was not ticked", () => {
      const parsed = sendSelectionSchema.parse({ referrals: REFERRAL_1, [`master-${REFERRAL_1}`]: MASTER_1, [`master-${REFERRAL_2}`]: MASTER_2 });

      expect(parsed.allocations).toEqual([{ referralId: REFERRAL_1, masterId: MASTER_1 }]);
    });

    it("should refuse a selection with nothing ticked on the selection", () => {
      expect(errors({ [`master-${REFERRAL_1}`]: MASTER_1 })).toEqual([{ field: "referrals", message: SEND_SELECTION_MESSAGES.none }]);
    });

    it.each([
      ["a value no form offered", { referrals: "not-a-referral" }],
      ["a referral ticked twice", { referrals: [REFERRAL_1, REFERRAL_1], [`master-${REFERRAL_1}`]: MASTER_1 }],
      ["a bracketed value parsed into an object", { referrals: { 0: REFERRAL_1 } }]
    ])("should refuse %s on the selection", (_name, body) => {
      expect(errors(body)).toEqual([{ field: "referrals", message: SEND_SELECTION_MESSAGES.unknown }]);
    });

    it("should refuse more referrals than api sends at once", () => {
      const ids = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

      expect(errors({ referrals: ids })).toEqual([{ field: "referrals", message: SEND_SELECTION_MESSAGES.tooMany }]);
    });

    it("should accept as many referrals as api sends at once", () => {
      const ids = Array.from({ length: 100 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
      const body = Object.fromEntries([["referrals", ids], ...ids.map((id) => [`master-${id}`, MASTER_1])]);

      expect(sendSelectionSchema.parse(body).allocations).toHaveLength(100);
    });

    it("should refuse a Master that is not one the form offered, beside its row", () => {
      expect(errors({ referrals: REFERRAL_1, [`master-${REFERRAL_1}`]: "not-a-uuid" })).toEqual([
        { field: `master-${REFERRAL_1}`, message: SEND_SELECTION_MESSAGES.noMaster }
      ]);
    });

    it("should refuse every ticked row without a Master, beside its own select", () => {
      expect(errors({ referrals: [REFERRAL_1, REFERRAL_2], [`master-${REFERRAL_1}`]: "", [`master-${REFERRAL_2}`]: [MASTER_1, MASTER_2] })).toEqual([
        { field: `master-${REFERRAL_1}`, message: SEND_SELECTION_MESSAGES.noMaster },
        { field: `master-${REFERRAL_2}`, message: SEND_SELECTION_MESSAGES.noMaster }
      ]);
    });
  });
});
