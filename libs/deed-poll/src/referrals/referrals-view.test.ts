import { REFERRAL_REASON, type Referral, URGENCY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import {
  buildReferralDetail,
  buildReferralsView,
  REFERRAL_REASON_CHOICES,
  REFERRAL_REASON_LABEL,
  REFERRAL_STATE_TAG,
  REFERRAL_URGENCY_CHOICES,
  REFERRAL_URGENCY_LABEL,
  unavailableReferralsView
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

    it("should print a stored reason that names an Object member as it stands, not as what it inherits", () => {
      // `reasons` is `string[]` on the wire, so the label map is indexed with data. A plain `map[reason] ??`
      // resolves "constructor" to a function off Object.prototype, which reaches the page as a reason.
      const view = buildReferralDetail({ ...REFERRAL, reasons: ["constructor", "toString"] });

      expect(view.reasons).toEqual(["constructor", "toString"]);
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
      // Named values as well as the shape, so this cannot pass by both sides changing together: a row the tab
      // renders is already display text, not the wire's members.
      expect(view.rows[0]).toMatchObject({ id: "ref-1", state: "Open", reasons: ["Applicant is a minor", "Other"], urgency: "Urgent", terminal: false });
    });

    it("should count a referral whose state api did not publish as open, so no second one is offered", () => {
      // The conservative answer in both directions: `terminal: false` offers the withdraw and withholds the
      // raise, so api refuses whichever of the two is wrong instead of this app guessing.
      expect(buildReferralsView([{ ...REFERRAL, state: null }]).anyOpen).toBe(true);
    });

    it("should keep api's order rather than re-sorting, since listReferrals answers newest first", () => {
      const older = { ...REFERRAL, id: "ref-0", createdOn: new Date("2026-01-01T08:44:00Z") };

      const view = buildReferralsView([REFERRAL, older]);

      expect(view.rows.map((row) => row.id)).toEqual(["ref-1", "ref-0"]);
    });

    it("should report a case with no referrals as an empty tab rather than failing", () => {
      const view = buildReferralsView([]);

      expect(view).toEqual({ rows: [], count: 0, anyOpen: false, unavailable: false, offerRaise: true });
    });

    it.each(["Open", "Claimed", "Decided"] as const)("should count a %s referral as open, so no second one is offered", (state) => {
      const view = buildReferralsView([{ ...REFERRAL, state }]);

      expect(view.anyOpen).toBe(true);
      expect(view.offerRaise).toBe(false);
    });

    // A read that succeeded is a claim about the case, however it turned out — which is the distinction
    // `unavailableReferralsView` exists to keep, so it is worth pinning from this side too.
    it("should report a successful read as available, so an empty case is not confused with a failed one", () => {
      expect(buildReferralsView([]).unavailable).toBe(false);
      expect(buildReferralsView([REFERRAL]).unavailable).toBe(false);
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
      expect(view.offerRaise).toBe(false);
    });
  });

  describe("unavailableReferralsView", () => {
    it("should be a state of its own rather than an empty list, since the two make opposite claims", () => {
      const view = unavailableReferralsView();

      expect(view.unavailable).toBe(true);
      expect(view).not.toEqual(buildReferralsView([]));
    });

    // The failure mode this whole state exists to prevent: a caseworker reading an unreadable panel as
    // "not referred" and raising a second referral. api answers 409, but they were told the wrong thing.
    it("should withhold the raise control, because it cannot know whether one is already open", () => {
      expect(unavailableReferralsView().offerRaise).toBe(false);
    });

    it("should carry no rows and claim no count, having read nothing", () => {
      const view = unavailableReferralsView();

      expect(view.rows).toEqual([]);
      expect(view.count).toBe(0);
    });

    // Not shared state: the template is handed this object and Nunjucks is not required to leave it alone.
    it("should answer a fresh object each time, not one shared between requests", () => {
      expect(unavailableReferralsView()).not.toBe(unavailableReferralsView());
    });
  });
});
