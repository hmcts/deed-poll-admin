import { CONFIRMATION_OUTCOME, REFERRAL_REASON, REFERRAL_STATE, type Referral, URGENCY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import {
  buildReferralDetail,
  buildReferralsView,
  CONFIRMATION_OUTCOME_CHOICES,
  CONFIRMATION_OUTCOME_LABEL,
  REFERRAL_REASON_CHOICES,
  REFERRAL_REASON_LABEL,
  REFERRAL_STATE_LABEL,
  REFERRAL_STATE_MEANING,
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

/**
 * The same referral once the applicant has been asked whether they still want to proceed, and before they have
 * answered — the state the case is on the awaiting-confirmation worklist in.
 */
const AWAITING: Referral = { ...REFERRAL, confirmationRequestedAt: new Date("2026-03-21T09:00:00Z") };

/** And once a caseworker has recorded the reply. The two dates are days apart, deliberately — see the test. */
const CONFIRMED: Referral = {
  ...AWAITING,
  confirmationOutcome: "Confirmed",
  confirmationReceivedAt: new Date("2026-03-22T10:30:00Z"),
  confirmationRecordedBy: "Ada Caseworker"
};

/** The same referral once a judge has claimed it and returned a direction. */
const DECIDED: Referral = {
  ...REFERRAL,
  state: "Decided",
  claimedBy: "A Judge",
  claimedAt: new Date("2026-05-15T08:44:00Z"),
  decision: "Approved",
  directionsText: "Enrol the deed once the fee is paid.",
  publishToGazette: true,
  decisionDate: new Date("2026-05-16T08:44:00Z"),
  decidedBy: "A Judge"
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

    it("should label and explain every state api publishes, so no member reaches a page as a raw member", () => {
      for (const state of REFERRAL_STATE) {
        expect(REFERRAL_STATE_LABEL[state]).toBeTruthy();
        expect(REFERRAL_STATE_MEANING[state]).toBeTruthy();
      }
      // The four states whose api member describes its own machine rather than the caseworker's position.
      // `Withdrawn` is left out because the business word and api's member are the same word.
      for (const state of ["Open", "Claimed", "Decided", "Closed"] as const) {
        expect(REFERRAL_STATE_LABEL[state]).not.toBe(state);
      }
    });

    it("should explain Decided as a direction needing action rather than as a finished referral", () => {
      // The finding that started referrals-admin-4: "Decided" told a caseworker something had happened and
      // nothing about whose turn it was.
      expect(REFERRAL_STATE_MEANING.Decided).toBe("Direction received — action needed");
      expect(REFERRAL_STATE_MEANING.Closed).toBe("Direction actioned");
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
      { state: "Open" as const, live: true, canWithdraw: true, canClose: false },
      { state: "Claimed" as const, live: true, canWithdraw: true, canClose: false },
      // The state the single `terminal` flag got wrong in both directions: live, so no second referral may be
      // raised, and not withdrawable, because the direction has to be actioned and the referral closed.
      { state: "Decided" as const, live: true, canWithdraw: false, canClose: true },
      { state: "Closed" as const, live: false, canWithdraw: false, canClose: false },
      { state: "Withdrawn" as const, live: false, canWithdraw: false, canClose: false }
    ])("should give $state live=$live, canWithdraw=$canWithdraw and canClose=$canClose", ({ state, live, canWithdraw, canClose }) => {
      const view = buildReferralDetail({ ...REFERRAL, state });

      expect(view).toMatchObject({ live, canWithdraw, canClose });
    });

    it("should offer neither action on a state api did not publish, while still counting it as live", () => {
      // Two different conservative answers to two different questions: withholding the raise costs a reload,
      // while a warning button on a referral nobody can describe invites a write that may be the wrong one.
      const view = buildReferralDetail({ ...REFERRAL, state: null });

      expect(view.live).toBe(true);
      expect(view.canWithdraw).toBe(false);
      expect(view.canClose).toBe(false);
      expect(view.state).toBe("Not recorded");
      expect(view.stateMeaning).toBeNull();
      expect(view.stateTagClasses).toBe("govuk-tag--grey");
    });

    it("should render the status as the caseworker's label and its meaning, not api's member", () => {
      expect(buildReferralDetail({ ...REFERRAL, state: "Decided" })).toMatchObject({
        state: "Direction received",
        stateMeaning: "Direction received — action needed"
      });
    });

    it("should tag the state so the lifecycle is scannable", () => {
      expect(buildReferralDetail(REFERRAL).stateTagClasses).toBe("govuk-tag--blue");
    });

    it("should carry no claim and no direction on a referral nobody has picked up", () => {
      const view = buildReferralDetail(REFERRAL);

      expect(view.claim).toBeNull();
      expect(view.direction).toBeNull();
    });

    it("should format the claim once a judge holds the referral, so the lifecycle section can say who", () => {
      const view = buildReferralDetail({ ...REFERRAL, state: "Claimed", claimedBy: "A Judge", claimedAt: new Date("2026-05-15T08:44:00Z") });

      expect(view.claim).toEqual({ claimedBy: "A Judge", claimedOn: "15 May 2026 at 9:44am" });
      // Still no direction: being claimed is not being answered.
      expect(view.direction).toBeNull();
    });

    it("should keep the claim readable after the referral is closed, since that is where who dealt with it is asked", () => {
      const view = buildReferralDetail({ ...DECIDED, state: "Closed", modifiedBy: "A Caseworker" });

      expect(view.claim).toMatchObject({ claimedBy: "A Judge" });
    });

    it("should render every field of a returned direction, in the business's words", () => {
      const view = buildReferralDetail(DECIDED);

      expect(view.direction).toEqual({
        decision: "Approved",
        directionsText: "Enrol the deed once the fee is paid.",
        publishToGazette: true,
        decidedBy: "A Judge",
        decidedOn: "16 May 2026 at 9:44am"
      });
    });

    it("should keep the direction exactly as the judge recorded it once the referral is closed", () => {
      // Closing records that the office carried the direction out, not that it was undone.
      const view = buildReferralDetail({ ...DECIDED, state: "Closed", modifiedBy: "A Caseworker" });

      expect(view.direction).toMatchObject({ decision: "Approved", decidedBy: "A Judge", publishToGazette: true });
    });

    it("should name the deciding judge and never the last modifier, which closure changes", () => {
      // The trap decision 4 names: after a closure `modifiedBy` is the caseworker, so reading the direction's
      // author off it would credit the judge's decision to whoever actioned it.
      const view = buildReferralDetail({ ...DECIDED, state: "Closed", modifiedBy: "A Caseworker", decidedBy: "A Judge" });

      expect(view.direction?.decidedBy).toBe("A Judge");
      expect(view.modifiedBy).toBe("A Caseworker");
    });

    it("should say directions were not provided rather than hiding a direction that has none", () => {
      // A judge may approve with nothing further to direct. "No directions provided" and "no direction yet"
      // are opposite claims, so the section is present and only the one row is a placeholder.
      const view = buildReferralDetail({ ...DECIDED, directionsText: null });

      expect(view.direction).toMatchObject({ decision: "Approved", directionsText: "Not provided" });
    });

    it("should leave an unanswered Gazette question null rather than turning it into No", () => {
      const view = buildReferralDetail({ ...DECIDED, publishToGazette: null });

      expect(view.direction?.publishToGazette).toBeNull();
    });

    it("should carry an explicit No on the Gazette question as false, distinct from unanswered", () => {
      const view = buildReferralDetail({ ...DECIDED, publishToGazette: false });

      expect(view.direction?.publishToGazette).toBe(false);
    });

    it("should still render the direction section when the state says there is one but the fields did not arrive", () => {
      // The one thing certainly false on a Decided referral is "no direction yet", so the section stays and
      // says which fields are missing.
      const view = buildReferralDetail({ ...REFERRAL, state: "Decided" });

      expect(view.direction).toEqual({
        decision: "Not recorded",
        directionsText: "Not provided",
        publishToGazette: null,
        decidedBy: "Not recorded",
        decidedOn: "Not recorded"
      });
    });

    it("should render a direction api recorded even on a state that does not imply one", () => {
      // `decision` is the more specific answer of the two, and the fields are what api actually sent.
      const view = buildReferralDetail({ ...DECIDED, state: "Open" });

      expect(view.direction).toMatchObject({ decision: "Approved" });
    });

    it("should carry no direction-changed date on a direction that stands as first given", () => {
      expect(buildReferralDetail(DECIDED).directionChangedOn).toBeNull();
      expect(buildReferralDetail({ ...DECIDED, directionChangedAt: null }).directionChangedOn).toBeNull();
    });

    it("should format when the judge changed the direction, in GOV.UK style and London time", () => {
      const view = buildReferralDetail({ ...DECIDED, directionChangedAt: new Date("2026-10-19T09:30:00Z") });

      expect(view.directionChangedOn).toBe("19 October 2026 at 10:30am");
    });

    it("should keep the date once a withdrawn direction has left the referral with no direction on it", () => {
      // Withdraw clears the direction and leaves the referral Claimed, and api keeps the flag set — the
      // caseworker is still owed the notice that the direction they may have seen is no longer the judge's.
      const withdrawn: Referral = { ...DECIDED, state: "Claimed", decision: null, directionsText: null, decisionDate: null, decidedBy: null };

      const view = buildReferralDetail({ ...withdrawn, directionChangedAt: new Date("2026-10-19T09:30:00Z") });

      expect(view.direction).toBeNull();
      expect(view.directionChangedOn).toBe("19 October 2026 at 10:30am");
    });

    it("should render the urgency as its label and say when none was published", () => {
      expect(buildReferralDetail(REFERRAL).urgency).toBe("Urgent");
      expect(buildReferralDetail({ ...REFERRAL, urgency: null }).urgency).toBe("Not provided");
    });
  });

  describe("the applicant's confirmation", () => {
    it("should carry nothing at all for a referral nobody asked to confirm, which is most of them", () => {
      // Null rather than a section reading "not recorded": that would answer a question nobody put.
      expect(buildReferralDetail(REFERRAL).confirmation).toBe(null);
      expect(buildReferralDetail(DECIDED).confirmation).toBe(null);
    });

    it("should say when the applicant was asked, and that the answer is still outstanding", () => {
      const view = buildReferralDetail(AWAITING);

      expect(view.confirmation).toEqual({
        requestedOn: "21 March 2026 at 9:00am",
        awaiting: true,
        outcome: null,
        recordedOn: null,
        recordedBy: null
      });
    });

    it("should render a recorded answer as the sentence the form asked the question in", () => {
      const view = buildReferralDetail(CONFIRMED);

      expect(view.confirmation).toMatchObject({
        awaiting: false,
        outcome: "The applicant wants to proceed",
        recordedBy: "Ada Caseworker"
      });
    });

    it("should not read Withdrawn as the referral having been withdrawn, which is a different event", () => {
      const view = buildReferralDetail({ ...CONFIRMED, confirmationOutcome: "Withdrawn" });

      expect(view.confirmation?.outcome).toBe("The applicant does not want to proceed");
      expect(view.confirmation?.outcome).not.toContain("Withdrawn");
    });

    it("should date a recorded answer by when it was recorded, which is not when the applicant replied", () => {
      // api stamps `confirmationReceivedAt` from its own clock, so nothing built on it may read as the date of
      // the reply — the two are days apart here on purpose.
      const view = buildReferralDetail(CONFIRMED);

      expect(view.confirmation?.requestedOn).toBe("21 March 2026 at 9:00am");
      expect(view.confirmation?.recordedOn).toBe("22 March 2026 at 10:30am");
    });

    it("should say the recorder was not recorded rather than leaving the row blank", () => {
      const view = buildReferralDetail({ ...CONFIRMED, confirmationRecordedBy: null });

      expect(view.confirmation?.recordedBy).toBe("Not recorded");
    });

    it("should keep a closed referral waiting, because closing clears neither confirmation column", () => {
      // The reason `awaiting` is api's two-column predicate and not a question about the state: a closed referral
      // with no answer is exactly what keeps its case on the awaiting-confirmation worklist.
      const view = buildReferralDetail({ ...AWAITING, state: "Closed" });

      expect(view.confirmation?.awaiting).toBe(true);
    });

    it("should offer nothing for an answer that somehow arrived without a request, but still show it", () => {
      // api checks already-recorded before never-asked, so this row would be refused a second answer rather than
      // told it was never asked. Unreachable through the contract; the view must not claim it is waiting.
      const view = buildReferralDetail({ ...CONFIRMED, confirmationRequestedAt: null });

      expect(view.confirmation).toMatchObject({ awaiting: false, requestedOn: "Not recorded", outcome: "The applicant wants to proceed" });
    });

    it("should label every outcome api publishes and offer them as radios in its own order", () => {
      for (const outcome of CONFIRMATION_OUTCOME) {
        expect(CONFIRMATION_OUTCOME_LABEL[outcome]).toBeTruthy();
      }
      expect(CONFIRMATION_OUTCOME_CHOICES).toEqual([
        { value: "Confirmed", text: "The applicant wants to proceed" },
        { value: "Withdrawn", text: "The applicant does not want to proceed" }
      ]);
      expect(CONFIRMATION_OUTCOME_CHOICES.map((choice) => choice.value)).toEqual([...CONFIRMATION_OUTCOME]);
    });

    it("should ask the radios and read the answer back in the same words, so one answer is not two facts", () => {
      const recorded = buildReferralDetail(CONFIRMED).confirmation;

      expect(CONFIRMATION_OUTCOME_CHOICES.map((choice) => choice.text)).toContain(recorded?.outcome);
    });

    it("should say nothing about a refund or an enrolment, which nobody has decided yet", () => {
      // `notify-3b` decision 8 and flag 1: the answer is recorded, and what the office does next about the
      // case's dates is an open business question this app must not answer.
      for (const outcome of CONFIRMATION_OUTCOME) {
        const label = CONFIRMATION_OUTCOME_LABEL[outcome].toLowerCase();

        expect(label, outcome).not.toContain("refund");
        expect(label, outcome).not.toContain("enrol");
      }
    });
  });

  describe("buildReferralsView", () => {
    it("should format every referral through the same builder the referral page uses", () => {
      const view = buildReferralsView([REFERRAL]);

      expect(view.count).toBe(1);
      expect(view.rows).toEqual([buildReferralDetail(REFERRAL)]);
      // Named values as well as the shape, so this cannot pass by both sides changing together: a row the tab
      // renders is already display text, not the wire's members.
      expect(view.rows[0]).toMatchObject({
        id: "ref-1",
        state: "Awaiting a judge",
        reasons: ["Applicant is a minor", "Other"],
        urgency: "Urgent",
        canWithdraw: true,
        canClose: false
      });
    });

    it("should count a referral whose state api did not publish as live, so no second one is offered", () => {
      const view = buildReferralsView([{ ...REFERRAL, state: null }]);

      expect(view.liveReferral).toEqual({ id: "ref-1", state: "Not recorded", message: "stateUnknown" });
      expect(view.offerRaise).toBe(false);
    });

    it("should keep api's order rather than re-sorting, since listReferrals answers newest first", () => {
      const older = { ...REFERRAL, id: "ref-0", createdOn: new Date("2026-01-01T08:44:00Z") };

      const view = buildReferralsView([REFERRAL, older]);

      expect(view.rows.map((row) => row.id)).toEqual(["ref-1", "ref-0"]);
    });

    it("should report a case with no referrals as an empty tab rather than failing", () => {
      const view = buildReferralsView([]);

      expect(view).toEqual({ rows: [], count: 0, liveReferral: null, unavailable: false, offerRaise: true });
    });

    it.each(["Open", "Claimed", "Decided"] as const)("should count a %s referral as live, so no second one is offered", (state) => {
      const view = buildReferralsView([{ ...REFERRAL, state }]);

      expect(view.liveReferral?.id).toBe("ref-1");
      expect(view.offerRaise).toBe(false);
    });

    it.each([
      { state: "Open" as const, message: "withJudiciary" },
      { state: "Claimed" as const, message: "withJudiciary" },
      // The message the old `anyOpen` could not tell apart, and the whole reason this replaced it: a tab that
      // told a caseworker to withdraw the referral they were being asked to action.
      { state: "Decided" as const, message: "directionReceived" }
    ])("should ask the page for the $message message while a $state referral is live", ({ state, message }) => {
      expect(buildReferralsView([{ ...REFERRAL, state }]).liveReferral).toEqual({
        id: "ref-1",
        state: REFERRAL_STATE_LABEL[state],
        message
      });
    });

    it("should name a message key rather than a sentence, so the words stay in the page's en and cy", () => {
      // A library answering English here would be the one string Welsh could not reach.
      const view = buildReferralsView([{ ...REFERRAL, state: "Decided" }]);

      expect(view.liveReferral?.message).toBe("directionReceived");
      expect(view.liveReferral?.message).not.toContain(" ");
    });

    // A read that succeeded is a claim about the case, however it turned out — which is the distinction
    // `unavailableReferralsView` exists to keep, so it is worth pinning from this side too.
    it("should report a successful read as available, so an empty case is not confused with a failed one", () => {
      expect(buildReferralsView([]).unavailable).toBe(false);
      expect(buildReferralsView([REFERRAL]).unavailable).toBe(false);
    });

    it("should report no live referral when every one of them is closed or withdrawn", () => {
      const view = buildReferralsView([
        { ...REFERRAL, id: "ref-2", state: "Withdrawn" },
        { ...REFERRAL, id: "ref-1", state: "Closed" }
      ]);

      expect(view.liveReferral).toBeNull();
      expect(view.offerRaise).toBe(true);
      expect(view.count).toBe(2);
    });

    it("should offer another referral once a returned direction has been actioned and the referral closed", () => {
      // The end of the journey this plan completes: closing is what lets the case be referred again.
      const view = buildReferralsView([{ ...DECIDED, state: "Closed" }]);

      expect(view.liveReferral).toBeNull();
      expect(view.offerRaise).toBe(true);
      // And the direction is still on the row, so the history says what was directed.
      expect(view.rows[0].direction).toMatchObject({ decision: "Approved" });
    });

    it("should find the live referral in a history that also holds closed ones", () => {
      const view = buildReferralsView([REFERRAL, { ...REFERRAL, id: "ref-0", state: "Withdrawn" }]);

      expect(view.liveReferral?.id).toBe("ref-1");
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
