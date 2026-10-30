/**
 * View models for the judicial screens: a Master's own referrals, and one referral as the judge who may see it
 * reads it.
 *
 * Here rather than in the pages for the reason `../referrals/referrals-view.ts` gives — a template cannot
 * format a timestamp without a bespoke Nunjucks environment, and a view model can be tested directly — plus
 * one this area adds: **what a judge is shown must be decidable in one place.** The list row and the referral
 * view are two renderings of the same referral, and the field a judge must not see is the field that gets
 * added to one of them and not noticed on the other.
 *
 * **Nothing here enriches, filters or re-orders.** api sends the judge's own application projection
 * (`JudicialApplicationView`: the names, type, nationality, a minor's parents and the attached documents — narrowed
 * in api on 2026-10-27 from the 2026-10-19 whole-application view) and a list already in api's
 * `MINE_ORDER`. So this file formats exactly what arrived: no second call, no local sort,
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
import { formatShortDate, formatTimestamp, NOT_RECORDED } from "../deed-poll/case-header.js";
import { getFieldRules } from "../deed-poll/deed-poll-validation.js";
import { formatValue, NOT_PROVIDED } from "../deed-poll/detail-view.js";
import { MASTER_DECISION_LABEL } from "../deed-poll/enums/dynamics-values.js";
import type { MasterDecision } from "../deed-poll/enums/option-sets.js";
import { FIELD_BY_NAME, type FieldDef } from "../deed-poll/form-fields.js";
import { REFERRAL_STATE_TAG, REFERRAL_URGENCY_LABEL, referralReasonLabels } from "../referrals/referrals-view.js";

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
 * A Master's own referrals as the three sections of My referrals (Steve, 2026-10-28): the urgent ones still waiting
 * for a direction, then the rest of the undirected ones by the day they were sent, then the directed ones the
 * office has not yet actioned, by day too.
 *
 * **Read off api's order, never re-sorted** (api's `MINE_ORDER`, by `assignedAt` since api F1). api already lists
 * undirected before directed, urgent first among the undirected, then oldest sent first, so each section takes its
 * rows in the order they arrived and a day's group is a run of consecutive rows with the same day. Sorting here would make the page disagree with its
 * own pagination; if api's order ever broke a run, the day would simply appear twice.
 *
 * **Undirected means `Claimed`, the same key api orders on**, so a section boundary here is a boundary in api's list.
 * Urgency splits only the undirected: a directed urgent referral is done, and sits with the other directed ones.
 *
 * **A page boundary inside a day repeats that day's heading on the next page**, without anything to arrange: each page
 * is grouped from its own rows, so the next page's first run gets its heading too.
 *
 * The day is the day sent, `assignedAt` in `Europe/London` (plan Fa1 step 4: a referral can wait in the queue for days,
 * so the day raised says nothing about when the Master received it), and it is `formatShortDate`'s, so the heading and
 * the key cannot disagree. The summary carries no case reference (decision 3), so a row is its reasons, its dates
 * and its link.
 */
export function buildMyReferralSections(referrals: JudicialReferralSummary[]): MyReferralSections {
  const rows = referrals.map((referral) => ({ referral, row: buildMyReferralRow(referral) }));
  const undirected = rows.filter(({ referral }) => isUndirected(referral));

  return {
    urgent: undirected.filter(({ referral }) => referral.urgency === "Urgent").map(({ row }) => row),
    awaiting: groupByDay(undirected.filter(({ referral }) => referral.urgency !== "Urgent").map(({ row }) => row)),
    directed: groupByDay(rows.filter(({ referral }) => !isUndirected(referral)).map(({ row }) => row)),
    isEmpty: referrals.length === 0
  };
}

/**
 * One referral and its application — one payload, one screen. No timeline since 2026-10-27: the Masters asked not to
 * see the case notes, and api no longer sends them.
 *
 * **`directable` and `changeable` govern which control is offered and nothing else.** api re-checks each and
 * answers 409, so these are the cases a judge can see are pointless before the click; every other outcome is api's
 * word. There is no claim since api D2: a referral reaches a Master by assignment. `directable` is `Claimed` without
 * asking *whose*, because api's visibility admits an assigned referral only to its Master, so a comparison here
 * would re-derive a fact the 404 has already established. `changeable` is `Decided` for the same reason: api shows a
 * decided referral only to the judge who directed it, and hides it from everyone once the office closes it.
 *
 * **An unknown state offers neither control.**
 *
 * `direction` is present when api has recorded one, which is how a judge re-reads their own decided referral.
 *
 * **`directionDueBy` only while a direction is owed**, as on My referrals: once directed, the date measures nothing.
 * `assignedOn` is api's `assignedAt`, falling back to `claimedAt` for a referral claimed before assignment existed.
 */
export function buildJudicialReferral(detail: JudicialReferralDetail): JudicialReferralView {
  return {
    id: detail.id,
    // Already display words ("Open", "Claimed"), so no label map — the same reasoning as the caseworker's
    // referral view. Absent means api published none, which is a claim about the read rather than the data.
    state: detail.state ?? NOT_RECORDED,
    stateTagClasses: detail.state ? REFERRAL_STATE_TAG[detail.state] : "govuk-tag--grey",
    reasons: referralReasonLabels(detail.reasons),
    notes: orPlaceholder(detail.notes),
    urgency: detail.urgency ? REFERRAL_URGENCY_LABEL[detail.urgency] : NOT_PROVIDED,
    isUrgent: detail.urgency === "Urgent",
    urgencyReason: orPlaceholder(detail.urgencyReason),
    assignedOn: optionalTimestamp(detail.assignedAt ?? detail.claimedAt),
    directionDueBy: detail.state === "Claimed" && detail.directionDueBy ? formatShortDate(detail.directionDueBy) : null,
    directable: detail.state === "Claimed",
    changeable: detail.state === "Decided",
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
 * `changesToStandardPublication` stays a boolean rather than becoming "Yes"/"No" here. Every other value on these models is
 * a display string, and this one is the exception because a page's own `en`/`cy` owns those two words — a
 * library that hard-coded "Yes" would be the one English string Welsh could not reach.
 */
function buildDirectionView(detail: JudicialReferralDetail): DirectionView | null {
  if (detail.decision === null || detail.decision === undefined) return null;

  return {
    decision: MASTER_DECISION_LABEL[detail.decision],
    directionsText: orPlaceholder(detail.directionsText),
    changesToStandardPublication: detail.changesToStandardPublication ?? null,
    decidedOn: formatTimestamp(detail.decisionDate)
  };
}

/**
 * One row of My referrals. The due date only while a direction is owed: once directed, the date has nothing left to
 * measure, and printing it would read as a deadline still running.
 */
function buildMyReferralRow(referral: JudicialReferralSummary): MyReferralRow {
  return {
    id: referral.id,
    reasons: referralReasonLabels(referral.reasons),
    // api orders by `coalesce(assignedAt, claimedAt, createdOn)`; the summary carries no `claimedAt`, so a referral
    // claimed before assignment existed falls back to the day it was raised.
    sentOn: formatShortDate(referral.assignedAt ?? referral.createdOn),
    directionDueBy: isUndirected(referral) ? formatShortDate(referral.directionDueBy) : null
  };
}

/** Whether the referral still waits for this Master's direction — `Claimed`, api's own first ordering key. */
function isUndirected(referral: JudicialReferralSummary): boolean {
  return referral.state === "Claimed";
}

/** Consecutive rows sent on the same day, as one group each, in the order they came. */
function groupByDay(rows: MyReferralRow[]): MyReferralDay[] {
  const starts = rows.flatMap((row, index) => (index === 0 || rows[index - 1].sentOn !== row.sentOn ? [index] : []));

  return starts.map((start, index) => ({ day: rows[start].sentOn, rows: rows.slice(start, starts[index + 1]) }));
}

/** A timestamp api may not have sent, formatted, or `null`. */
function optionalTimestamp(raw: Date | string | null | undefined): string | null {
  return raw === null || raw === undefined ? null : formatTimestamp(raw);
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

/** My referrals' three sections, each in api's order. An empty one is not drawn. */
export interface MyReferralSections {
  /** Urgent and still waiting for a direction. */
  urgent: MyReferralRow[];
  /** The other undirected referrals, one group per day sent. */
  awaiting: MyReferralDay[];
  /** Directed, waiting for the office to action the direction, one group per day sent. */
  directed: MyReferralDay[];
  /** api sent no rows on this page. */
  isEmpty: boolean;
}

/** The referrals of one day, under that day's heading. */
export interface MyReferralDay {
  /** `dd-mm-yy`, the day sent in `Europe/London`. */
  day: string;
  rows: MyReferralRow[];
}

/**
 * One row of My referrals, every cell already a display string. Built from `JudicialReferralSummary`, so it cannot
 * carry an applicant name, a case reference or a direction.
 */
export interface MyReferralRow {
  /** The referral's id — the only key any judicial URL takes, and the whole of the link. */
  id: string;
  reasons: string[];
  /** `dd-mm-yy`, when the referral was sent to this Master. */
  sentOn: string;
  /** `dd-mm-yy` while a direction is owed, `null` once one is recorded. */
  directionDueBy: string | null;
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

/** The direction recorded on a referral. `changesToStandardPublication` is a boolean — see `buildDirectionView`. */
export interface DirectionView {
  decision: string;
  directionsText: string;
  changesToStandardPublication: boolean | null;
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
  /** When it was assigned to this Master (or, before assignment, claimed), or `null` if api sent neither. */
  assignedOn: string | null;
  /** `dd-mm-yy`, while a direction is owed and api sent a date; otherwise `null`. */
  directionDueBy: string | null;
  /** `Claimed`, which api's visibility means assigned *to this Master* — so the direction control is offered. */
  directable: boolean;
  /** `Decided`, which api's visibility means directed *by this judge* — so change and withdraw are offered. */
  changeable: boolean;
  /** `null` only when api sent no application, which is a shape its type permits rather than a real state. */
  application: ApplicationView | null;
  /** The direction already recorded, or `null` for a referral still awaiting one. */
  direction: DirectionView | null;
}

/** A case field `JudicialApplicationView` carries — every property but the documents. */
type ApplicationField = Exclude<keyof JudicialApplicationView, "documents">;
