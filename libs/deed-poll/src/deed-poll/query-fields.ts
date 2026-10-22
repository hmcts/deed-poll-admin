/**
 * The queryable case fields and the operators each one accepts — the metadata the case-list query
 * builder is a projection of.
 *
 * In the domain rather than on the page for the reason `list-filters.ts` records: which comparisons a
 * field admits is a statement about the field, not about how a form renders it.
 *
 * Two rules hold this file together, and both are here to stop a drift that would be silent:
 *
 *   - **The queryable list is derived from `CASE_FIELD_TABS`, never enumerated.** A field added to the form
 *     becomes queryable with no second edit, so the builder cannot fall behind the case tabs. It is
 *     every field including the six `readOnly` ones: `referencenumber` and `state` are among the most
 *     useful things to query, and read-only means "api computes it", not "api cannot filter on it". The
 *     one addition to the form is `NON_FORM_QUERYABLE_FIELDS` — case properties api answers conditions on
 *     that have no control to add to a tab; it is a named list, not an exception to the derivation.
 *
 *     **The catalogue and not `FORM_TABS`**, which since `referrals-admin-4` is the narrower list: the
 *     retired "Referral to Master" fields are off the case form and still queryable, because caseworkers
 *     have saved queries naming `masterName` and `masterDecision` and api answers conditions on them
 *     exactly as before. Retiring a tab for new work is not a reason to break a worklist.
 *   - **Operators come from `kind`, in one place.** A per-field mapping of 70 entries would drift from
 *     api's table on the first field anyone added. api re-validates every condition against its own
 *     `FormFields` and api wins any disagreement — this list exists to keep obviously-wrong requests
 *     off the wire and to offer a caseworker only comparisons that can succeed.
 */
import { CASE_FIELD_TABS, type FieldDef, type FieldKind, NON_FORM_QUERYABLE_FIELDS } from "./form-fields.js";

/**
 * Mirrors api's operator table exactly (`deed-poll-api`'s query surface). Kinds share lists where api
 * shares them: `textarea` compares as `text` does, and `boolean` admits only equality because there is
 * nothing else to ask of two values.
 */
const OPERATORS_BY_KIND: Record<FieldKind, QueryOperator[]> = {
  text: ["is", "contains", "startsWith", "isEmpty", "isNotEmpty"],
  textarea: ["is", "contains", "startsWith", "isEmpty", "isNotEmpty"],
  date: ["is", "before", "after", "between", "isEmpty", "isNotEmpty"],
  number: ["is", "gt", "lt", "between", "isEmpty", "isNotEmpty"],
  enum: ["is", "isOneOf", "isEmpty", "isNotEmpty"],
  multiselect: ["contains", "isEmpty", "isNotEmpty"],
  boolean: ["is"]
};

/**
 * How many values an operator takes, which is what decides whether the row renders a value control at
 * all. `isEmpty`/`isNotEmpty` take none — a disabled box beside them would imply a value is wanted.
 */
const ARITY_BY_OPERATOR: Record<QueryOperator, ValueArity> = {
  is: 1,
  contains: 1,
  startsWith: 1,
  before: 1,
  after: 1,
  gt: 1,
  lt: 1,
  between: 2,
  isOneOf: "many",
  isEmpty: 0,
  isNotEmpty: 0
};

/**
 * The words a caseworker reads in the operator chooser. Beside the operator list rather than in the
 * template because the two are one piece of metadata: an operator added above without a label here is a
 * type error, whereas a label in Nunjucks would just be missing.
 */
export const OPERATOR_LABELS: Record<QueryOperator, string> = {
  is: "is",
  contains: "contains",
  startsWith: "starts with",
  before: "is before",
  after: "is after",
  between: "is between",
  gt: "is greater than",
  lt: "is less than",
  isOneOf: "is one of",
  isEmpty: "is empty",
  isNotEmpty: "is not empty"
};

/**
 * Every field a condition may name, in form order, so the chooser lists them in the order a caseworker
 * meets them on the case tabs. Derived — see the file docblock. Subgrid tabs contribute nothing because
 * they carry no data-entry sections; notes, witnesses and documents are child entities, and a condition
 * on one is a different question from a condition on the case.
 *
 * The form, **then** the case properties api answers conditions on that no form tab holds a control for —
 * `NON_FORM_QUERYABLE_FIELDS`. Appended rather than mixed in, so "the form in form order" is still the
 * whole of the first part of this list and the drift guard is untouched.
 */
export const QUERYABLE_FIELDS: FieldDef[] = [
  ...CASE_FIELD_TABS.flatMap((tab) => tab.sections.flatMap((section) => section.fields)),
  ...NON_FORM_QUERYABLE_FIELDS
];

/**
 * The two fields api computes at read time and refuses a condition on: *"is derived, not stored"*. They
 * have no column to compare, so no operator can be asked of them.
 *
 * Named here rather than removed from `QUERYABLE_FIELDS`, which stays the whole form plus
 * `NON_FORM_QUERYABLE_FIELDS`: that list is the drift guard — a field added to a case tab becomes queryable
 * with no second edit — and narrowing it would turn "every form field" into "every form field except the
 * ones someone remembered".
 */
const DERIVED_FIELD_NAMES = new Set(["daysReceivedToEnroled", "daysReceivedToReturned"]);

/**
 * The fields the builder's chooser offers, grouped as the case tabs present them — one group per section
 * of one tab, in form order, so the chooser reads as the form a caseworker already knows.
 *
 * Grouped rather than flat because 43 options in one list is barely better than the 68 it replaced: the
 * groups become `<optgroup>`s, which cost no JavaScript and are announced. A section whose every field was
 * curated out contributes no group rather than an empty one.
 *
 * The label is the tab's, qualified by the section's only where the two differ: five tabs hold a single
 * section named after them, and *"Signature: Signature"* says nothing twice.
 *
 * Two exclusions, kept separate because their reasons are different and only one of them is ours:
 *
 *   - the derived pair, which **api refuses a condition on** — an option a caseworker can only be
 *     refused for choosing is not a guide;
 *   - the fields marked `queryable: false` in `form-fields.ts`, which api answers perfectly well and are
 *     merely **not worth offering** — per-case identifiers, narrative prose, address components. 68
 *     options in one list is a list nobody reads; the reason for each cut is a comment on the field.
 *
 * One group is no longer a tab a caseworker can visit: "Referral to Master" is retired from the case form and
 * kept in the catalogue (`CASE_FIELD_TABS`), so the queries built on it stay buildable as well as resolvable.
 * Dropping the group would leave such a query renderable, submittable through `appliedOption` — and impossible
 * to write again.
 *
 * Still derived from the form either way. api answers a condition on anything excluded here — a hand-edited
 * URL can name one, and so does the dashboard's "returned — action needed" link — and `queryableField`
 * resolves it, so the row renders with whatever api says about it. `appliedOption` is what then keeps such a
 * row **submittable**: a chooser missing an option for its own field would drop the condition on the next
 * Apply and answer the whole list.
 */
export const CHOOSABLE_FIELD_GROUPS: ChoosableFieldGroup[] = CASE_FIELD_TABS.flatMap((tab) =>
  tab.sections
    .map((section) => ({
      label: section.label === tab.label ? tab.label : `${tab.label}: ${section.label}`,
      fields: section.fields.filter(isChoosable)
    }))
    .filter((group) => group.fields.length > 0)
);

/**
 * The same fields flat, for everything that asks "may a condition name this?" rather than rendering the
 * chooser. Derived from the groups rather than beside them, so the two cannot disagree about a field.
 */
export const CHOOSABLE_FIELDS: FieldDef[] = CHOOSABLE_FIELD_GROUPS.flatMap((group) => group.fields);

/** The operators offered for a field's kind. */
export function operatorsFor(kind: FieldKind): QueryOperator[] {
  return OPERATORS_BY_KIND[kind];
}

/** How many values the operator takes: none, one, two, or a set. */
export function valueArity(operator: QueryOperator): ValueArity {
  return ARITY_BY_OPERATOR[operator];
}

/**
 * Whether the token names an operator at all, before any field is known.
 *
 * `Object.hasOwn` rather than `in` for the reason `queryableField` is a `find`: the token arrives off a
 * URL, and `"toString" in ARITY_BY_OPERATOR` is true.
 */
export function isQueryOperator(token: unknown): token is QueryOperator {
  return typeof token === "string" && Object.hasOwn(ARITY_BY_OPERATOR, token);
}

/** Whether the operator can be asked of the field's kind — the guard a condition is checked against. */
export function isOperatorValidFor(kind: FieldKind, operator: string): operator is QueryOperator {
  return (OPERATORS_BY_KIND[kind] as string[]).includes(operator);
}

/**
 * The field a condition names, or `undefined` when the name is not queryable.
 *
 * Deliberately not `FIELD_BY_NAME`: that record answers "is this a form field", and a lookup keyed on
 * unvalidated URL input wants a function that says no rather than one that can return a prototype
 * member.
 */
export function queryableField(name: unknown): FieldDef | undefined {
  return typeof name === "string" ? QUERYABLE_FIELDS.find((field) => field.name === name) : undefined;
}

/** Whether the chooser offers the field: neither curated out on the form nor derived by api. */
function isChoosable(field: FieldDef): boolean {
  return field.queryable !== false && !DERIVED_FIELD_NAMES.has(field.name);
}

/** One `<optgroup>` of the field chooser: a tab's section, labelled from the two. */
export interface ChoosableFieldGroup {
  label: string;
  fields: FieldDef[];
}

/** Every operator api accepts, across all kinds. */
export type QueryOperator = "is" | "contains" | "startsWith" | "before" | "after" | "between" | "gt" | "lt" | "isOneOf" | "isEmpty" | "isNotEmpty";

/** `"many"` is `isOneOf`, whose value list a caseworker adds to with checkboxes. */
export type ValueArity = 0 | 1 | 2 | "many";
