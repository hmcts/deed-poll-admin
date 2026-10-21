import type { EmailSlot } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { emailSlotLabel, validateEmailSlots } from "./slot-validation.js";

// api's two published slots, with api's own caps — the referral direction's and the referral notes'.
const JUDGES_REASON: EmailSlot = { name: "judges_reason", required: true, maxLength: 4000 };
const ADDITIONAL_NOTES: EmailSlot = { name: "additional_notes", required: false, maxLength: 1000 };
const SLOTS = [JUDGES_REASON, ADDITIONAL_NOTES];

describe("emails/slot-validation", () => {
  describe("validateEmailSlots", () => {
    it("should return the trimmed values under api's own snake_case keys", () => {
      const result = validateEmailSlots(SLOTS, { judges_reason: "  The evidence is insufficient  ", additional_notes: "Call us" });

      expect(result).toEqual({ ok: true, slots: { judges_reason: "The evidence is insufficient", additional_notes: "Call us" } });
    });

    it.each([null, undefined, "", "   "])("should omit an optional slot submitted as %j", (value) => {
      const result = validateEmailSlots(SLOTS, { judges_reason: "A reason", additional_notes: value });

      expect(result).toEqual({ ok: true, slots: { judges_reason: "A reason" } });
    });

    it("should name every offending slot at once rather than stopping at the first", () => {
      // One submission to learn both, which is what a GOV.UK error summary is for.
      const result = validateEmailSlots(SLOTS, { judges_reason: "", additional_notes: "x".repeat(1001) });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.errors.map((error) => error.field)).toEqual(["judges_reason", "additional_notes"]);
    });

    it.each([null, undefined, "", "    "])("should refuse a required slot submitted as %j", (value) => {
      const result = validateEmailSlots(SLOTS, { judges_reason: value });

      expect(result).toEqual({
        ok: false,
        errors: [{ field: "judges_reason", message: "Enter the Master's reason for refusing the application, as the applicant will read it" }]
      });
    });

    it("should refuse a required slot that was never submitted at all", () => {
      const result = validateEmailSlots(SLOTS, {});

      expect(result.ok === false && result.errors).toEqual([
        { field: "judges_reason", message: "Enter the Master's reason for refusing the application, as the applicant will read it" }
      ]);
    });

    it("should refuse rather than truncate a slot over api's cap, quoting the cap api published", () => {
      // Refused at either origin: a shortened quotation of a judge is worse than a caseworker being asked to
      // shorten one. The number is api's `maxLength` and not one typed here.
      const result = validateEmailSlots([{ name: "judges_reason", required: true, maxLength: 10 }], { judges_reason: "far too long to carry" });

      expect(result.ok === false && result.errors).toEqual([
        { field: "judges_reason", message: "The Master's reason for refusing the application must be 10 characters or fewer" }
      ]);
    });

    it("should measure the trimmed value against the cap, so trailing whitespace does not fail a slot that fits", () => {
      const result = validateEmailSlots([{ name: "judges_reason", required: true, maxLength: 4 }], { judges_reason: "  fits  " });

      expect(result).toEqual({ ok: true, slots: { judges_reason: "fits" } });
    });

    it.each([["one", "two"], {}, false, 0].map((value) => ({ value })))("should report a non-text slot $value rather than crashing on it", ({ value }) => {
      // A duplicated control posts an array; a tampered post can send anything. Mirrors api's own "must be text".
      const result = validateEmailSlots(SLOTS, { judges_reason: value });

      expect(result.ok === false && result.errors).toEqual([
        { field: "judges_reason", message: "The Master's reason for refusing the application must be text" }
      ]);
    });

    it("should ignore a submitted key that is not a slot of this template, because api resolves the rest", () => {
      // `reference_number` is api's to compute, and api refuses a body naming it. Nothing here forwards it, so
      // the 400 is unreachable from this repo's own forms.
      const result = validateEmailSlots(SLOTS, { judges_reason: "A reason", reference_number: "KBDP2026-00042" });

      expect(result).toEqual({ ok: true, slots: { judges_reason: "A reason" } });
    });

    it.each([null, undefined, ""])("should skip a slot api published with name %j, because there is no control to address an error to", (name) => {
      const result = validateEmailSlots([{ name, required: true, maxLength: 100 }, JUDGES_REASON], { judges_reason: "A reason" });

      expect(result).toEqual({ ok: true, slots: { judges_reason: "A reason" } });
    });

    it.each(["0", "false", " "])("should retain the nonempty slot name %j exactly as api published it", (name) => {
      const result = validateEmailSlots([{ name, required: true, maxLength: 4 }], { [name]: " fits " });

      expect(result).toEqual({ ok: true, slots: { [name]: "fits" } });
    });

    it("should validate a slot this repo has never seen from api's metadata alone", () => {
      // `template` is a bare string with no member list, so a template notify-6 adds arrives with slots nothing
      // here was written for. The rules are read off the metadata, so it validates with no edit.
      const result = validateEmailSlots([{ name: "days_outstanding", required: true, maxLength: 3 }], { days_outstanding: "1000" });

      expect(result.ok === false && result.errors).toEqual([{ field: "days_outstanding", message: "Days outstanding must be 3 characters or fewer" }]);
    });
  });

  describe("emailSlotLabel", () => {
    it("should give the business's wording for the slots api ships", () => {
      expect(emailSlotLabel("judges_reason")).toBe("The Master's reason for refusing the application");
      expect(emailSlotLabel("additional_notes")).toBe("Additional notes for the applicant");
    });

    it("should humanise a placeholder name it has no wording for, rather than leaving the control unlabelled", () => {
      expect(emailSlotLabel("days_outstanding")).toBe("Days outstanding");
    });

    it("should not resolve an inherited member name to a function off Object.prototype", () => {
      expect(emailSlotLabel("constructor")).toBe("Constructor");
      expect(emailSlotLabel("toString")).toBe("ToString");
    });
  });
});
