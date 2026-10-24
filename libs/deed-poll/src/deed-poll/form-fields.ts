import type { CardColumn } from "./card-layout.js";
import { LABELS } from "./enums/dynamics-values.js";
import type { NumberFormat } from "./numeric-input.js";

/**
 * Form-field metadata — the single source of truth for the editable case form.
 * Mirrors the Dynamics main form (customizations.xml, `<forms type="main">`):
 * tabs → sections → fields in document order. Both the Nunjucks form and the
 * POST coercion in the pages controller drive off this, so the rendered form
 * and the accepted payload can never drift apart.
 *
 * Faithfulness rules baked in (see the source form + ported workflows):
 *   - Nothing is form-required here; required-ness comes from getFieldRules(type).
 *   - `readOnly` fields (referencenumber, computed day-counts) render disabled.
 *   - `state` is derived and has no field — it recomputes on save.
 *   - Notes/Witnesses/Documents are subgrids, handled separately (nested CRUD).
 */

/**
 * The most characters a `textarea` field saves, and the `maxlength` the edit form's character count advertises.
 * api stores the three as unbounded `text`, so this app is what holds the 2,000 the field definitions describe
 * (review finding R15). A browser's `maxlength` counts UTF-16 code units with each line break as one, and so does
 * `readFieldInput`, though the form submits a line break as CRLF.
 */
export const TEXTAREA_MAX_LENGTH = 2000;

/** The control kind, deciding how a field renders and how its POST value coerces. */
export type FieldKind = "text" | "textarea" | "date" | "number" | "boolean" | "enum" | "multiselect";

export interface FieldDef {
  /** The case field name api publishes (also the form input name). */
  name: string;
  label: string;
  kind: FieldKind;
  /** For kind 'enum'/'multiselect': the LABELS set key (e.g. 'type'). */
  enumSet?: keyof typeof LABELS;
  /**
   * For kind 'number': `integer` where `UpdateCaseRequest` publishes the field as `integer`/`int32`, otherwise
   * `decimal`, which is what absent means. `form-fields.test.ts` pins each editable number field to the contract.
   */
  numberFormat?: NumberFormat;
  /**
   * For kind 'boolean': `UpdateCaseRequest` publishes the field as `["boolean", "null"]`, so "not answered" is a
   * value of its own. Such a field renders as Yes / No radios rather than one checkbox, because an unticked box
   * and an unanswered question both arrive absent, and reading absent as `false` turned every stored `null`
   * into "No" on any save of its tab (review finding R07). `form-fields.test.ts` pins this to the contract.
   */
  nullable?: boolean;
  /** Read-only on the form (disabled input); never written on save. */
  readOnly?: boolean;
  /** Omit from staff details and edit forms while retaining the field catalogue. */
  hidden?: boolean;
  /**
   * The column is NOT NULL with a database default, so an absent input must be
   * omitted from a patch rather than nulled. Set this on any field the api client
   * types as non-nullable — `privacy` did not have it, and because privacy renders
   * `disabled` for a non-admin (and browsers do not submit disabled controls) a
   * non-admin saving the Application tab wrote null to a NOT NULL column and 500'd.
   */
  notNullable?: boolean;
  /**
   * Whether the query builder offers this field in its chooser. **Absent means queryable** — a field
   * added to a case tab becomes filterable with no second edit, which is the drift guard `query-fields.ts`
   * is built around. Opt-out rather than opt-in for that reason: `queryable: true` as the default would
   * make a new field silently absent from the builder.
   *
   * Set `false` only where a caseworker would never build a worklist from the field — a per-case
   * identifier, free prose whose queryable fact is the enum beside it, an address component, or a
   * declaration every case carries. The reason is a comment on each one; a field with no reason has none.
   * This is not api's business: api answers a condition on any of these, and a hand-edited URL naming one
   * still renders (see `queryableField`).
   */
  queryable?: boolean;
  /**
   * Which column of the two-column card this field sits in (1 = left, 2 = right,
   * 'full' = spanning both), replicating the Dynamics form's field positions so staff
   * keep their muscle memory. Sections that leave it unset are split in order by
   * `splitIntoColumns` (see card-layout.ts).
   *
   * Every data-entry section is now positioned explicitly, read out of the `<cell>`
   * grid of the matching `<section>` in `power_app/.../customizations.xml` — a
   * `colspan="2"` cell is `'full'`, otherwise the cell index is the column. Read the
   * XML rather than eyeballing a screenshot: the halving fallback had put Return
   * Reason beside Date returned, and the four later tabs were laid out by it because
   * we had no screenshot of them. If you add a section, position it from the XML.
   */
  column?: CardColumn;
}

export interface SectionDef {
  label: string;
  fields: FieldDef[];
}

export interface TabDef {
  /** URL slug + form section id. */
  id: string;
  label: string;
  /** Data-entry sections. Empty when the tab is a subgrid (see `subgrid`). */
  sections: SectionDef[];
  /**
   * Present when the tab is a child-entity subgrid rather than fields.
   *
   * `referrals` and `emails` are the ones whose rows are **not** on the case payload — `GET /caseworker/cases/{id}`
   * carries notes, witnesses and documents, and a case's referral history and its correspondence are each a
   * call of their own. So the page hands `buildDetailTabs` a record with both fetched lists merged in; see
   * `../referrals/service.ts` and `../emails/service.ts` for why the extra call is the right answer there and
   * not for the first three.
   */
  subgrid?: "notes" | "witnesses" | "documents" | "referrals" | "emails";
}

/** Build govuk select items ({value,text}) for an enum LABELS set. */
export function enumOptions(set: keyof typeof LABELS) {
  return Object.entries(LABELS[set]).map(([value, text]) => ({ value, text }));
}

/** The Application tab: General, Names, Addresses, Nationality, Declarations. */
const APPLICATION_TAB: TabDef = {
  id: "application",
  label: "Application",
  sections: [
    {
      // Column positions replicate power_app/screenshots/application_general.png,
      // read down the left column then the right. Two departures, both deliberate:
      //   - `displayReference` and `urgencyreason` have no place on the source card.
      //     They are ours (the reference the user actually quotes, and the reason a
      //     case was flagged urgent), so they follow their related field.
      //   - The source card also shows "Refer to Master?", which we own on the
      //     Referral tab because it drives that tab's visibility. Duplicating one
      //     field across two editable forms would give it two save paths.
      label: "General",
      fields: [
        { name: "referencenumber", label: "Reference number", kind: "number", readOnly: true, column: 1 },
        { name: "displayReference", label: "Display reference", kind: "text", readOnly: true, column: 1 },
        { name: "dateOfApplication", label: "Date of application", kind: "date", column: 1 },
        { name: "inPerson", label: "In person", kind: "boolean", nullable: true, column: 1 },
        // an internal counter, not a caseworker concept
        { name: "postCounter", label: "Post / Counter", kind: "enum", enumSet: "postCounter", queryable: false, column: 1 },
        // unique per case — a lookup, never a filter
        { name: "feeReference", label: "Fee reference", kind: "text", queryable: false, column: 1 },
        { name: "dateReceived", label: "Date received", kind: "date", column: 1 },
        { name: "type", label: "Type", kind: "enum", enumSet: "type", column: 1 },
        { name: "maritalStatus", label: "Marital status", kind: "enum", enumSet: "maritalStatus", column: 1 },

        // The minor fields close the left column, exactly as in
        // power_app/screenshots/application_general_minor.png. They are NOT a
        // separate card: all four are hidden by getFieldRules for a non-minor type,
        // so on an Adult case the left column simply ends at Marital status.
        { name: "minorDateOfBirth", label: "Minor's date of birth", kind: "date", column: 1 },
        { name: "ageOfMinor", label: "Age of minor years", kind: "number", numberFormat: "integer", column: 1 },
        // duplicates ageOfMinor at finer grain
        { name: "ageOfMinorMonths", label: "Age of minor months", kind: "number", numberFormat: "integer", queryable: false, column: 1 },
        { name: "parents", label: "Parents", kind: "text", column: 1 },

        { name: "privacy", label: "Privacy", kind: "enum", enumSet: "privacy", notNullable: true, column: 2 },
        { name: "state", label: "Status", kind: "enum", enumSet: "state", readOnly: true, column: 2 },
        { name: "urgency", label: "Urgency", kind: "enum", enumSet: "urgency", notNullable: true, column: 2 },
        // free prose; the queryable fact is the `urgency` enum beside it
        { name: "urgencyreason", label: "Urgency reason", kind: "text", queryable: false, column: 2 },
        // Retained for existing data, queries and emails; staff no longer need to see or enter it.
        { name: "onlineApplicationReference", label: "Online application reference", kind: "text", queryable: false, hidden: true, column: 2 },
        // a records-management flag, not a caseworker's worklist
        { name: "retainPermanently", label: "Retain permanently", kind: "boolean", queryable: false, column: 2 },
        { name: "awaitingFurtherDocsInfo", label: "Awaiting further docs/info", kind: "date", column: 2 }
      ]
    },
    {
      // Column positions replicate power_app/screenshots/application_names.png:
      // the new name down the left, the old name down the right. The source form's
      // cells are row-major (newforename, oldforename, newmiddlename, oldmiddlename,
      // …), which is the same layout read the other way round.
      //
      // The halve-in-order fallback already produced this split, since the fields
      // happen to be listed new-then-old. Positions are set anyway so the layout
      // survives someone reordering the list — an accidental match is not a spec.
      label: "Names",
      fields: [
        { name: "newForename", label: "New forename", kind: "text", column: 1 },
        { name: "newMiddleName", label: "New middle name", kind: "text", column: 1 },
        { name: "newSurname", label: "New surname", kind: "text", column: 1 },

        { name: "oldForename", label: "Old forename", kind: "text", column: 2 },
        { name: "oldMiddleName", label: "Old middle name", kind: "text", column: 2 },
        { name: "oldSurname", label: "Old surname", kind: "text", column: 2 }
      ]
    },
    {
      // Column positions replicate power_app/screenshots/application_address.png:
      // the postal address down the left, the two contact fields at the top right.
      // Note this is NOT the halve-in-order split, which put Postcode on the right.
      //
      // Labels drop the source form's "Applicant" prefix ("Applicant Address 1" →
      // "Address line 1") because the card title already says whose address it is,
      // and the full label wraps in a half-width column — the wrapping is visible
      // on the source screenshot's own "Applicant Building No/Name".
      label: "Applicant address and contact details",
      fields: [
        // address components; town and postcode below carry the signal a caseworker filters on
        { name: "applicantBuildingNoName", label: "Building number/name", kind: "text", queryable: false, column: 1 },
        { name: "applicantAddress1", label: "Address line 1", kind: "text", queryable: false, column: 1 },
        { name: "applicantAddress2", label: "Address line 2", kind: "text", queryable: false, column: 1 },
        { name: "applicantTownCity", label: "Town/city", kind: "text", column: 1 },
        { name: "applicantPostcode", label: "Postcode", kind: "text", column: 1 },

        { name: "applicantEmail", label: "Email", kind: "text", column: 2 },
        // formatting varies too much for `contains`; email is the reliable contact lookup
        { name: "applicantTelephone", label: "Telephone", kind: "text", queryable: false, column: 2 }
      ]
    },
    {
      // Column positions replicate power_app/screenshots/application_repesentative.png:
      // who they are and how to reach them on the left, their postal address on the
      // right. That is MIRRORED from the applicant card above, where the address is on
      // the left — the source form really is inconsistent between the two (its cell
      // order is name, building, company, address1, email, address2, …), and we copy
      // the inconsistency because muscle memory is the point of this exercise.
      label: "Representative address and contact details",
      fields: [
        { name: "representativeName", label: "Name", kind: "text", column: 1 },
        { name: "representativeCompany", label: "Company", kind: "text", column: 1 },
        { name: "representativeEmail", label: "Email", kind: "text", column: 1 },
        // formatting varies too much for `contains`; email is the reliable contact lookup
        { name: "representativeTelephone", label: "Telephone", kind: "text", queryable: false, column: 1 },

        // address components; the firm's name and email are what a caseworker filters a worklist by
        { name: "representativeBuildingNoName", label: "Building number/name", kind: "text", queryable: false, column: 2 },
        { name: "representativeAddress1", label: "Address line 1", kind: "text", queryable: false, column: 2 },
        { name: "representativeAddress2", label: "Address line 2", kind: "text", queryable: false, column: 2 },
        // only useful when working by solicitor region, which nobody does yet
        { name: "representativeTownCity", label: "Town/city", kind: "text", queryable: false, column: 2 },
        { name: "representativePostcode", label: "Postcode", kind: "text", queryable: false, column: 2 }
      ]
    },
    {
      // `<section name="sectionNationality">` stacks all three in the left cell. The
      // halving fallback used to put Section (other) on the right, away from the
      // Section it qualifies.
      label: "Nationality",
      fields: [
        { name: "nationality", label: "Nationality", kind: "enum", enumSet: "nationality", column: 1 },
        { name: "nationalitySection", label: "Section", kind: "enum", enumSet: "nationalitySection", column: 1 },
        // free prose; the queryable fact is the `nationalitySection` enum above it
        { name: "nationalitySectionOther", label: "Section (other)", kind: "text", queryable: false, column: 1 }
      ]
    },
    {
      // `<section name="sectionDeclarations">` cells are row-major (I shall / I have
      // subscribed, then Date of declaration / And also my old); read column-wise that
      // is I shall + Date of declaration left, the two subscribed/old ones right.
      // Grouped by column below, as the Names section is — the array order also sets
      // the stacking order on the edit form, where column-major reads better.
      label: "Declarations",
      fields: [
        // the three legal declaration checkboxes — every case has them, so a condition on one selects everything
        { name: "iShall", label: "I shall", kind: "multiselect", enumSet: "iShall", queryable: false, column: 1 },
        { name: "dateOfDeclaration", label: "Date of declaration", kind: "date", column: 1 },

        { name: "iHaveSubscribed", label: "I have subscribed", kind: "multiselect", enumSet: "iHaveSubscribed", queryable: false, column: 2 },
        { name: "andAlsoMyOld", label: "And also my old", kind: "multiselect", enumSet: "andAlsoMyOld", queryable: false, column: 2 }
      ]
    }
  ]
};

/**
 * The retired "Referral to Master" tab — the previous system's referral record, kept as read-only history.
 *
 * **Exported because the definitions outlive the tab.** `referrals-admin-4` decision 2 retires these fields for
 * new work: a caseworker raises and reads referrals on the Referrals tab, and the values here may be a migrated
 * business record that must stay readable. `../referrals/legacy-referral-view.ts` renders the populated ones
 * from this metadata rather than restating their labels, so the two cannot drift apart.
 *
 * **In `CASE_FIELD_TABS` and deliberately not in `FORM_TABS`**, so nothing navigates or edits it — see the two
 * docblocks below. The `column` positions are kept as the record of where the source form put each field; no
 * card renders them now, since the snapshot is one summary list of the values a case actually holds.
 */
export const LEGACY_REFERRAL_TAB: TabDef = {
  id: "referral",
  label: "Referral to Master",
  sections: [
    {
      // Positions read out of `<section name="sectionReferral">` in the source form
      // (customizations.xml). Every field sits in the section's LEFT cell with the
      // right one empty, except the two long free-text fields, which carry
      // `colspan="2" rowspan="5"` — hence `column: 'full'`. `referToMasterChoice` has
      // no cell in this section at all (the source keeps it on the General card); it
      // is ours, per the note on APPLICATION_TAB, so it leads the left column.
      label: "Referral to Master",
      fields: [
        { name: "referToMasterChoice", label: "Refer to Master", kind: "enum", enumSet: "referToMaster", column: 1 },
        { name: "dateReadyForMaster", label: "Date ready for Master", kind: "date", column: 1 },
        { name: "dateReferred", label: "Date referred", kind: "date", column: 1 },
        // narrative
        { name: "referralNotes", label: "Referral notes", kind: "textarea", queryable: false, column: "full" },
        { name: "masterName", label: "Master name", kind: "text", column: 1 },
        // narrative
        { name: "masterDirections", label: "Master directions", kind: "textarea", queryable: false, column: "full" },
        { name: "masterDecision", label: "Master decision", kind: "enum", enumSet: "masterDecision", column: 1 },
        { name: "masterDateOfDecision", label: "Master date of decision", kind: "date", column: 1 },
        { name: "dateDecisionDirectionsReceived", label: "Date decision/directions received", kind: "date", column: 1 },
        // a Gazette process flag; `dateNoticeSentToLondonGazette` on the Enrolment tab is the queryable fact
        { name: "publishToLondonGazette", label: "Publish to London Gazette", kind: "boolean", queryable: false, column: 1 }
      ]
    }
  ]
};

/** Signature tab. */
const SIGNATURE_TAB: TabDef = {
  id: "signature",
  label: "Signature",
  sections: [
    {
      // `<section name="signature_tab_section_1">` puts these side by side — the one
      // section on the later tabs that genuinely uses both cells. Positioned
      // explicitly because the halving fallback only happened to agree with it: a
      // third field on this tab would have moved Received under Requested.
      label: "Signature",
      fields: [
        { name: "signatureRequestedDate", label: "Signature requested date", kind: "date", column: 1 },
        { name: "signatureReceivedDate", label: "Signature received date", kind: "date", column: 2 }
      ]
    }
  ]
};

/** Enrolment tab (includes the read-only computed day count + Gazette date). */
const ENROLMENT_TAB: TabDef = {
  id: "enrolment",
  label: "Enrolment",
  sections: [
    {
      // All three occupy the left cell of `<section name="sectionEnrolment">`, right
      // cell empty — a single stack, not two columns.
      label: "Enrolment",
      fields: [
        { name: "dateEnroled", label: "Date enrolled", kind: "date", column: 1 },
        { name: "daysReceivedToEnroled", label: "Days received to enrolled", kind: "number", readOnly: true, column: 1 },
        { name: "dateNoticeSentToLondonGazette", label: "Date notice sent to London Gazette", kind: "date", column: 1 }
      ]
    }
  ]
};

/** Return tab. */
const RETURN_TAB: TabDef = {
  id: "return",
  label: "Return",
  sections: [
    {
      // `<section name="sectionReturn">`: both dates in the left cell, then
      // `deedpoll_returnreason` at `colspan="2" rowspan="5"` across the full width.
      // A 2000-character free-text field does not belong in a half column.
      label: "Return",
      fields: [
        { name: "dateReturned", label: "Date returned", kind: "date", column: 1 },
        { name: "daysReceivedToReturned", label: "Days received to returned", kind: "number", readOnly: true, column: 1 },
        // narrative
        { name: "returnReason", label: "Return reason", kind: "textarea", queryable: false, column: "full" }
      ]
    }
  ]
};

/** Refund tab. */
const REFUND_TAB: TabDef = {
  id: "refund",
  label: "Refund",
  sections: [
    {
      // All three in the left cell of `<section name="sectionRefund">`.
      label: "Refund",
      fields: [
        { name: "refundAmount", label: "Refund amount", kind: "number", column: 1 },
        { name: "dateOfRefund", label: "Date of refund", kind: "date", column: 1 },
        // unique per case — a lookup, never a filter
        { name: "refundReference", label: "Refund reference", kind: "text", queryable: false, column: 1 }
      ]
    }
  ]
};

/**
 * **Every case field the app knows about**, in source order, including the retired referral tab. Subgrid tabs
 * carry no data-entry sections.
 *
 * **This is the catalogue, `FORM_TABS` is the form**, and the two are separate because `referrals-admin-4`
 * decision 2 retires a tab without retiring its fields. The old "Refer to Master" record may hold a migrated
 * business record, so its definitions still have to answer two questions:
 *
 *   - how to format one of its values (`FIELD_BY_NAME`, and `../referrals/legacy-referral-view.ts` through it);
 *   - whether a saved query may name it (`query-fields.ts`), since caseworkers have worklists built on
 *     `masterName` and `masterDecision` today and this plan does not take them away.
 *
 * Deriving everything from one list is the trap the decision names: `EDITABLE_FIELDS` would go on offering the
 * retired fields through the generic case form, and dropping the tab outright would silently remove them from
 * formatting and from the query chooser with nothing failing.
 */
export const CASE_FIELD_TABS: TabDef[] = [
  APPLICATION_TAB,
  { id: "notes", label: "Notes", sections: [], subgrid: "notes" },
  LEGACY_REFERRAL_TAB,
  SIGNATURE_TAB,
  ENROLMENT_TAB,
  RETURN_TAB,
  REFUND_TAB,
  { id: "witnesses", label: "Witnesses", sections: [], subgrid: "witnesses" },
  { id: "documents", label: "Supporting documents", sections: [], subgrid: "documents" },
  // `referrals` is not `referral`: LEGACY_REFERRAL_TAB above holds the case's own "Refer to Master?" fields, ported
  // from the Dynamics form, while this lists the referrals actually raised against the case. Both ids are
  // URL slugs (`/deed-polls/{id}/edit/referral`) so neither can be renamed to tell them apart.
  { id: "referrals", label: "Referrals", sections: [], subgrid: "referrals" },
  // Last, and the position is not cosmetic: this list ports a Dynamics form and the read-only page once fell
  // six tabs behind it, so a new tab goes on the end rather than beside the thing it relates to. Inserting it
  // in the middle would reorder every caseworker's muscle memory for no gain. Decision 1 of
  // `docs/plans/notify-2-caseworker-email-tab.md`.
  { id: "emails", label: "Emails", sections: [], subgrid: "emails" }
];

/**
 * The tabs a caseworker **navigates and edits** — the catalogue above without the retired referral tab or hidden fields.
 *
 * So the case detail page shows one referral tab rather than two (`detail-view.ts` iterates this list), the edit
 * form's tab strip does not offer the retired one, and `tabFor`/the POST guard in
 * `src/pages/deed-polls/[id]/edit/[tab].ts` no longer resolve `referral` to anything. The retired fields are
 * read-only history inside the Referrals panel instead.
 *
 * Filtered rather than listed a second time, so a tab added to the catalogue reaches the form without a second
 * edit — the same derivation argument as `query-fields.ts`, one list further out.
 */
export const FORM_TABS: TabDef[] = CASE_FIELD_TABS.filter((tab) => tab !== LEGACY_REFERRAL_TAB).map((tab) => ({
  ...tab,
  sections: tab.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => !field.hidden) }))
}));

/**
 * Case properties api publishes and answers conditions on that have **no control on any form tab**.
 *
 * `QUERYABLE_FIELDS` is otherwise the whole form, and that derivation is the drift guard `query-fields.ts`
 * is built around — but the guard only reaches fields a caseworker types into. `currentReferralState` is
 * neither typed nor stored: api derives it from the case's live referral (`CaseSummaryResponse`,
 * `SavedCaseResponse`) and registers it as queryable, so a condition naming it is one api resolves. Without
 * a def here `queryableField` would not know it and `caseQueryWhere` would **silently drop** the condition —
 * a dropped condition answers the whole list, which for a count reads as a zero rather than as a failure.
 *
 * Read-only for the same reason `state` is: api computes it. Not on a tab because putting it there would add
 * a disabled control to the case form and a row to the detail card, which is a display decision this plan
 * does not make (`docs/plans/completed/referrals-admin-2-returned-action-needed.md`, decision 8) — the
 * referrals tab is where a case's referral state is read.
 */
export const NON_FORM_QUERYABLE_FIELDS: FieldDef[] = [
  {
    name: "currentReferralState",
    label: "Current referral state",
    kind: "enum",
    // The states are api's, so the value chooser is built from its member array like every other option set.
    // An `enum` with no set renders a chooser holding only "Choose a value", which for the one condition the
    // app itself links to would mean a filter the page could neither show nor resubmit. The set is api's
    // members minus the terminal two, which this field never holds — see `CURRENT_REFERRAL_STATE_LABEL`.
    enumSet: "currentReferralState",
    readOnly: true
    // **No `queryable: false` here, and adding one would say nothing.** That flag is how a field *on the form*
    // is curated out of the chooser: `isChoosable` is only ever applied to `FORM_TABS` sections
    // (`query-fields.ts`), and this list is appended after them, so a non-form field is absent from the
    // chooser by construction — there is no group it could sit in. Setting the flag here would read as the
    // mechanism and be inert, which is worse than saying so.
    //
    // A caseworker reaches this filter by the dashboard's "returned — action needed" link, which carries the
    // condition, and `buildRow` renders a resolved-but-unchoosable field as an option of its own so that
    // link's condition survives the next Apply rather than widening the list.
  }
];

/**
 * Every editable (non-readOnly) field across all data-entry sections.
 *
 * **`FORM_TABS` and not `CASE_FIELD_TABS`**, which is what stops a new write reaching the retired referral
 * fields: this list is what the generic case form accepts, so a field absent from it cannot be patched through
 * `/edit/{tab}` however a body is composed. The values stay readable — see `FIELD_BY_NAME` below.
 */
export const EDITABLE_FIELDS: FieldDef[] = FORM_TABS.flatMap((t) => t.sections.flatMap((s) => s.fields)).filter((f) => !f.readOnly);

/**
 * Fast lookup of a field def by name (editable + read-only).
 *
 * **`CASE_FIELD_TABS`**, so a retired field is still formatted with its own label and kind. This is the half of
 * the split that keeps a migrated referral record readable; it says nothing about whether the field may be
 * written, which `EDITABLE_FIELDS` answers.
 */
export const FIELD_BY_NAME: Record<string, FieldDef> = Object.fromEntries(
  CASE_FIELD_TABS.flatMap((t) => t.sections.flatMap((s) => s.fields)).map((f) => [f.name, f])
);
