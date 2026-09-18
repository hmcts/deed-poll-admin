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
import { REFERRAL_REASON, type Referral, type ReferralReason, type ReferralState, URGENCY, type Urgency } from "@hmcts/deed-poll-api-client";
import { formatTimestamp, NOT_RECORDED } from "../deed-poll/case-header.js";
import { NOT_PROVIDED } from "../deed-poll/detail-view.js";

/**
 * The two states a referral cannot leave, as api's `ReferralState` documents them.
 *
 * The **only** state rule this repo keeps, and it decides a control's visibility and nothing else: a
 * withdraw of a terminal referral is api's 409, which the page renders as a message. Offering the button and
 * letting api refuse it would be honest but would put the refusal after the click on the one path a
 * caseworker can see is pointless before it. Anything beyond "is this state terminal" — who may claim, what a
 * decision permits — is api's and stays there.
 */
const TERMINAL_STATES: readonly ReferralState[] = ["Closed", "Withdrawn"];

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
 */
export function buildReferralDetail(referral: Referral): ReferralView {
  return {
    id: referral.id,
    // Already display words ("Open", "Withdrawn"), so no label map: one would be five identity entries to
    // maintain. Absent means api did not publish one, which is a claim about the read rather than the data.
    state: referral.state ?? NOT_RECORDED,
    stateTagClasses: referral.state ? REFERRAL_STATE_TAG[referral.state] : "govuk-tag--grey",
    reasons: referral.reasons.map((reason) => REFERRAL_REASON_LABEL[reason as ReferralReason] ?? reason),
    migrated: referral.migrated,
    notes: text(referral.notes),
    urgency: referral.urgency ? REFERRAL_URGENCY_LABEL[referral.urgency] : NOT_PROVIDED,
    urgencyReason: text(referral.urgencyReason),
    createdBy: author(referral.createdBy),
    createdOn: formatTimestamp(referral.createdOn),
    modifiedBy: author(referral.modifiedBy),
    modifiedOn: formatTimestamp(referral.modifiedOn),
    // Unknown counts as not terminal, so the control is offered and api gets the final word. The alternative
    // hides a withdraw a caseworker is entitled to because a field did not arrive.
    terminal: referral.state !== null && referral.state !== undefined && TERMINAL_STATES.includes(referral.state)
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
 * **`anyOpen` is `terminal` asked of the list, and nothing more.** It decides whether the tab offers "Raise a
 * referral", because a case holds at most one live referral and api answers 409 for the second — the button is
 * hidden so the refusal does not arrive after the form is filled in. It is not a claim about what else may
 * happen to those referrals: who may claim one, and whether a withdraw is allowed, stay api's (decision 10).
 */
export function buildReferralsView(referrals: Referral[]): ReferralsView {
  const rows = referrals.map(buildReferralDetail);

  return { rows, count: rows.length, anyOpen: rows.some((row) => !row.terminal) };
}

/** A stored free-text value, or the placeholder for one never filled in. */
function text(raw: string | null | undefined): string {
  const value = typeof raw === "string" ? raw.trim() : "";

  return value.length > 0 ? value : NOT_PROVIDED;
}

/** A stored author name, or the placeholder for a referral predating the audit columns. */
function author(raw: string | null | undefined): string {
  const name = typeof raw === "string" ? raw.trim() : "";

  return name.length > 0 ? name : NOT_RECORDED;
}

/** One referral, every cell already a display string. */
export interface ReferralView {
  id: string;
  state: string;
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
  /** Closed or withdrawn, so there is nothing left to withdraw. See `TERMINAL_STATES`. */
  terminal: boolean;
}

/** A case's referral history, as the detail page's referrals tab renders it. */
export interface ReferralsView {
  /** Newest first, as api answered them. */
  rows: ReferralView[];
  /** Row count, shown as a caption above the list. */
  count: number;
  /** True while one referral is still with the judiciary, so no second one can be raised. */
  anyOpen: boolean;
}
