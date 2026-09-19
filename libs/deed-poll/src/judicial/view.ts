/**
 * View models for the judicial screens: the shared pool's rows, and one referral as the judge who may see it
 * reads it.
 *
 * Here rather than in the pages for the reason `../referrals/referrals-view.ts` gives — a template cannot
 * format a timestamp without a bespoke Nunjucks environment, and a view model can be tested directly — plus
 * one this area adds: **what a judge is shown must be decidable in one place.** The pool row and the referral
 * view are two renderings of the same referral, and the field a judge must not see is the field that gets
 * added to one of them and not noticed on the other.
 *
 * **Nothing here enriches, filters or re-orders.** api sends a deliberately narrow application projection
 * (`JudicialCaseView`) and a pool already ordered urgent-first then longest-waiting, so this file formats
 * exactly what arrived: no second call, no local sort, no field the DTO does not carry. `referrals-admin-3`
 * decisions 3 and 4, and the reason the disclosure boundary is api's rather than this app's — a client filter
 * would be a second opinion about a question api's own architecture test already answers.
 *
 * **The labels are shared with the caseworker's side, the fields are not.** `referralReasonLabel` and
 * `REFERRAL_URGENCY_LABEL` are the business's wording for api's enum members, and a judge reading different
 * words for the reasons a caseworker picked is the drift those maps exist to prevent. That is the opposite of
 * sharing a *record*: `JudicialCaseView` stays its own type all the way to the template.
 */
import {
  type JudicialCaseNote,
  type JudicialCaseView,
  type JudicialReferralDetail,
  type JudicialReferralSummary,
  MASTER_DECISION
} from "@hmcts/deed-poll-api-client";
import { formatTimestamp, NOT_RECORDED } from "../deed-poll/case-header.js";
import { NOT_PROVIDED } from "../deed-poll/detail-view.js";
import { DEED_POLL_TYPE_LABEL, MASTER_DECISION_LABEL } from "../deed-poll/enums/dynamics-values.js";
import type { MasterDecision } from "../deed-poll/enums/option-sets.js";
import { REFERRAL_STATE_TAG, REFERRAL_URGENCY_LABEL, referralReasonLabel } from "../referrals/referrals-view.js";

/**
 * The decision radios on the direction form, in api's published order.
 *
 * Built from the client's member array through the label map, exactly as `REFERRAL_REASON_CHOICES` is, so a
 * member added at api's end reaches the form without an edit here. **The members are `MasterDecision`'s and
 * never a judicial enum of their own** (`referrals-api-2` decision 5): the same two words a case's own
 * `masterDecision` column carries, which is what lets a direction recorded here be read back off the case.
 */
export const DIRECTION_DECISION_CHOICES: { value: MasterDecision; text: string }[] = MASTER_DECISION.map((decision) => ({
  value: decision,
  text: MASTER_DECISION_LABEL[decision]
}));

/**
 * The pool's rows, in api's order.
 *
 * **No state column, and that is not an omission.** api's pool is `Open` only, so a column of identical tags
 * would be furniture; the state is on the referral view, where a claimed or decided one can also be read.
 *
 * **No case fields, because the DTO carries none** — a pool row naming the applicant would make the queue a
 * list of applications a judge has not been asked to see, which is api's decision 2 and the reason there is no
 * case id in any judicial URL. What a judge chooses from is the urgency, the reasons and the wait.
 *
 * `isUrgent` is for the tag's colour and never for the ordering: the queue is already in api's order, and a
 * page that sorted by this flag would be deciding urgency locally.
 */
export function buildPoolRows(referrals: JudicialReferralSummary[]): PoolRow[] {
  return referrals.map((referral) => ({
    id: referral.id,
    reasons: referral.reasons.map(referralReasonLabel),
    urgency: referral.urgency ? REFERRAL_URGENCY_LABEL[referral.urgency] : NOT_PROVIDED,
    isUrgent: referral.urgency === "Urgent",
    // api's `createdOn`, formatted — not an age in days. The wait is what the pool is ordered by and a
    // computed "3 days" cannot be re-read tomorrow.
    waitingSince: formatTimestamp(referral.createdOn)
  }));
}

/**
 * One referral, its application and its timeline — one payload, one screen.
 *
 * **`claimable` and `directable` govern which control is offered and nothing else.** api re-checks both and
 * answers 409, so these are the two cases a judge can see are pointless before the click; every other outcome
 * is api's word. `directable` is `Claimed` without asking *who* claimed it, because api's visibility admits a
 * claimed referral only to its holder — `claimedBy` can name this caller or nobody, so a comparison here would
 * re-derive a fact the 404 has already established.
 *
 * **An unknown state offers neither control**, which is the opposite of `buildReferralDetail`'s choice for
 * withdraw and deliberately so: there, withholding a control a caseworker is entitled to is the worse failure;
 * here, a claim button on a referral in an unknown state invites a judge to take work the pool may have moved
 * on from.
 *
 * `direction` is present when api has recorded one, which is how a judge re-reads their own decided referral —
 * the one thing on this screen that is neither the application nor the pool.
 */
export function buildJudicialReferral(detail: JudicialReferralDetail): JudicialReferralView {
  return {
    id: detail.id,
    // Already display words ("Open", "Claimed"), so no label map — the same reasoning as the caseworker's
    // referral view. Absent means api published none, which is a claim about the read rather than the data.
    state: detail.state ?? NOT_RECORDED,
    stateTagClasses: detail.state ? REFERRAL_STATE_TAG[detail.state] : "govuk-tag--grey",
    reasons: detail.reasons.map(referralReasonLabel),
    notes: orPlaceholder(detail.notes),
    urgency: detail.urgency ? REFERRAL_URGENCY_LABEL[detail.urgency] : NOT_PROVIDED,
    isUrgent: detail.urgency === "Urgent",
    urgencyReason: orPlaceholder(detail.urgencyReason),
    waitingSince: formatTimestamp(detail.createdOn),
    claimedOn: detail.claimedAt === null || detail.claimedAt === undefined ? null : formatTimestamp(detail.claimedAt),
    claimable: detail.state === "Open",
    directable: detail.state === "Claimed",
    application: buildApplicationView(detail.application),
    caseNotes: (detail.caseNotes ?? []).map(buildNoteRow),
    direction: buildDirectionView(detail)
  };
}

/**
 * The narrow application view: a reference, a type, and both names in full.
 *
 * **Exactly the eight fields `JudicialCaseView` carries.** No fee, no payment reference, no privacy
 * editability, no audit trail — not because they are filtered here but because api does not send them, which is
 * the only place that boundary can be enforced (`referrals-api-3` flag 1, confirmed 2026-09-17). A field
 * appearing on this screen that a judge must not see is a change to api's DTO, so there is nothing to add here
 * when one is wanted and nothing to remove when one must go.
 *
 * `null` when api sent no application at all. A referral is always about one, so this is a shape the type
 * permits rather than a state anyone expects — and the page says so instead of rendering four placeholders,
 * which would read as an application with no name.
 *
 * Both names are joined from their three components rather than shown part by part: a deed poll is about the
 * whole name, and "John Peter Smith" beside "John Peter Smyth" hides the only part that moved if the middle
 * name is dropped from either.
 */
function buildApplicationView(application: JudicialCaseView | null | undefined): ApplicationView | null {
  if (application === null || application === undefined) return null;

  return {
    reference: orPlaceholder(application.displayReference, NOT_RECORDED),
    type: application.type ? DEED_POLL_TYPE_LABEL[application.type] : NOT_RECORDED,
    oldName: fullName(application.oldForename, application.oldMiddleName, application.oldSurname),
    newName: fullName(application.newForename, application.newMiddleName, application.newSurname)
  };
}

/**
 * One note from the application's timeline, read-only.
 *
 * Narrower than the caseworker's note row and without its short code, because no judicial route takes a note
 * id: there is nothing to link to, and a judge writes no notes — api's judicial writes are exactly claim and
 * direct. An unattributed note still renders; the author placeholder says which of the two is missing.
 */
function buildNoteRow(note: JudicialCaseNote): JudicialNoteRow {
  return {
    note: note.note,
    createdBy: orPlaceholder(note.createdBy, NOT_RECORDED),
    createdOn: formatTimestamp(note.createdOn)
  };
}

/**
 * The direction api has recorded, or `null` for a referral that has none yet.
 *
 * Keyed on `decision` being present rather than on `state === "Decided"`, so what is shown is what api sent:
 * the two agree, and when they disagree the field is the more specific answer.
 *
 * `publishToGazette` stays a boolean rather than becoming "Yes"/"No" here. Every other value on these models is
 * a display string, and this one is the exception because a page's own `en`/`cy` owns those two words — a
 * library that hard-coded "Yes" would be the one English string Welsh could not reach.
 */
function buildDirectionView(detail: JudicialReferralDetail): DirectionView | null {
  if (detail.decision === null || detail.decision === undefined) return null;

  return {
    decision: MASTER_DECISION_LABEL[detail.decision],
    directionsText: orPlaceholder(detail.directionsText),
    publishToGazette: detail.publishToGazette ?? null,
    decidedOn: formatTimestamp(detail.decisionDate)
  };
}

/** The name components as a name, or the placeholder when api holds none of them. */
function fullName(...parts: (string | null | undefined)[]): string {
  const name = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join(" ");

  return name.length > 0 ? name : NOT_PROVIDED;
}

/**
 * A stored free-text value, or the placeholder for one that was never filled in — trimmed first, so a value
 * that is only whitespace reads as absent rather than as a blank cell.
 *
 * A private copy of `../referrals/referrals-view.ts`'s helper rather than a shared one: it is three lines of
 * formatting with no rule in it, and the name that would have to go on this package's flat public surface to
 * share it (`orPlaceholder`) says nothing about the domain it belongs to.
 */
function orPlaceholder(raw: string | null | undefined, placeholder: string = NOT_PROVIDED): string {
  const value = typeof raw === "string" ? raw.trim() : "";

  return value.length > 0 ? value : placeholder;
}

/** One row of the shared pool, every cell already a display string. */
export interface PoolRow {
  /** The referral's id — the only key any judicial URL takes. */
  id: string;
  reasons: string[];
  urgency: string;
  /** For the tag's colour. The word is printed too, so urgency is never carried by colour alone. */
  isUrgent: boolean;
  /** The referral's `createdOn`, formatted. api's second sort key, shown as the wait it is. */
  waitingSince: string;
}

/** The narrow application projection, formatted. Exactly what `JudicialCaseView` carries and nothing else. */
export interface ApplicationView {
  reference: string;
  type: string;
  oldName: string;
  newName: string;
}

/** One note from the application's timeline, as a judge reads it: no id, no amend link. */
export interface JudicialNoteRow {
  note: string;
  createdBy: string;
  createdOn: string;
}

/** The direction recorded on a referral. `publishToGazette` is a boolean — see `buildDirectionView`. */
export interface DirectionView {
  decision: string;
  directionsText: string;
  publishToGazette: boolean | null;
  decidedOn: string;
}

/** One referral as the judicial screens render it: the referral, its application, and its timeline. */
export interface JudicialReferralView {
  id: string;
  state: string;
  stateTagClasses: string;
  reasons: string[];
  /** The referral's own free text — not the application's timeline, which is `caseNotes`. */
  notes: string;
  urgency: string;
  isUrgent: boolean;
  urgencyReason: string;
  waitingSince: string;
  /** When this judge picked it up, or `null` while it is still in the pool. */
  claimedOn: string | null;
  /** `Open`, so the claim control is offered. api re-checks and 409s regardless. */
  claimable: boolean;
  /** `Claimed`, which api's visibility means claimed *by this judge* — so the direction control is offered. */
  directable: boolean;
  /** `null` only when api sent no application, which is a shape its type permits rather than a real state. */
  application: ApplicationView | null;
  /** Read-only. A judge's writes are claim and direct; there is no add-note control on these screens. */
  caseNotes: JudicialNoteRow[];
  /** The direction already recorded, or `null` for a referral still awaiting one. */
  direction: DirectionView | null;
}
