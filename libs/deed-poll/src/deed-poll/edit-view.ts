/**
 * View model for one editable tab of a case, and the error summary that goes with it.
 *
 * The template gets fields already decorated with their value, their rule, their enum options and
 * their date parts, so it needs no per-field logic — which is the only way a 25-field form stays
 * legible in Nunjucks. Ported from the prototype's private `editViewModel`; it lives in the domain
 * because every decision it makes (is this field required, may this caller edit privacy, which
 * options does this enum have) is a business rule, and none of it is HTTP.
 */
import { isTicked, tickedValues, yesNoAnswer } from "./checkbox-input.js";
import type { DateParts } from "./date-parts.js";
import { splitDateParts, submittedDateParts } from "./date-parts.js";
import { getFieldRules } from "./deed-poll-validation.js";
import type { DeedPollType } from "./enums/option-sets.js";
import { enumOptions, type FieldDef, FORM_TABS, type TabDef } from "./form-fields.js";
import { readFieldInput } from "./form-input.js";
import { privacyEditable } from "./form-presentation.js";
import type { FormError } from "./form-validation.js";
import { formatNumericInput } from "./numeric-input.js";

/** A field, plus everything the template needs in order to render it without deciding anything. */
export interface EditField extends FieldDef {
  value: unknown;
  dateParts: DateParts | null;
  rule: { visible: boolean; required: boolean };
  /** For a multiselect each option carries its own `checked`; see `isTicked`. */
  options: { value: string; text: string; checked?: boolean }[];
  /** For a checkbox boolean, whether its box is ticked; false for every other kind. See `isTicked`. */
  checked: boolean;
  /** For a `nullable` boolean, which radio is selected — `null` for neither; null for every other kind. */
  answer: boolean | null;
  /** Editable in principle but not by this caller — currently only `privacy`. */
  locked: boolean;
}

export interface EditSection {
  label: string;
  fields: EditField[];
}

export interface EditView {
  case: Record<string, unknown>;
  tab: { id: string; label: string; subgrid: string | null };
  sections: EditSection[];
  tabs: { id: string; label: string }[];
}

/** Who is editing, as far as field-level editability is concerned. */
export interface EditContext {
  isAdmin: boolean;
}

/** Resolve a tab id from a URL segment, falling back to the first tab. */
export function tabFor(id: unknown): TabDef {
  return FORM_TABS.find((tab) => tab.id === id) ?? FORM_TABS[0];
}

/** The non-read-only field names on a tab — what an error summary may legitimately link to. */
export function editableFieldNames(tab: TabDef): Set<string> {
  return new Set(tab.sections.flatMap((section) => section.fields.filter((field) => !field.readOnly).map((field) => field.name)));
}

/**
 * Build the error summary for a rejected save.
 *
 * An entry links only when its field is actually on the submitted tab. The cross-field date rules
 * can produce an error addressed to a field on a different tab — the Enroled+Returned rule is
 * addressed to `state`, which lives on the Application tab, so saving the Return tab yields a real
 * error about a field that is not on screen. A `#state` link there would be a dead anchor, which is
 * worse than no link at all: the message reads perfectly well on its own.
 */
export function buildErrorSummary(errors: FormError[], tab: TabDef): { text: string; href?: string }[] {
  const onTab = editableFieldNames(tab);

  return errors.map((error) => ({
    text: error.message,
    href: onTab.has(error.field) ? `#${error.field}` : undefined
  }));
}

/**
 * Decorate a tab's fields with everything needed to render them.
 *
 * `submitted`, when present, is a rejected POST body replayed over the stored record, so a
 * re-rendered form shows what the caseworker typed rather than what is saved. Read-only and locked
 * fields are excluded from that replay — one is never editable and the other renders disabled, so
 * neither is ever in the body and the stored value is the truth. So is any other field the body does
 * not carry, by the absence test `buildUpdatePatch` uses: it was not rendered, and redrawing it empty
 * would have the corrected resubmit clear it if its rule has changed since.
 *
 * Checked state is computed here rather than in the template (review finding R01): a stored record
 * holds `true` and numbers, a replayed body `"true"`/`"on"` and strings, and a template comparing raw
 * values redrew every ticked box unticked on a replay, so the corrected resubmit cleared them. A
 * field whose submitted value the form could not have sent is redrawn from the record too; see `couldBeRendered`.
 */
export function buildEditView(record: Record<string, unknown>, tab: TabDef, ctx: EditContext, submitted?: Record<string, unknown>): EditView {
  const type = (record.type ?? null) as DeedPollType | null;
  const rules = getFieldRules(type, record.migratedRecord === true, record.publishToLondonGazette !== false);
  const canEditPrivacy = privacyEditable(type, { isAdmin: ctx.isAdmin, isNew: false });

  const sections = tab.sections.map((section) => ({
    label: section.label,
    fields: section.fields.map((field) => decorate(field, record, rules, canEditPrivacy, submitted))
  }));

  return {
    case: record,
    tab: { id: tab.id, label: tab.label, subgrid: tab.subgrid ?? null },
    sections,
    tabs: FORM_TABS.map((t) => ({ id: t.id, label: t.label }))
  };
}

function decorate(
  field: FieldDef,
  record: Record<string, unknown>,
  rules: ReturnType<typeof getFieldRules>,
  canEditPrivacy: boolean,
  submitted?: Record<string, unknown>
): EditField {
  // Privacy editability is governed by the caller's role, separately from the per-type rules.
  const locked = field.name === "privacy" ? !canEditPrivacy : false;
  const replaying = submitted !== undefined && !field.readOnly && !locked && wasSubmitted(field, submitted) && couldBeRendered(field, submitted);
  const raw = replaying ? (submitted[field.name] ?? null) : (record[field.name] ?? null);
  // Submitted text is replayed as typed; only a stored number needs rendering as something the parser accepts.
  const value = !replaying && field.kind === "number" && typeof raw === "number" && Number.isFinite(raw) ? formatNumericInput(raw) : raw;
  let dateParts: DateParts | null = null;
  if (field.kind === "date") {
    dateParts = replaying ? submittedDateParts(field.name, submitted) : splitDateParts(record[field.name] ?? null);
  }

  return {
    ...field,
    value,
    dateParts,
    rule: rules[field.name] ?? { visible: true, required: false },
    options: optionsFor(field, raw),
    checked: field.kind === "boolean" && !field.nullable && isTicked(raw),
    answer: field.kind === "boolean" && field.nullable ? yesNoAnswer(raw) : null,
    locked
  };
}

/**
 * An unticked checkbox is absent too, so a checkbox field always counts as submitted. Yes / No radios with
 * neither selected are absent as well, but only an unanswered question renders that way, so its stored `null`
 * is what to redraw.
 */
function wasSubmitted(field: FieldDef, submitted: Record<string, unknown>): boolean {
  if ((field.kind === "boolean" && !field.nullable) || field.kind === "multiselect") return true;
  if (field.kind === "date") return ["day", "month", "year"].some((part) => submitted[`${field.name}-${part}`] !== undefined);
  return submitted[field.name] !== undefined;
}

/**
 * A value the rendered form could not have sent (review finding R08) has no control to redraw it in — an array is
 * not one text box — so its field redraws from the stored record, and a corrected resubmit leaves it as it was. A
 * number is the exception: `12x` is one string the caseworker typed and must see again beside its error. So is a
 * textarea over its limit (review finding R15), which the caseworker shortens rather than retypes.
 */
function couldBeRendered(field: FieldDef, submitted: Record<string, unknown>): boolean {
  if (field.kind === "number" || field.kind === "textarea") return typeof submitted[field.name] === "string";
  return readFieldInput(field, submitted).kind !== "invalid";
}

function optionsFor(field: FieldDef, raw: unknown): EditField["options"] {
  if (!field.enumSet) return [];
  const options = enumOptions(field.enumSet);
  if (field.kind !== "multiselect") return options;
  const ticked = tickedValues(raw);
  return options.map((option) => ({ ...option, checked: ticked.includes(Number(option.value)) }));
}
