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
 * **Nothing here enriches, filters or re-orders.** api sends the judge's own application projection
 * (`JudicialApplicationView`: the names, type, nationality, a minor's parents and the attached documents — narrowed
 * in api on 2026-10-27 from the 2026-10-19 whole-application view) and a pool already ordered
 * urgent-first then longest-waiting. So this file formats exactly what arrived: no second call, no local sort,
 * no field the DTO does not carry. Private cases arrive in full because api decided they should; the disclosure
 * boundary is api's rather than this app's, and a client filter would be a second opinion about a question api's
 * own architecture test already answers.
 *
 * **The labels and formatting are shared with the caseworker's side, the fields are not.** `referralReasonLabel`,
 * `REFERRAL_URGENCY_LABEL`, `FIELD_BY_NAME` and `formatValue` are the business's wording and formatting, and a
 * judge reading different words for the same value is the drift those exist to prevent. That is the opposite of
 * sharing a *record*: `JudicialApplicationView` stays its own type all the way to the template, and
 * `APPLICATION_SECTIONS` names its fields rather than borrowing the caseworker form's.
 */
import {
  type JudicialApplicationView,
  type JudicialDocument,
  type JudicialReferralDetail,
  type JudicialReferralSummary,
  MASTER_DECISION
} from "@hmcts/deed-poll-api-client";
import { formatTimestamp, NOT_RECORDED } from "../deed-poll/case-header.js";
import { getFieldRules } from "../deed-poll/deed-poll-validation.js";
import { formatValue, NOT_PROVIDED } from "../deed-poll/detail-view.js";
import { MASTER_DECISION_LABEL } from "../deed-poll/enums/dynamics-values.js";
import type { MasterDecision } from "../deed-poll/enums/option-sets.js";
import { FIELD_BY_NAME, type FieldDef } from "../deed-poll/form-fields.js";
import { REFERRAL_STATE_TAG, REFERRAL_URGENCY_LABEL, referralReasonLabel } from "../referrals/referrals-view.js";

/**
 * The application's case fields a Master sees, in the order the Masters asked for them (Master Sullivan's feedback,
 * Steve, 2026-10-27): one "General" group, names first.
 *
 * **Typed on `JudicialApplicationView` and listed here, never derived from `FORM_TABS`**, so the judicial page
 * cannot grow a field because the caseworker one did: a name api's judicial view does not carry is a compile
 * error. Only the formatting comes from the caseworker's metadata (`FIELD_BY_NAME`, `formatValue`), and the labels
 * too except where the Masters asked for their own (`MASTER_LABELS`).
 */
const APPLICATION_SECTIONS: { label: string; fields: ApplicationField[] }[] = [
  {
    label: "General",
    fields: [
      "newForename",
      "newMiddleName",
      "newSurname",
      "oldForename",
      "oldMiddleName",
      "oldSurname",
      "type",
      "nationality",
      "nationalitySection",
      "nationalitySectionOther",
      "parents"
    ]
  }
];

/**
 * Labels the Masters asked for in their own words. `parents` is shown only on a minor's application (the caseworker
 * field rules hide it on every other type, and api sends it only for a minor), so it says whose parents they are.
 */
const MASTER_LABELS: Partial<Record<ApplicationField, string>> = { parents: "Minor’s parents’ names" };

/** A document's upload date is a date, as the caseworker's "Added" column is, and not a timestamp. */
const UPLOADED_FIELD: FieldDef = { name: "uploadedOn", label: "Uploaded", kind: "date" };

const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;

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
 * What a judge reads where api publishes the state of a referral they hold.
 *
 * **Their own two words and not the caseworker's** (`referrals-admin-6` decision 2). `REFERRAL_STATE_LABEL` answers
 * a caseworker's question — "With a Master", "Direction received" — which is the wrong side of the same fact: a
 * judge reading "Direction received" about their own claim would be told what the office is waiting for rather than
 * what they still owe. So `Claimed` is the work outstanding and `Decided` the work done, in that order.
 *
 * **Only two states can appear**, because api's membership rule for this list is exactly those two, which is why
 * this map is keyed on them rather than on `ReferralState`. A row in any other state is api contradicting its own
 * filter, and `myReferralStatus` answers the placeholder rather than inventing a word for it.
 */
export const MY_REFERRAL_STATE_LABEL: Record<"Claimed" | "Decided", string> = {
  Claimed: "Direction needed",
  Decided: "Direction recorded"
};

/**
 * The rows of a judge's own list, in api's order.
 *
 * **Formatting and nothing else** (decision 2): no filter, no regroup, no sort. api decides membership from the
 * token's subject and orders the page — unfinished work first, then urgent, then longest-waiting — and it is the
 * same predicate as its visibility rule, so every row here is one whose detail read answers 200. A local opinion
 * about either would be a second answer to a settled question, and a local sort would make the page disagree with
 * its own pagination.
 *
 * **The same narrow summary the pool's rows are built from, and deliberately no more** (decision 3). The DTO is
 * `JudicialReferralSummary`, so there is no applicant name, no case reference and no direction text to show and
 * nothing to fetch them with: enriching a row would mean a call per row, which is both the disclosure boundary and
 * an N+1 over a worklist. The link is keyed on the referral id alone, which is the only key a judicial URL takes.
 *
 * **A status column, where `buildPoolRows` has none.** The pool is `Open` only, so a column of identical tags there
 * would be furniture; here the two states are the whole point of the list — what a judge still owes, and what they
 * have answered and the office has not yet actioned.
 */
export function buildMyReferralRows(referrals: JudicialReferralSummary[]): MyReferralRow[] {
  return referrals.map((referral) => ({
    id: referral.id,
    status: myReferralStatus(referral.state),
    statusTagClasses: referral.state ? REFERRAL_STATE_TAG[referral.state] : "govuk-tag--grey",
    reasons: referral.reasons.map(referralReasonLabel),
    urgency: referral.urgency ? REFERRAL_URGENCY_LABEL[referral.urgency] : NOT_PROVIDED,
    isUrgent: referral.urgency === "Urgent",
    // The date the CASEWORKER raised it, which is what a judge is answering against — and formatted rather than
    // counted, for `buildPoolRows`'s reason: an age in days cannot be sorted or re-read tomorrow.
    raisedOn: formatTimestamp(referral.createdOn)
  }));
}

/**
 * One referral and its application — one payload, one screen. No timeline since 2026-10-27: the Masters asked not to
 * see the case notes, and api no longer sends them.
 *
 * **`claimable`, `directable` and `changeable` govern which control is offered and nothing else.** api re-checks
 * each and answers 409, so these are the cases a judge can see are pointless before the click; every other outcome
 * is api's word. `directable` is `Claimed` without asking *who* claimed it, because api's visibility admits a
 * claimed referral only to its holder — `claimedBy` can name this caller or nobody, so a comparison here would
 * re-derive a fact the 404 has already established. `changeable` is `Decided` for the same reason: api shows a
 * decided referral only to the judge who directed it, and hides it from everyone once the office closes it.
 *
 * **An unknown state offers neither control**, which is the opposite of `buildReferralDetail`'s choice for
 * withdraw and deliberately so: there, withholding a control a caseworker is entitled to is the worse failure;
 * here, a claim button on a referral in an unknown state invites a judge to take work the pool may have moved
 * on from.
 *
 * `direction` is present when api has recorded one, which is how a judge re-reads their own decided referral —
 * the one thing on this screen that is neither the application nor the pool.
 *
 * **`isOnMyList` is which list the referral is on, and therefore the way back to it** (`referrals-admin-6`
 * decision 5). It is the state api has just published rather than a `returnTo` the URL carried: a query parameter
 * would be an open redirect to validate and would be wrong in the ordinary case anyway, since claiming moves the
 * referral between the two lists while the judge is standing on the page they arrived from. It shares its
 * predicate with `myReferralStatus`, so the list that admits a state and the link back to it cannot disagree.
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
    claimedOn: detail.claimedAt === null || detail.claimedAt === undefined ? null : formatTimestamp(detail.claimedAt),
    claimable: detail.state === "Open",
    directable: detail.state === "Claimed",
    changeable: detail.state === "Decided",
    isOnMyList: isMyListState(detail.state),
    application: buildApplicationView(detail.application),
    direction: buildDirectionView(detail)
  };
}

/**
 * The application as a Master reads it: the General fields in `APPLICATION_SECTIONS`' order, and its documents.
 *
 * **What a Master may see is api's decision, not a filter here.** `JudicialApplicationView` carries only those
 * fields (narrowed in api on 2026-10-27), so there is nothing to withhold and nothing withheld.
 *
 * Rows the application's type does not use are dropped by the same `getFieldRules` matrix the caseworker forms
 * apply, which is what keeps "Minor's parents' names" off an adult's application, and the old names and nationality
 * off a relinquishment; an empty value keeps its row as "Not provided", which is the caseworker detail card's rule
 * too.
 *
 * `null` when api sent no application at all. A referral is always about one, so this is a shape the type
 * permits rather than a state anyone expects — and the page says so instead of rendering a column of
 * placeholders, which would read as an application whose applicant has no name.
 */
function buildApplicationView(application: JudicialApplicationView | null | undefined): ApplicationView | null {
  if (application === null || application === undefined) return null;

  const rules = getFieldRules(application.type);
  const sections = APPLICATION_SECTIONS.map((section) => ({
    label: section.label,
    rows: section.fields
      .filter((name) => rules[name]?.visible !== false)
      .map((name) => ({
        key: MASTER_LABELS[name] ?? FIELD_BY_NAME[name].label,
        value: formatValue(FIELD_BY_NAME[name], application[name])
      }))
  }));

  return {
    reference: orPlaceholder(application.displayReference, NOT_RECORDED),
    sections,
    documents: application.documents.map(buildDocumentRow)
  };
}

/**
 * One document, every cell a display string. The id is carried for the download link, which the page builds:
 * a path is a page concern, and `pathSegment` is the page's helper.
 *
 * api lists only documents with a file attached, so every row is downloadable — there is no `hasFile` to test.
 */
function buildDocumentRow(document: JudicialDocument): JudicialDocumentRow {
  return {
    id: document.id,
    name: orPlaceholder(document.name),
    type: orPlaceholder(document.documentType),
    uploadedOn: formatValue(UPLOADED_FIELD, document.uploadedOn),
    size: formatSize(document.sizeBytes)
  };
}

/** A file size in the units a person reads, or the placeholder when api published none. */
function formatSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes === null || sizeBytes === undefined) return NOT_PROVIDED;
  if (sizeBytes < KILOBYTE) return `${sizeBytes} bytes`;
  if (sizeBytes < MEGABYTE) return `${Math.round(sizeBytes / KILOBYTE)} KB`;

  return `${(sizeBytes / MEGABYTE).toFixed(1)} MB`;
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

/**
 * The judge's word for a state on their own list, or the placeholder for one this list cannot mean.
 *
 * `Open`, `Withdrawn` and `Closed` reach here only if api has contradicted its own membership rule, and the
 * placeholder is the honest answer to that: a judicial wording for `Open` would be a label for a row that must not
 * exist, and showing api's raw member would put the wire's vocabulary on a judge's screen. Absent is the same
 * answer for the same reason `buildJudicialReferral` gives it — a claim about the read rather than about the data.
 */
function myReferralStatus(state: JudicialReferralSummary["state"]): string {
  return isMyListState(state) ? MY_REFERRAL_STATE_LABEL[state] : NOT_RECORDED;
}

/**
 * Whether a referral in this state is on the judge's own list — `Claimed` or `Decided`, api's membership rule for
 * `GET /judicial/referrals/mine`.
 *
 * One predicate for the status wording and for `isOnMyList`, so which states the list admits and which states link
 * back to it are the same answer. Two copies of it is how a judge ends up sent to a list their referral is not on,
 * which is the failure `referrals-admin-6` exists to fix.
 */
function isMyListState(state: JudicialReferralSummary["state"]): state is "Claimed" | "Decided" {
  return state === "Claimed" || state === "Decided";
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

/**
 * One row of a judge's own list, every cell already a display string.
 *
 * The pool's row plus a status and minus nothing: both are built from `JudicialReferralSummary`, so neither can
 * carry an applicant name, a case reference or a direction — see `buildMyReferralRows`.
 */
export interface MyReferralRow {
  /** The referral's id — the only key any judicial URL takes, and the whole of the link. */
  id: string;
  /** "Direction needed" or "Direction recorded" — the judge's own words for the two states. */
  status: string;
  /** For the tag's colour. The status is printed too, so the state is never carried by colour alone. */
  statusTagClasses: string;
  reasons: string[];
  urgency: string;
  isUrgent: boolean;
  /** The referral's `createdOn`, formatted — when the office asked, not when this judge claimed it. */
  raisedOn: string;
}

/** The application, formatted. Built from `JudicialApplicationView` alone — see `buildApplicationView`. */
export interface ApplicationView {
  /** For the page's caption, and the direction pages'. */
  reference: string;
  sections: ApplicationSection[];
  documents: JudicialDocumentRow[];
}

/** One group of case fields, under the caseworker detail page's section name. */
export interface ApplicationSection {
  label: string;
  rows: { key: string; value: string }[];
}

/** One document. `id` is for the download link the page builds. */
export interface JudicialDocumentRow {
  id: string;
  name: string;
  type: string;
  uploadedOn: string;
  size: string;
}

/** The direction recorded on a referral. `publishToGazette` is a boolean — see `buildDirectionView`. */
export interface DirectionView {
  decision: string;
  directionsText: string;
  publishToGazette: boolean | null;
  decidedOn: string;
}

/** One referral as the judicial screens render it: the referral and its application. */
export interface JudicialReferralView {
  id: string;
  state: string;
  stateTagClasses: string;
  reasons: string[];
  /** The referral's own free text for the Master — not the application's case notes, which a Master is not shown. */
  notes: string;
  urgency: string;
  isUrgent: boolean;
  urgencyReason: string;
  /** When this judge picked it up, or `null` while it is still in the pool. */
  claimedOn: string | null;
  /** `Open`, so the claim control is offered. api re-checks and 409s regardless. */
  claimable: boolean;
  /** `Claimed`, which api's visibility means claimed *by this judge* — so the direction control is offered. */
  directable: boolean;
  /** `Decided`, which api's visibility means directed *by this judge* — so change and withdraw are offered. */
  changeable: boolean;
  /**
   * `Claimed` or `Decided`, the two states api's personal list admits — so the way back is My referrals rather than
   * the shared pool the referral has left. Never a `returnTo`: see `buildJudicialReferral`.
   */
  isOnMyList: boolean;
  /** `null` only when api sent no application, which is a shape its type permits rather than a real state. */
  application: ApplicationView | null;
  /** The direction already recorded, or `null` for a referral still awaiting one. */
  direction: DirectionView | null;
}

/** A case field `JudicialApplicationView` carries — every property but the documents. */
type ApplicationField = Exclude<keyof JudicialApplicationView, "documents">;
