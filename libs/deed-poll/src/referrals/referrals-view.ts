/**
 * View model for the referral pages: the human wording for api's enum members, and one referral formatted
 * for display.
 *
 * Exists for the same reason `../documents/documents-view.ts` does — a template cannot format a timestamp
 * without a bespoke Nunjucks environment, and a view model can be tested directly — plus one reason of its
 * own: the referral labels are needed by the raise form, the referral view and the case's referrals tab, and
 * three copies of "Applicant is a minor" is three places for the business's wording to drift.
 *
 * **The wire values are api's, the labels are ours.** `REFERRAL_REASON` and `URGENCY` are api's enum members
 * and go on the wire unchanged; what a caseworker reads is this repo's choice, exactly as
 * `../deed-poll/enums/dynamics-values.ts` chooses the case labels. So the maps below are keyed by the member
 * arrays rather than restating them: a member added at api's end is a type error here instead of a blank cell.
 *
 * **`REFERRAL_URGENCY_LABEL` deliberately disagrees with `URGENCY_LABEL`.** That map labels the *case's*
 * urgency, where `Normal` means the ordinary queue; a referral's `Normal` means "no particular hurry", and
 * "Standard" is what the business calls it. Same api enum, two questions, two wordings.
 */
import {
  CONFIRMATION_OUTCOME,
  type ConfirmationOutcome,
  REFERRAL_REASON,
  type Referral,
  type ReferralReason,
  type ReferralState,
  URGENCY,
  type Urgency
} from "@hmcts/deed-poll-api-client";
import { formatTimestamp, NOT_RECORDED } from "../deed-poll/case-header.js";
import { NOT_PROVIDED } from "../deed-poll/detail-view.js";
import { MASTER_DECISION_LABEL, TERMINAL_REFERRAL_STATES } from "../deed-poll/enums/dynamics-values.js";

/** Why a case is referred, in the words the business uses for each of api's members. */
export const REFERRAL_REASON_LABEL: Record<ReferralReason, string> = {
  Minor: "Applicant is a minor",
  DomesticAbuse: "Domestic abuse considerations",
  NonPublication: "Non-publication request",
  DeclarantRequirementsNotMet: "Declarant requirements not met",
  SeparatedOrEstranged: "Separated or estranged",
  Other: "Other"
};

/** A referral's own urgency. See the docblock for why `Normal` reads "Standard" here and "Normal" on a case. */
export const REFERRAL_URGENCY_LABEL: Record<Urgency, string> = {
  Normal: "Standard",
  Urgent: "Urgent"
};

/**
 * What a caseworker reads where api publishes a state — the "Referral status" on the table and the detail page.
 *
 * **The raw member is not shown any more.** api's words describe its own state machine ("Decided", "Closed"),
 * and a caseworker reading "Decided" learns that something happened rather than that there is a direction
 * waiting for them to carry out. `referrals-admin-4` decision 3: the referral's status is the caseworker's
 * question, api's enum is the wire.
 *
 * Keyed by `ReferralState` so a member added at api's end is a type error here rather than a blank cell, like
 * every other map in this file. See `REFERRAL_STATE_MEANING` for the sentence that goes with each label.
 */
export const REFERRAL_STATE_LABEL: Record<ReferralState, string> = {
  Open: "Awaiting a judge",
  Claimed: "With a judge",
  Decided: "Direction received",
  Closed: "Direction actioned",
  Withdrawn: "Withdrawn"
};

/**
 * What each status means for the case in front of the caseworker, shown beside the label.
 *
 * The labels above are short enough for a tag; these say what to do about one. `Decided` is the reason the map
 * exists — "Direction received — action needed" is the whole point of the state, and the referral is neither
 * finished nor still with the judiciary — but every state gets one, so the page never has a sentence for some
 * rows and nothing for others.
 *
 * **Not the application's status.** A direction does not decide whether the case next awaits forms, enrolment
 * or a return; the caseworker makes those updates and then marks the referral actioned (decision 3). Nothing
 * here is derived from or writes to `DeedPollState`.
 */
export const REFERRAL_STATE_MEANING: Record<ReferralState, string> = {
  Open: "Waiting for a judge to claim",
  Claimed: "Being considered by the judiciary",
  Decided: "Direction received — action needed",
  Closed: "Direction actioned",
  Withdrawn: "Withdrawn before a direction"
};

/**
 * Tag colour per state, so the lifecycle is scannable in a list.
 *
 * Blue for work not yet picked up, purple for work in someone's hands, green for a referral that has an
 * answer, grey for the two that are over. Colour is never the only carrier — the tag prints its state.
 */
export const REFERRAL_STATE_TAG: Record<ReferralState, string> = {
  Open: "govuk-tag--blue",
  Claimed: "govuk-tag--purple",
  Decided: "govuk-tag--green",
  Closed: "govuk-tag--grey",
  Withdrawn: "govuk-tag--grey"
};

/**
 * What the applicant said, in the words the form asks the question in.
 *
 * **One map for both the radios and the recorded answer**, deliberately: a caseworker who ticked "The applicant
 * wants to proceed" must read the same sentence back off the referral afterwards, and two wordings for one
 * answer would look like two different facts.
 *
 * The words are about what the APPLICANT wants and never about what the office will do. api's `Withdrawn` member
 * is the applicant asking for a refund, so "Withdrawn" alone would read as the referral having been withdrawn —
 * a different event with its own state on the same referral. Nothing here says a refund has been issued or that
 * a case is ready for enrolment: that is the open business question of `notify-3b` flag 1.
 */
export const CONFIRMATION_OUTCOME_LABEL: Record<ConfirmationOutcome, string> = {
  Confirmed: "The applicant wants to proceed",
  Withdrawn: "The applicant does not want to proceed"
};

/** The answer radios, in api's published order. Built from the member array, never typed out. */
export const CONFIRMATION_OUTCOME_CHOICES: { value: ConfirmationOutcome; text: string }[] = CONFIRMATION_OUTCOME.map((outcome) => ({
  value: outcome,
  text: CONFIRMATION_OUTCOME_LABEL[outcome]
}));

/** The reason checkboxes, in api's published order. Built from the member array, never typed out. */
export const REFERRAL_REASON_CHOICES: { value: ReferralReason; text: string }[] = REFERRAL_REASON.map((reason) => ({
  value: reason,
  text: REFERRAL_REASON_LABEL[reason]
}));

/** The urgency radios, in api's published order. */
export const REFERRAL_URGENCY_CHOICES: { value: Urgency; text: string }[] = URGENCY.map((urgency) => ({
  value: urgency,
  text: REFERRAL_URGENCY_LABEL[urgency]
}));

/**
 * One referral formatted for display.
 *
 * `reasons` is the stored strings mapped through the label map, and an **unrecognised one is printed as it
 * stands** rather than dropped: api publishes the column as plain strings precisely because a backfilled or
 * hand-corrected row may hold something the enum no longer lists, and a reason silently missing from a
 * referral's page is worse than an unfamiliar word on it.
 *
 * A migrated referral has an empty `reasons` array — the source store had no such field — so `migrated` is
 * carried for the page to say so instead of rendering a blank cell that reads as a bug.
 *
 * **`canWithdraw` and `canClose` are the two capabilities, and neither is "not terminal".** api answers 409
 * for a withdrawal of anything but `Open`/`Claimed` and for a closure of anything but `Decided`, so these
 * withhold the two controls a caseworker can see are pointless before the click and nothing more — api is
 * still the authority and may refuse a stale page. `Decided` is where the old single `terminal` flag was
 * wrong in both directions: it is not terminal, so a raise is still refused, and it is not withdrawable
 * either, so the withdraw button had no business being on it.
 *
 * **An unknown state offers neither**, which reverses the earlier rule that offered the withdraw and let api
 * decide. That argument rested on "not terminal" being evidence of withdrawability, which `Decided` disproved:
 * a state this app cannot read is now as likely to be one that must be closed as one that may be taken back,
 * and a warning button on a referral nobody can describe is worse than a caseworker having to reload.
 */
export function buildReferralDetail(referral: Referral): ReferralView {
  const state = referral.state ?? null;

  return {
    id: referral.id,
    // The caseworker's words, not api's member — see `REFERRAL_STATE_LABEL`. Absent means api published no
    // state, which is a claim about the read rather than about the referral.
    state: state ? REFERRAL_STATE_LABEL[state] : NOT_RECORDED,
    // Null rather than a placeholder sentence: there is nothing true to say about a state this app cannot
    // read, and the page leaves the line out instead of explaining an unknown.
    stateMeaning: state ? REFERRAL_STATE_MEANING[state] : null,
    stateTagClasses: state ? REFERRAL_STATE_TAG[state] : "govuk-tag--grey",
    reasons: referral.reasons.map(referralReasonLabel),
    migrated: referral.migrated,
    notes: orPlaceholder(referral.notes, NOT_PROVIDED),
    urgency: referral.urgency ? REFERRAL_URGENCY_LABEL[referral.urgency] : NOT_PROVIDED,
    urgencyReason: orPlaceholder(referral.urgencyReason, NOT_PROVIDED),
    createdBy: orPlaceholder(referral.createdBy, NOT_RECORDED),
    createdOn: formatTimestamp(referral.createdOn),
    modifiedBy: orPlaceholder(referral.modifiedBy, NOT_RECORDED),
    modifiedOn: formatTimestamp(referral.modifiedOn),
    live: isLive(state),
    canWithdraw: state === "Open" || state === "Claimed",
    canClose: state === "Decided",
    claim: buildClaimView(referral),
    direction: buildDirectionView(referral),
    confirmation: buildConfirmationView(referral)
  };
}

/**
 * The referrals tab on the case detail page: every referral formatted, plus the one question the tab asks of
 * the set.
 *
 * **api's order is kept.** `listReferrals` answers newest first, which is the order a history is read in, and
 * a second sort here would be this repo deciding something api has already decided — the mistake
 * `../notes/notes-view.ts` documents itself as *not* making only because its callers disagree on order.
 *
 * **`liveReferral` replaces the old `anyOpen`, which named only one of the three live states.** A case holds at
 * most one referral that is not terminal — api answers 409 for the second — and that one may be `Open`,
 * `Claimed` or `Decided`. The old name read as "one is waiting to be claimed", which made the tab tell a
 * caseworker with a returned direction in front of them to withdraw it before raising another.
 *
 * So `message` says which of the three the tab is looking at, and the page owns the words: a `Decided`
 * referral needs actioning, not withdrawing. It is a key rather than a sentence because the copy is the
 * page's `en`/`cy` — a library that answered English here would be the one string Welsh could not reach.
 *
 * **`offerRaise` is the one the template reads for the button**, and it is not `not liveReferral`: it is also
 * withheld when the read failed. Computed here rather than in the template because two booleans in the wrong
 * order offer a control on a panel that knows nothing — see `unavailableReferralsView`.
 */
export function buildReferralsView(referrals: Referral[]): ReferralsView {
  const rows = referrals.map(buildReferralDetail);
  // The wire records rather than the rows, because the message is keyed on api's state and a row carries the
  // caseworker's label for it. `find` and not a filter: api allows one, and a second would be its bug to fix.
  const live = referrals.find((referral) => isLive(referral.state ?? null));

  return {
    rows,
    count: rows.length,
    liveReferral: live
      ? { id: live.id, state: live.state ? REFERRAL_STATE_LABEL[live.state] : NOT_RECORDED, message: liveReferralMessage(live.state ?? null) }
      : null,
    unavailable: false,
    offerRaise: live === undefined
  };
}

/**
 * The tab when the referrals read failed, so the panel degrades rather than the page — the decision is
 * `src/pages/deed-polls/[id].ts`'s and its reasoning is there.
 *
 * **`unavailable` is a third state and deliberately not `count: 0`.** The two say opposite things to a
 * caseworker: "this case has never been referred" is a fact, and "we could not find out" is the absence of
 * one. Rendering the second as the first would tell someone a case is free of the judiciary when it may not
 * be, on a page that otherwise looks normal — api's 409 stops a second referral being stored, so nothing is
 * corrupted, but the caseworker would have been misinformed by the page rather than refused by api.
 *
 * `offerRaise` is false for the reason it is false while one is open, and one more: the raise form reads the
 * same endpoint, so the button would lead to a page that cannot load either.
 */
export function unavailableReferralsView(): ReferralsView {
  return { rows: [], count: 0, liveReferral: null, unavailable: true, offerRaise: false };
}

/**
 * One stored reason in the business's words, or as api stored it.
 *
 * `Object.hasOwn` rather than `??`, because the wire type is `string[]` and an inherited member name —
 * `"constructor"`, `"toString"` — would otherwise resolve to a function off `Object.prototype` and reach the
 * page as a reason. The same backfilled-or-hand-corrected row the docblock above anticipates is exactly where
 * an arbitrary string comes from.
 *
 * **Exported for `../judicial/view.ts`**, which renders the same reasons on the judge's side of the referral.
 * The caseworker chose them and the judge reads them, so two wordings for one list would have the two personas
 * discussing different reasons — the drift this file's label maps exist to prevent, one layer out.
 */
export function referralReasonLabel(reason: string): string {
  return Object.hasOwn(REFERRAL_REASON_LABEL, reason) ? REFERRAL_REASON_LABEL[reason as ReferralReason] : reason;
}

/**
 * Is this the case's live referral — the one that stops a second being raised?
 *
 * **api's `isTerminal()` negated, and deliberately not its `canBeWithdrawn()`.** The two predicates answer
 * different questions and `Decided` is where they part: it is live, so the case may raise no second referral
 * and still counts as returned for action, and it is not withdrawable, because the direction on it has to be
 * carried out and the referral closed. Collapsing the pair into one flag is how the referrals tab came to
 * offer a withdraw on a returned direction.
 *
 * An unpublished state counts as live, which is the conservative answer for *this* question: withholding the
 * raise costs a reload, while offering it invites a create api answers 409 to.
 */
function isLive(state: ReferralState | null): boolean {
  return state === null || !TERMINAL_REFERRAL_STATES.includes(state);
}

/**
 * The claim, for the lifecycle section — or null on a referral no judge has picked up.
 *
 * Both fields or neither: api sets them together on the claim, so a page that rendered one placeholder beside
 * one name would be describing a state that cannot happen. `claimedBy` survives the direction and the closure,
 * so this stays readable on a `Closed` referral, which is where "who dealt with this" is asked.
 */
function buildClaimView(referral: Referral): ReferralClaimView | null {
  if (referral.claimedBy === null || referral.claimedBy === undefined) return null;

  return { claimedBy: orPlaceholder(referral.claimedBy, NOT_RECORDED), claimedOn: formatTimestamp(referral.claimedAt) };
}

/**
 * The direction a judge returned, or null on a referral that has none.
 *
 * **Present when api recorded a decision, or when the state says there must be one.** `decision` is the more
 * specific answer and the two normally agree; the state is also consulted so a `Decided` or `Closed` referral
 * whose decision did not arrive says which fields are missing rather than hiding the whole section, which on
 * this page would read as "no direction yet" — the one thing that is certainly false.
 *
 * **`directionsText` absent is not the same as no direction.** A judge may approve with no further directions,
 * so this renders the ordinary "not provided" placeholder inside a section that is there; a referral with no
 * direction at all has no section. The two states say different things and must look different.
 *
 * **`publishToGazette` stays a boolean**, as `../judicial/view.ts` keeps it: null means the judge did not
 * answer, and turning that into "No" would record a decision nobody made. The two words belong to the page's
 * `en`/`cy`, not to a library.
 *
 * **`decidedBy` and never `modifiedBy`.** Closing the referral changes the modifier to the caseworker who
 * actioned it, while `decidedBy` stays the judicial author — reading the direction's author off `modifiedBy`
 * would credit the direction to the caseworker the moment they marked it actioned.
 */
function buildDirectionView(referral: Referral): ReferralDirectionView | null {
  const recorded = referral.decision !== null && referral.decision !== undefined;
  if (!recorded && referral.state !== "Decided" && referral.state !== "Closed") return null;

  return {
    decision: referral.decision ? MASTER_DECISION_LABEL[referral.decision] : NOT_RECORDED,
    directionsText: orPlaceholder(referral.directionsText, NOT_PROVIDED),
    publishToGazette: referral.publishToGazette ?? null,
    decidedBy: orPlaceholder(referral.decidedBy, NOT_RECORDED),
    decidedOn: formatTimestamp(referral.decisionDate)
  };
}

/**
 * The applicant's confirmation, or null on a referral that was never asked for one.
 *
 * **Null and not an "awaiting: false" shape**, because "this referral has nothing to do with a confirmation" is
 * not a state of the wait: most referrals were never asked, and a page rendering a section per referral would
 * otherwise say "not recorded" about a question nobody put. api publishes all four columns on every referral, so
 * the absence of both a request and an outcome is the only thing that means this.
 *
 * **`awaiting` is what decides whether the action is offered, and it is presentation rather than enforcement.**
 * api owns the transition and answers 409 for an unasked or an already-answered recording, so a page showing this
 * to a caseworker whose screen has gone stale still cannot record a second answer. It is api's own predicate —
 * a request exists and an outcome does not — and deliberately not keyed on the referral's state: `Closed` clears
 * neither column, so a closed referral can still be waiting for an answer, which is what keeps its case on the
 * worklist.
 *
 * **`recordedOn` is when the caseworker recorded the answer and never when the applicant replied.** api stamps it
 * from its own clock, so no wording built on it may present it as the date of the reply.
 *
 * `outcome` is the label and **not** api's member: every page that has the answer prints it, and the two pages that
 * branch on one branch on `awaiting` instead. A page that has to key a class off the member can read it from the
 * `Referral` it already has — publishing it here against that day would be a field nothing reads, which is how a
 * view model comes to be tested for its own sake.
 */
function buildConfirmationView(referral: Referral): ReferralConfirmationView | null {
  const requested = referral.confirmationRequestedAt ?? null;
  const outcome = referral.confirmationOutcome ?? null;
  if (requested === null && outcome === null) return null;

  return {
    requestedOn: formatTimestamp(requested),
    awaiting: requested !== null && outcome === null,
    outcome: outcome ? CONFIRMATION_OUTCOME_LABEL[outcome] : null,
    recordedOn: outcome ? formatTimestamp(referral.confirmationReceivedAt) : null,
    recordedBy: outcome ? orPlaceholder(referral.confirmationRecordedBy, NOT_RECORDED) : null
  };
}

/**
 * Which message the referrals tab shows in place of the raise button, given the live referral's state.
 *
 * A key and not a sentence, so the page's `en`/`cy` owns the copy. Three cases because there are three things
 * to say: one is with the judiciary and will come back, one has come back and needs actioning, and one is in a
 * state this app cannot read — which is not the same as the read having failed (`unavailableReferralsView`)
 * and so cannot borrow that message.
 */
function liveReferralMessage(state: ReferralState | null): LiveReferralMessage {
  if (state === "Decided") return "directionReceived";

  return state === null ? "stateUnknown" : "withJudiciary";
}

/**
 * A stored free-text value, or the placeholder for one that was never filled in.
 *
 * Trimmed first, so a value that is only whitespace reads as absent rather than as a blank cell. The
 * placeholder is the caller's because the two questions differ: a note nobody wrote is "not provided", an
 * author on a referral predating the audit columns is "not recorded".
 */
function orPlaceholder(raw: string | null | undefined, placeholder: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";

  return value.length > 0 ? value : placeholder;
}

/** One referral, every cell already a display string. */
export interface ReferralView {
  id: string;
  /** The caseworker's label for api's state — "Direction received", not "Decided". `REFERRAL_STATE_LABEL`. */
  state: string;
  /** What that status means for this case, or null when api published no state. `REFERRAL_STATE_MEANING`. */
  stateMeaning: string | null;
  stateTagClasses: string;
  reasons: string[];
  /** Backfilled from the power app, so it carries no reasons and the page says why. */
  migrated: boolean;
  notes: string;
  urgency: string;
  urgencyReason: string;
  createdBy: string;
  createdOn: string;
  modifiedBy: string;
  modifiedOn: string;
  /**
   * The case's live referral — not closed or withdrawn — so no second one may be raised beside it. api's
   * `isTerminal()` negated, and **not** the same question as `canWithdraw`: see `isLive`.
   */
  live: boolean;
  /** `Open` or `Claimed`, so a withdrawal is worth offering. api still decides — see `buildReferralDetail`. */
  canWithdraw: boolean;
  /** `Decided`, so there is a direction to mark as actioned. */
  canClose: boolean;
  /** The judge's claim, or null on a referral nobody has picked up. */
  claim: ReferralClaimView | null;
  /** The returned direction, or null on a referral that has none. */
  direction: ReferralDirectionView | null;
  /** The applicant's confirmation, or null on a referral never asked for one — see `buildConfirmationView`. */
  confirmation: ReferralConfirmationView | null;
}

/** The applicant's answer to *Request confirmation to proceed*, as the referral page renders it. */
export interface ReferralConfirmationView {
  /** When the applicant was asked. */
  requestedOn: string;
  /** Asked and not yet answered, so the "Record applicant response" action is worth offering. */
  awaiting: boolean;
  /** What they said, in the words the form asked it in — or null while no answer is recorded. */
  outcome: string | null;
  /** When a caseworker RECORDED the answer, never when the applicant sent it. Null until one is recorded. */
  recordedOn: string | null;
  /** Who recorded it, from api's token-derived name. Null until one is recorded. */
  recordedBy: string | null;
}

/** Who is holding, or held, the referral. Both fields or neither — see `buildClaimView`. */
export interface ReferralClaimView {
  claimedBy: string;
  claimedOn: string;
}

/** The direction a judge returned. `publishToGazette` is a boolean — see `buildDirectionView`. */
export interface ReferralDirectionView {
  decision: string;
  directionsText: string;
  publishToGazette: boolean | null;
  decidedBy: string;
  decidedOn: string;
}

/** A case's referral history, as the detail page's referrals tab renders it. */
export interface ReferralsView {
  /** Newest first, as api answered them. */
  rows: ReferralView[];
  /** Row count, shown as a caption above the list. Meaningless when `unavailable` — nothing was read. */
  count: number;
  /**
   * The referral that is still live, or null when the case has none. Replaces the old `anyOpen`, which named
   * one of the three states it covers — see `buildReferralsView`.
   */
  liveReferral: LiveReferral | null;
  /**
   * The read failed, so no field here is a claim about the case. The panel says so rather than rendering
   * an empty list — see `unavailableReferralsView` for why the two cannot share a state.
   */
  unavailable: boolean;
  /** Whether the panel shows "Raise a referral". False while one is live, false when unavailable. */
  offerRaise: boolean;
}

/** The live referral, as the tab's message and link need it. */
export interface LiveReferral {
  id: string;
  /** Its caseworker-facing status label. */
  state: string;
  /** Which message the tab shows in place of the raise button. The words are the page's. */
  message: LiveReferralMessage;
}

/** The three things the tab may have to say about a live referral. See `liveReferralMessage`. */
export type LiveReferralMessage = "withJudiciary" | "directionReceived" | "stateUnknown";
