import { REFERRAL_REASON, type Referral, URGENCY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import {
  buildReferralDetail,
  buildReferralsView,
  REFERRAL_REASON_CHOICES,
  REFERRAL_REASON_LABEL,
  REFERRAL_STATE_TAG,
  REFERRAL_URGENCY_CHOICES,
  REFERRAL_URGENCY_LABEL
} from "./referrals-view.js";

const REFERRAL: Referral = {
  id: "ref-1",
  state: "Open",
  reasons: ["Minor", "Other"],
  notes: "The applicant turns 16 next month.",
  urgency: "Urgent",
  urgencyReason: "Hearing listed on Friday.",
  migrated: false,
  claimedBy: null,
  claimedAt: null,
  decision: null,
  directionsText: null,
  publishToGazette: null,
  decisionDate: null,
  decidedBy: null,
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-14T08:44:00Z")
};

describe("referrals/referrals-view", () => {
  describe("the label maps", () => {
    it("should label every reason api publishes, so no member renders blank", () => {
      for (const reason of REFERRAL_REASON) {
        expect(REFERRAL_REASON_LABEL[reason]).toBeTruthy();
      }
    });

    it("should label every urgency api publishes", () => {
      for (const urgency of URGENCY) {
        expect(REFERRAL_URGENCY_LABEL[urgency]).toBeTruthy();
      }
    });

    it("should call a referral's Normal urgency Standard, which is not what the case's Normal is called", () => {
      expect(REFERRAL_URGENCY_LABEL.Normal).toBe("Standard");
    });

    it("should offer the reason choices in api's published order, built from its member array", () => {
      expect(REFERRAL_REASON_CHOICES.map((choice) => choice.value)).toEqual([...REFERRAL_REASON]);
      expect(REFERRAL_REASON_CHOICES[0]).toEqual({ value: "Minor", text: "Applicant is a minor" });
    });

    it("should offer the urgency choices in api's published order", () => {
      expect(REFERRAL_URGENCY_CHOICES).toEqual([
        { value: "Normal", text: "Standard" },
        { value: "Urgent", text: "Urgent" }
      ]);
    });

    it("should give both terminal states the same grey tag, so what is over looks over", () => {
      expect(REFERRAL_STATE_TAG.Closed).toBe("govuk-tag--grey");
      expect(REFERRAL_STATE_TAG.Withdrawn).toBe("govuk-tag--grey");
    });
  });

  describe("buildReferralDetail", () => {
    it("should render the stored reasons as their labels rather than api's enum members", () => {
      const view = buildReferralDetail(REFERRAL);

      expect(view.reasons).toEqual(["Applicant is a minor", "Other"]);
    });

    it("should print an unrecognised stored reason as it stands rather than dropping it", () => {
      // api publishes `reasons` as plain strings, so a hand-corrected row can hold something the enum no
      // longer lists. Losing it would hide why the case was referred.
      const view = buildReferralDetail({ ...REFERRAL, reasons: ["SomethingApiOnceHad"] });

      expect(view.reasons).toEqual(["SomethingApiOnceHad"]);
    });

    it("should format both audit timestamps in GOV.UK style, in London time", () => {
      const view = buildReferralDetail(REFERRAL);

      expect(view.createdOn).toBe("13 May 2026 at 9:44am");
      expect(view.modifiedOn).toBe("14 May 2026 at 9:44am");
    });

    it("should say an author is not recorded rather than rendering an empty cell", () => {
      const view = buildReferralDetail({ ...REFERRAL, createdBy: null, modifiedBy: "   " });

      expect(view.createdBy).toBe("Not recorded");
      expect(view.modifiedBy).toBe("Not recorded");
    });

    it("should say free text is not provided rather than rendering an empty cell", () => {
      const view = buildReferralDetail({ ...REFERRAL, notes: null, urgencyReason: "  " });

      expect(view.notes).toBe("Not provided");
      expect(view.urgencyReason).toBe("Not provided");
    });

    it("should carry migrated with no reasons, so the page can say why the cell is empty", () => {
      const view = buildReferralDetail({ ...REFERRAL, migrated: true, reasons: [] });

      expect(view.migrated).toBe(true);
      expect(view.reasons).toEqual([]);
    });

    it.each([
      { state: "Open" as const, terminal: false },
      { state: "Claimed" as const, terminal: false },
      { state: "Decided" as const, terminal: false },
      { state: "Closed" as const, terminal: true },
      { state: "Withdrawn" as const, terminal: true }
    ])("should mark $state as terminal=$terminal, which is all the state logic this repo keeps", ({ state, terminal }) => {
      expect(buildReferralDetail({ ...REFERRAL, state }).terminal).toBe(terminal);
    });

    it("should treat an unpublished state as not terminal, so api gets the final word on a withdraw", () => {
      const view = buildReferralDetail({ ...REFERRAL, state: null });

      expect(view.terminal).toBe(false);
      expect(view.state).toBe("Not recorded");
      expect(view.stateTagClasses).toBe("govuk-tag--grey");
    });

    it("should tag the state so the lifecycle is scannable", () => {
      expect(buildReferralDetail(REFERRAL).stateTagClasses).toBe("govuk-tag--blue");
    });

    it("should render the urgency as its label and say when none was published", () => {
      expect(buildReferralDetail(REFERRAL).urgency).toBe("Urgent");
      expect(buildReferralDetail({ ...REFERRAL, urgency: null }).urgency).toBe("Not provided");
    });
  });

  describe("buildReferralsView", () => {
    it("should format every referral through the same builder the referral page uses", () => {
      const view = buildReferralsView([REFERRAL]);

      expect(view.count).toBe(1);
      expect(view.rows).toEqual([buildReferralDetail(REFERRAL)]);
    });

    it("should keep api's order rather than re-sorting, since listReferrals answers newest first", () => {
      const older = { ...REFERRAL, id: "ref-0", createdOn: new Date("2026-01-01T08:44:00Z") };

      const view = buildReferralsView([REFERRAL, older]);

      expect(view.rows.map((row) => row.id)).toEqual(["ref-1", "ref-0"]);
    });

    it("should report a case with no referrals as an empty tab rather than failing", () => {
      const view = buildReferralsView([]);

      expect(view).toEqual({ rows: [], count: 0, anyOpen: false });
    });

    it.each(["Open", "Claimed", "Decided"] as const)("should count a %s referral as open, so no second one is offered", (state) => {
      expect(buildReferralsView([{ ...REFERRAL, state }]).anyOpen).toBe(true);
    });

    it("should report no open referral when every one of them is closed or withdrawn", () => {
      const view = buildReferralsView([
        { ...REFERRAL, id: "ref-2", state: "Withdrawn" },
        { ...REFERRAL, id: "ref-1", state: "Closed" }
      ]);

      expect(view.anyOpen).toBe(false);
      expect(view.count).toBe(2);
    });

    it("should report an open referral from a history that also holds closed ones", () => {
      const view = buildReferralsView([REFERRAL, { ...REFERRAL, id: "ref-0", state: "Withdrawn" }]);

      expect(view.anyOpen).toBe(true);
    });
  });
});
