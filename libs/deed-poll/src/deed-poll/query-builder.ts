/**
 * The case-list query builder: a submitted set of condition rows read back into conditions, and the rows
 * a template renders without deciding anything.
 *
 * In the domain rather than on the page for the reason `list-filters.ts` records, and `query-fields.ts`
 * after it: which comparisons a field admits, and therefore which control asks for their values, is a
 * statement about the field. The page contributes the words and the URLs.
 *
 * Three things shape this file, and all three are decisions the plan took rather than preferences:
 *
 *   - **It works with JavaScript disabled.** Adding a condition is a submit that comes back with one more
 *     empty row, and removing one is a submit naming the row — the GOV.UK add-another pattern. So the
 *     builder never holds a draft anywhere: every round trip goes out through the URL and comes back in.
 *   - **The URL is the state, and the state is `where=field:operator:value`.** A GET form cannot submit
 *     one parameter built from three controls, so the form's controls are row-scoped (`field-0`, `op-0`,
 *     `value-0-0`) and the page redirects to the canonical URL. Those names are a transport for one round
 *     trip; `case-query.ts` owns the format that is bookmarked, shared and gone back to.
 *   - **api validates; this app guides.** The chooser offers only operators the field's kind admits and
 *     only the controls the operator takes, which is what keeps a caseworker from building a condition
 *     that can only be refused. It is not a second opinion: api re-checks every condition and wins.
 *   - **An unfinished row is a step, not a mistake.** Choosing a comparison is what reveals the control
 *     its value is typed into, and with JavaScript off the only way to reveal it is to submit — so Apply
 *     runs the conditions that are complete, keeps the rest as rows, and says what it left out.
 *     `valueHint` is the *hint* that asks for the missing value, and `unusedConditionRows` is what the
 *     page states above the table. Neither is an error: a caseworker halfway through has made none.
 */

import type { FieldError } from "../errors.js";
import { type CaseCondition, isBlankCondition, isCompleteCondition, rowForSentCondition } from "./case-query.js";
import { type DateParts, splitDateParts, submittedDateParts } from "./date-parts.js";
import { enumOptions, type FieldDef, type FieldKind } from "./form-fields.js";
import { collectDateErrors } from "./form-validation.js";
import {
  CHOOSABLE_FIELD_GROUPS,
  CHOOSABLE_FIELDS,
  isOperatorValidFor,
  OPERATOR_LABELS,
  operatorsFor,
  QUERYABLE_FIELDS,
  type QueryOperator,
  queryableField,
  type ValueArity,
  valueArity
} from "./query-fields.js";

/** The three buttons the builder submits with. Each names itself, which is how the action is read back. */
const ADD_PARAMETER = "add";
const REMOVE_PARAMETER = "remove";
const APPLY_PARAMETER = "apply";

/** Row-scoped control names. Prefixes rather than nesting, because Express 5 parses a query string flatly. */
const FIELD_PREFIX = "field-";
const OPERATOR_PREFIX = "op-";
const VALUE_PREFIX = "value-";

/** api addresses a condition refusal to its position among the conditions it was sent. */
const SENT_CONDITION = /^where\.(\d+)$/;

/** A row holding nothing, which is what "Add condition" adds and what an unfiltered list renders. */
const BLANK_CONDITION: CaseCondition = { field: "", operator: "", values: [] };

/** Every arity there is, so the metadata can state a control for each of them rather than for the ones in use. */
const ARITIES: ValueArity[] = [0, 1, 2, "many"];

/** The name of the row's field chooser, which is also the anchor an error summary entry links to. */
export function fieldControlName(index: number): string {
  return `${FIELD_PREFIX}${index}`;
}

/** The name of the row's operator chooser. */
export function operatorControlName(index: number): string {
  return `${OPERATOR_PREFIX}${index}`;
}

/**
 * The name of one of the row's value controls: slot 0 for a single value or `between`'s lower bound, slot
 * 1 for its upper. A date input uses it as a `namePrefix` and appends `-day`, `-month` and `-year`.
 */
export function valueControlName(index: number, slot: number): string {
  return `${VALUE_PREFIX}${index}-${slot}`;
}

/**
 * What a request asked the builder to do, or `null` when it is not a builder submission at all.
 *
 * Read from the buttons rather than from the presence of row controls, so a canonical URL — which
 * carries `where` and no controls — is never mistaken for a submission of an empty builder and made to
 * wipe the query it holds.
 */
export function builderAction(query: Record<string, unknown>): BuilderAction | null {
  if (Object.hasOwn(query, REMOVE_PARAMETER)) {
    const index = Number(single(query[REMOVE_PARAMETER]));

    // A `remove` naming no row it could remove is treated as an ordinary apply: the caseworker pressed a
    // button, and answering with a 400 would lose a query they can see on screen.
    return Number.isInteger(index) && index >= 0 ? { kind: "remove", index } : { kind: "apply" };
  }
  if (Object.hasOwn(query, ADD_PARAMETER)) return { kind: "add" };
  if (Object.hasOwn(query, APPLY_PARAMETER)) return { kind: "apply" };

  return null;
}

/**
 * The conditions a builder submission holds, with the action applied.
 *
 * Row order is the order of the indices in the control names, not the order the parameters happen to
 * arrive in, so the rows come back in the order they were rendered. The count is bounded by the query
 * parser's own key limit, which is the same bound `case-query.ts` relies on rather than capping here:
 * api caps conditions at 20 and refuses the request beyond that, and quietly dropping the 21st would
 * answer a narrower question than the one asked.
 */
export function conditionsFromBuilder(query: Record<string, unknown>, action: BuilderAction): CaseCondition[] {
  const rows = rowIndices(query).map((index) => ({ index, condition: readRow(query, index) }));

  if (action.kind === "add") return [...rows.map((row) => row.condition), { ...BLANK_CONDITION }];
  if (action.kind === "remove") return rows.filter((row) => row.index !== action.index).map((row) => row.condition);

  return rows.map((row) => row.condition);
}

/**
 * The date rows of a submission whose parts do not name a date that exists.
 *
 * Checked here rather than left to api because the failure is silent both ways otherwise: composing
 * `31 2 2026` rolls it over to 3 March, so a caseworker would be shown results for a date they did not
 * ask about, and refusing to compose it at all would blank the box without saying why. `collectDateErrors`
 * is the same check the case form runs, so "a real date" means one thing in this app.
 */
export function builderDateErrors(query: Record<string, unknown>, conditions: CaseCondition[]): QueryRowError[] {
  return conditions.flatMap((condition, row) => {
    const definition = queryableField(condition.field);
    if (definition?.kind !== "date") return [];

    // Both slots unconditionally: a set of parts that is entirely blank is skipped, so asking about the
    // upper bound of an operator that has none costs nothing.
    const slots = [0, 1].map((slot) => ({ name: valueControlName(row, slot), label: definition.label, kind: "date" as const }));

    return collectDateErrors(query, slots).map((error) => ({ row, message: error.message }));
  });
}

/**
 * api's refusals, split into the ones a row can carry and the ones nothing on the page can.
 *
 * The unaddressed ones are the query's as a whole — the 20-condition cap, the sort, the paging — and a
 * page has no row to put them against. Its own copy stands in for them, which is what `new.ts` does with
 * a create api refuses without naming a field: api's wording is developer-facing.
 */
export function queryErrors(errors: FieldError[], conditions: CaseCondition[]): { rows: QueryRowError[]; unaddressed: FieldError[] } {
  const rows: QueryRowError[] = [];
  const unaddressed: FieldError[] = [];

  for (const error of errors) {
    const sent = SENT_CONDITION.exec(error.field);
    const row = sent === null ? undefined : rowForSentCondition(conditions, Number(sent[1]));
    if (row === undefined) unaddressed.push(error);
    else rows.push({ row, message: error.message });
  }

  return { rows, unaddressed };
}

/**
 * The rows a query ran without, so the page can say so above the table.
 *
 * Decision 3: leaving a condition out quietly answers a wider question than the one asked, and the row's
 * own hint sits below the fold once there are four conditions. So the omission is stated where the results
 * are, in the page's words — this only reports *which* rows.
 *
 * An entirely blank row is not among them: it is what "Add condition" leaves behind and what an unfiltered
 * list renders, and nothing was asked of it. A row api refused is not either — its message already says
 * what happened, and reporting it twice in two registers would read as two separate problems.
 */
export function unusedConditionRows(conditions: CaseCondition[], rowErrors: QueryRowError[] = []): number[] {
  const refused = new Set(rowErrors.map((error) => error.row));

  return conditions.map((_, row) => row).filter((row) => !refused.has(row) && !isBlankCondition(conditions[row]) && !isCompleteCondition(conditions[row]));
}

/**
 * The builder's rows, each carrying its control names, its options and the value controls its operator
 * takes — so the template renders them without deciding anything, exactly as `edit-view.ts` does for the
 * case form.
 *
 * A builder with no conditions still renders one row: an empty row is the invitation to filter, and it
 * holds no state, which is why `caseListSearch` leaves it out of the URL.
 */
export function buildQueryRows(conditions: CaseCondition[], labels: QueryLabels, options: QueryRowOptions = {}): QueryRow[] {
  const rows = conditions.length === 0 ? [BLANK_CONDITION] : conditions;
  const messages = new Map((options.rowErrors ?? []).map((error) => [error.row, error.message]));

  return rows.map((condition, index) => buildRow(condition, index, labels, messages.get(index), options.submitted));
}

/**
 * The whole of what the browser needs to swap a value control in without a submit — emitted **once** per
 * page as JSON, per the plan's decision 4.
 *
 * Everything here is read off the same functions the server renders a row with: `operatorsFor`,
 * `valueArity`, `OPERATOR_LABELS` and `valueControl`. That is the point of the function existing at all. A
 * script that carried its own copy of the operator table would be a second opinion about which comparisons
 * a field admits, and the first field anyone added would make the two disagree silently — the drift
 * `query-fields.ts` was written to prevent, moved to where nothing type-checks it.
 *
 * Three things the script cannot derive for itself and so are stated:
 *
 *   - **the operators each kind admits, in offer order**, because changing the field changes which
 *     comparisons are on offer and the chooser has to be rebuilt to match;
 *   - **the control each kind asks a value with at each arity**, which is `valueControl`'s answer and not a
 *     rule to restate in a browser;
 *   - **the words**, which are page content resolved for the request's locale.
 *
 * Keyed by every *queryable* field rather than only the ones the chooser offers: a hand-edited URL can name
 * a curated-out field, `queryableField` resolves it, and the row it renders has to go on working.
 */
export function queryBuilderMetadata(labels: QueryScriptLabels): QueryBuilderMetadata {
  const kinds = [...new Set(QUERYABLE_FIELDS.map((field) => field.kind))];

  return {
    operators: Object.fromEntries(
      (Object.keys(OPERATOR_LABELS) as QueryOperator[]).map((operator) => [operator, { label: OPERATOR_LABELS[operator], arity: valueArity(operator) }])
    ),
    kinds: Object.fromEntries(
      kinds.map((kind) => [
        kind,
        {
          operators: operatorsFor(kind),
          controls: Object.fromEntries(ARITIES.map((arity) => [String(arity), valueControl(kind, arity)]))
        }
      ])
    ),
    fields: Object.fromEntries(QUERYABLE_FIELDS.map((field) => [field.name, { kind: field.kind, options: field.enumSet ? enumOptions(field.enumSet) : [] }])),
    labels
  };
}

/** The row indices present in a submission, ascending and each once. */
function rowIndices(query: Record<string, unknown>): number[] {
  const indices = Object.keys(query)
    .filter((key) => key.startsWith(FIELD_PREFIX))
    .map((key) => Number(key.slice(FIELD_PREFIX.length)))
    .filter((index) => Number.isInteger(index) && index >= 0);

  return [...new Set(indices)].sort((left, right) => left - right);
}

/**
 * One submitted row.
 *
 * An operator the chosen field's kind cannot admit is **dropped**, along with the values that went with
 * it. The two choosers are submitted together, so changing the field to one of another kind arrives here
 * beside the previous kind's operator — and the row the caseworker is shown next has to offer the new
 * kind's operators, not carry a comparison that can only be refused.
 */
function readRow(query: Record<string, unknown>, index: number): CaseCondition {
  const field = single(query[fieldControlName(index)]);
  const definition = queryableField(field);
  const operator = single(query[operatorControlName(index)]);
  if (definition === undefined || !isOperatorValidFor(definition.kind, operator)) {
    return { field, operator: "", values: [] };
  }

  return { field, operator, values: readValues(query, index, definition, valueArity(operator)) };
}

/** The row's values, as many as the operator takes and read as its kind's control submits them. */
function readValues(query: Record<string, unknown>, index: number, definition: FieldDef, arity: ValueArity): string[] {
  if (arity === 0) return [];
  // `isOneOf` is a checkbox set, so every box shares one name and the browser repeats it.
  if (arity === "many") return many(query[valueControlName(index, 0)]);

  const slots = arity === 2 ? [0, 1] : [0];

  return slots.map((slot) => (definition.kind === "date" ? readDate(query, index, slot) : single(query[valueControlName(index, slot)])));
}

/**
 * A date value as `YYYY-MM-DD`, which is what api parses and what reads as a date in a bookmarked URL.
 *
 * A set of parts that does not compose becomes no value at all, leaving the row incomplete and off the
 * wire — `builderDateErrors` is what says so out loud.
 */
function readDate(query: Record<string, unknown>, index: number, slot: number): string {
  const prefix = valueControlName(index, slot);
  const { day, month, year } = submittedDateParts(prefix, query);
  if (day === "" || month === "" || year === "") return "";
  // Assembled rather than composed through a `Date`: `composeDateParts` rolls `31 2 2026` over to 3 March,
  // and a filter that quietly answers about another date is worse than one that answers about none.
  if (collectDateErrors(query, [{ name: prefix, label: prefix, kind: "date" }]).length > 0) return "";

  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** One rendered row: the two choosers, the value control the operator takes, and any refusal against it. */
function buildRow(condition: CaseCondition, index: number, labels: QueryLabels, error: string | undefined, submitted?: Record<string, unknown>): QueryRow {
  const definition = queryableField(condition.field);

  // An operator the kind does not admit leaves the chooser unset rather than showing a comparison that is
  // not on offer — a hand-edited URL is the only way to arrive here, and the row has to be fixable.
  const operator = definition !== undefined && isOperatorValidFor(definition.kind, condition.operator) ? condition.operator : "";
  const arity = operator === "" ? 0 : valueArity(operator);
  const control = valueControl(definition?.kind, arity);
  let slots: (0 | 1)[] = [];
  if (arity === 2) slots = [0, 1];
  else if (arity === 1) slots = [0];

  return {
    number: index + 1,
    index,
    // A string, because `govukButton` drops a falsy `value` — the first row's `0` would render a Remove
    // button that names no row, and a submit button with no value is not one at all.
    removeValue: String(index),
    field: {
      name: fieldControlName(index),
      // Above the groups rather than in one: a placeholder inside an `<optgroup>` is announced as a member
      // of that section, and "Choose a case field" belongs to no section.
      placeholder: { value: "", text: labels.chooseField, selected: definition === undefined, checked: false },
      applied: appliedOption(definition),
      groups: CHOOSABLE_FIELD_GROUPS.map((group) => ({
        label: group.label,
        options: group.fields.map((candidate) => option(candidate.name, candidate.label, candidate.name === condition.field))
      }))
    },
    operator: {
      name: operatorControlName(index),
      options: [
        { value: "", text: labels.chooseOperator, selected: operator === "", checked: false },
        ...(definition === undefined
          ? []
          : operatorsFor(definition.kind).map((candidate) => option(candidate, OPERATOR_LABELS[candidate], candidate === operator)))
      ]
    },
    control,
    values:
      control === "text" || control === "number" || control === "date"
        ? slots.map((slot) => buildInput(index, slot, condition.values[slot] ?? "", control === "date", submitted))
        : [],
    // Both slots, whether or not this operator uses both: the browser swaps in the control the *next*
    // comparison asks for, and a script that composed the name itself would be a second copy of the format.
    valueNames: [valueControlName(index, 0), valueControlName(index, 1)],
    valueOptions: definition === undefined ? [] : chooserOptions(definition, control, labels, condition.values),
    error,
    // Suppressed beside a refusal: the refusal is the more specific thing to say about the row, and two
    // messages under one condition read as two problems.
    hint: error === undefined ? valueHint(arity, condition.values, labels) : undefined
  };
}

/**
 * Which control asks for the value, per the plan's decision 3.
 *
 * `isEmpty` and `isNotEmpty` get none at all — a disabled box beside them would imply a value is wanted.
 * A multiselect gets checkboxes because its members are what there is to choose from; `contains` takes
 * one of them, so ticking two leaves the row incomplete and `caseConditionSchema` says so.
 *
 * Takes the kind rather than the field, because that is all it looks at and `queryBuilderMetadata` asks it
 * about a kind with no field in hand.
 */
function valueControl(kind: FieldKind | undefined, arity: ValueArity): ValueControl {
  if (kind === undefined || arity === 0) return "none";

  switch (kind) {
    case "date":
      return "date";
    case "number":
      return "number";
    case "boolean":
      return "radios";
    case "enum":
      return arity === "many" ? "checkboxes" : "select";
    case "multiselect":
      return "checkboxes";
    default:
      return "text";
  }
}

/**
 * The condition's own field as an option, for a field the chooser does not offer.
 *
 * **Without it the row cannot submit the filter it is showing.** `queryableField` resolves every field api
 * answers a condition on, which is deliberately wider than the chooser (`CHOOSABLE_FIELD_GROUPS` curates it,
 * and `NON_FORM_QUERYABLE_FIELDS` sits outside the tabs it is grouped by). A select with no option for the
 * field submits the placeholder's empty value, so `readRow` resolves no definition, the condition comes back
 * blank and Apply — or Add condition, or Remove — silently answers the *whole* list. The dashboard's
 * "returned — action needed" link carries exactly such a condition, so that is not a hand-edited-URL edge
 * case: it is the worklist a caseworker is sent to, still claiming a count it no longer filters by.
 *
 * `null` for a field a group already holds, because two selected options in one select is no better than none.
 */
function appliedOption(definition: FieldDef | undefined): QueryOption | null {
  if (definition === undefined || CHOOSABLE_FIELDS.some((candidate) => candidate.name === definition.name)) return null;

  return option(definition.name, definition.label, true);
}

/** One typed-in value: a text box, a number box, or the three parts of a date. */
function buildInput(index: number, slot: 0 | 1, value: string, isDate: boolean, submitted?: Record<string, unknown>): QueryValueInput {
  const name = valueControlName(index, slot);
  let dateParts: DateParts | null = null;
  if (isDate) {
    // The parts exactly as submitted win on a re-render, so a `31 2 2026` stays on screen next to the
    // error explaining it rather than being replaced by the blank it composed to. Same reasoning as
    // `submittedDateParts` was written for.
    dateParts = submitted === undefined ? splitDateParts(value) : submittedDateParts(name, submitted);
  }

  return {
    name,
    slot,
    value,
    dateParts
  };
}

/** The members a select, a checkbox set or a pair of radios offers, with the chosen ones marked. */
function chooserOptions(definition: FieldDef, control: ValueControl, labels: QueryLabels, values: string[]): QueryOption[] {
  const chosen = new Set(values.map((value) => value.trim()));

  if (control === "radios") {
    return [option("true", labels.yes, chosen.has("true")), option("false", labels.no, chosen.has("false"))];
  }
  if (control !== "select" && control !== "checkboxes") return [];

  // Both kinds' members come from the same option-set labels, which for a multiselect are keyed by the
  // Dynamics integer the field stores — so the value a condition carries is the one api compares against.
  const members = definition.enumSet ? enumOptions(definition.enumSet).map((member) => option(member.value, member.text, chosen.has(member.value))) : [];
  if (control === "checkboxes") return members;

  return [option("", labels.chooseValue, !members.some((member) => member.selected)), ...members];
}

/**
 * What to say about a row whose comparison is chosen and whose value is not given yet — a `govuk-hint`,
 * never a `govukErrorMessage` and never an error-summary entry (decision 2). Choosing the comparison is
 * what reveals the control, so being asked for the value is the next step rather than a mistake made.
 *
 * Nothing for the two arity-0 operators, which are complete without a value: asking one for a value would
 * contradict the control `valueControl` deliberately does not render for it. `between` wants both bounds,
 * so one of two still asks.
 */
function valueHint(arity: ValueArity, values: string[], labels: QueryLabels): string | undefined {
  if (arity === 0) return undefined;
  const filled = values.filter((value) => value.trim() !== "").length;
  // `isOneOf` is satisfied by one ticked box, so its arity is a floor rather than a count.
  if (filled >= (arity === "many" ? 1 : arity)) return undefined;

  return arity === 2 ? labels.enterBothValues : labels.enterValue;
}

/** `selected` and `checked` both, because `govukSelect` reads one and `govukCheckboxes`/`govukRadios` the other. */
function option(value: string, text: string, chosen: boolean): QueryOption {
  return { value, text, selected: chosen, checked: chosen };
}

/** A repeated parameter's first value; a control submits one, but a URL may repeat its name. */
function single(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;

  return typeof first === "string" ? first.trim() : "";
}

/** Every value of a repeated parameter, blanks left out — a checkbox set submits nothing when untouched. */
function many(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];

  return values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** What a builder submission asked for. `remove` names the row, since a button submits its own value. */
export type BuilderAction = { kind: "apply" } | { kind: "add" } | { kind: "remove"; index: number };

/** A refusal a row can carry, addressed to the row a caseworker sees rather than to a wire position. */
export interface QueryRowError {
  row: number;
  message: string;
}

/**
 * The words the builder's placeholders and its boolean radios read.
 *
 * Passed in rather than written here: they are page content, and the page resolves them for the request's
 * locale. The field and operator labels are not among them — those are metadata, and a field's label is
 * the one a caseworker already knows from the case tabs.
 */
export interface QueryLabels {
  chooseField: string;
  chooseOperator: string;
  chooseValue: string;
  yes: string;
  no: string;
  /** Asked of a row whose comparison takes a value it has not been given. */
  enterValue: string;
  /** The same for `between`, which is unfinished with one of its two bounds. */
  enterBothValues: string;
}

export interface QueryRowOptions {
  rowErrors?: QueryRowError[];
  /** A rejected submission's own parameters, replayed so a date that did not compose stays on screen. */
  submitted?: Record<string, unknown>;
}

/** Which control the row's value is asked for with. `"none"` is `isEmpty` and `isNotEmpty`. */
export type ValueControl = "none" | "text" | "number" | "date" | "select" | "checkboxes" | "radios";

export interface QueryOption {
  value: string;
  text: string;
  selected: boolean;
  checked: boolean;
}

export interface QuerySelect {
  name: string;
  options: QueryOption[];
}

/** One `<optgroup>` of the field chooser, labelled from the tab and section its fields sit in. */
export interface QueryOptionGroup {
  label: string;
  options: QueryOption[];
}

/**
 * The field chooser, which is grouped where the operator chooser is flat: a case has 43 filterable fields
 * and eleven comparisons, and only the first list needs the case tabs' structure to be readable.
 */
export interface QueryFieldSelect {
  name: string;
  /** The "Choose a case field" entry, which belongs to no group. */
  placeholder: QueryOption;
  /**
   * The field this condition names, when no group offers it — see `appliedOption`. Ungrouped for the same
   * reason the placeholder is: it belongs to no section of the form.
   */
  applied: QueryOption | null;
  groups: QueryOptionGroup[];
}

export interface QueryValueInput {
  name: string;
  /** 0 for a single value or `between`'s lower bound, 1 for its upper. */
  slot: 0 | 1;
  value: string;
  /** Set only for a date, whose one value is three inputs. */
  dateParts: DateParts | null;
}

export interface QueryRow {
  /** 1-based, for the "Condition 2" a caseworker reads. */
  number: number;
  /** 0-based, and what every control name in the row is scoped by. */
  index: number;
  /** The row's index as the Remove button's value. */
  removeValue: string;
  field: QueryFieldSelect;
  operator: QuerySelect;
  control: ValueControl;
  /** The typed-in values, for `text`, `number` and `date`; two of them for `between`. */
  values: QueryValueInput[];
  /**
   * The names of the row's two value slots — slot 0 is also the shared name of a `select`, `checkboxes` or
   * `radios` control. Both are given whatever the operator takes, because the browser builds the control
   * the comparison chosen *next* asks for and must not compose a control name of its own.
   */
  valueNames: [string, string];
  valueOptions: QueryOption[];
  error?: string;
  /** The row's next step, when its value is still wanted. Never set beside an `error`. */
  hint?: string;
}

/**
 * The words the browser's swapped-in controls read. Page content, like `QueryLabels`, and separate from it
 * because these are the strings the *script* needs — a label the server renders is already in the markup.
 *
 * The three announcements are what the `aria-live` region says when a control appears or goes; `{n}` in each
 * is the condition's number, since one region serves every row and "a value is wanted" says nothing about
 * which one.
 */
export interface QueryScriptLabels {
  chooseOperator: string;
  chooseValue: string;
  yes: string;
  no: string;
  /** The visually-hidden label of a single value control, without the condition number. */
  value: string;
  lowerBound: string;
  upperBound: string;
  /** The three parts of a date input, which govuk-frontend's macro defaults to English. */
  day: string;
  month: string;
  year: string;
  enterValue: string;
  enterBothValues: string;
  announceValue: string;
  announceValues: string;
  announceNoValue: string;
}

/** One operator as the browser needs it: the words to offer it in, and how many values it takes. */
export interface QueryOperatorMeta {
  label: string;
  arity: ValueArity;
}

/** One kind: the comparisons it admits in offer order, and the control each arity asks its value with. */
export interface QueryKindMeta {
  operators: QueryOperator[];
  /** Keyed by arity as a string, because this crosses to the browser as JSON. */
  controls: Record<string, ValueControl>;
}

/** One field: its kind, and its option set's members when it has one. */
export interface QueryFieldMeta {
  kind: FieldKind;
  options: { value: string; text: string }[];
}

/** The builder's metadata as the browser receives it — see `queryBuilderMetadata`. */
export interface QueryBuilderMetadata {
  operators: Record<string, QueryOperatorMeta>;
  kinds: Record<string, QueryKindMeta>;
  fields: Record<string, QueryFieldMeta>;
  labels: QueryScriptLabels;
}
