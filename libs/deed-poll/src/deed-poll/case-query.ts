/**
 * The case-list query as it travels in a URL: repeated `where=field:operator:value` parameters, read
 * into conditions and written back out again.
 *
 * **The URL is the state.** There is no session-stored draft and no POST: a caseworker can bookmark a
 * query, mail it to a colleague and use the back button, which is the reason api took repeated query
 * parameters in the first place. So this file is the one place the wire format is written down, and it
 * is written down twice over — parse and serialise are inverses, which
 * `case-query.test.ts` pins with a round trip.
 *
 * The format is api's, restated here rather than negotiated (`deed-poll-api`'s `CaseQuery`):
 *
 *   - Split on the **first two** colons only. Everything after the second is the value, so a colon
 *     inside a value needs no escaping beyond the URL encoding it already has.
 *   - An entry with no second colon is how a no-value operator is written: `parents:isEmpty`.
 *   - `between` and `isOneOf` take their values comma-separated and each one trimmed. No other
 *     operator takes a list, so a comma in a text value is content rather than punctuation and is
 *     left alone — which is why `contains:Smith, John` asks what it looks like it asks.
 *
 * **Parsing is tolerant; sending is not.** A row a caseworker is halfway through filling in is a
 * normal state of the builder — clicking "Add condition" produces an empty one — so `parseConditions`
 * keeps whatever it is given and answers with rows the page can re-render. `caseQueryWhere` is the
 * narrower gate: only a condition this app can see is complete goes on the wire, because an empty row
 * would otherwise turn every "add another" into a 400 and lose the results already on screen.
 *
 * What is deliberately **not** checked here is whether a value means anything — that a date parses,
 * that an enum member exists, that `between` bounds are the right way round. api re-validates every
 * condition against its own `FormFields` and **api wins any disagreement**; this app's job is to keep
 * obviously-wrong requests off the wire and to render api's refusals against the right row.
 */
import { z } from "zod";
import { LIST_FILTERS } from "./list-filters.js";
import { isOperatorValidFor, isQueryOperator, queryableField, type ValueArity, valueArity } from "./query-fields.js";

/** Separates a condition's three parts, and nothing else — a field name never contains one. */
const PART_SEPARATOR = ":";

/** Separates the values of the two list-taking operators, `between` and `isOneOf`. */
const LIST_SEPARATOR = ",";

/**
 * The raw `where` parameter, as Express hands it over: one string for a single condition, an array for
 * several, and absent for a list with no query.
 *
 * `catch` rather than an error because the parameter comes off a URL a caseworker may have edited: a
 * `where` that is neither a string nor a list of them (`?where[a]=b`, which `qs` reads as an object) is
 * not something any builder produced, and there is no row to render it as. The count is left uncapped
 * on purpose — api caps conditions at 20 and refuses the whole request beyond that, and truncating to
 * the cap here would silently answer a narrower question instead of showing that refusal. `qs`'s own
 * `parameterLimit` bounds the array long before rendering it matters.
 */
const whereParamSchema = z.union([z.string().transform((entry) => [entry]), z.array(z.string())]).catch([]);

/**
 * One condition, checked as far as this app can check it: a queryable field, an operator its kind
 * admits, and the number of values that operator takes.
 *
 * Exported so a page can `safeParse` a single row and say which part of it is unfinished. The messages
 * address a caseworker because a hand-edited URL can reach them, but a builder that renders per
 * decision 3 cannot: it offers only the operators the kind admits and only the controls the operator
 * takes.
 */
export const caseConditionSchema = z
  .object({
    field: z.string(),
    operator: z.string(),
    values: z.array(z.string())
  })
  .superRefine((condition, ctx) => {
    const field = queryableField(condition.field);
    if (!field) {
      ctx.addIssue({ code: "custom", path: ["field"], message: "Select a case field to filter on" });
      return;
    }
    if (!isOperatorValidFor(field.kind, condition.operator)) {
      ctx.addIssue({ code: "custom", path: ["operator"], message: `Select how to compare ${field.label}` });
      return;
    }
    const arity = valueArity(condition.operator);
    const filled = condition.values.filter((value) => value.trim() !== "").length;
    if (arity === "many" ? filled === 0 : filled !== arity) {
      ctx.addIssue({ code: "custom", path: ["values"], message: valuesMessage(field.label, arity) });
    }
  });

/**
 * Reads the repeated `where` parameters into the builder's rows, in the order the URL sent them.
 *
 * Nothing is rejected and nothing is dropped: an unrecognised field or operator comes back as the text
 * that was sent, so the page can re-render the row it belongs to rather than making a caseworker's
 * mistake disappear.
 */
export function parseConditions(where: unknown): CaseCondition[] {
  return whereParamSchema.parse(where).map(parseCondition);
}

/**
 * The `where` parameters for a set of conditions — the inverse of `parseConditions`, including for the
 * rows it could not make sense of.
 */
export function serialiseConditions(conditions: CaseCondition[]): string[] {
  return conditions.map(serialiseCondition);
}

/**
 * The `where` parameters to send api: the conditions that are complete, and only those.
 *
 * The half-filled rows are left behind here rather than in `parseConditions` because they still have
 * to render. A query narrows as each row is completed, which is what makes "Add condition" a submit a
 * caseworker can afford to press.
 */
export function caseQueryWhere(conditions: CaseCondition[]): string[] {
  return serialiseConditions(conditions.filter(isCompleteCondition));
}

/** Whether the condition is one this app can put on the wire. */
export function isCompleteCondition(condition: CaseCondition): boolean {
  return caseConditionSchema.safeParse(condition).success;
}

/**
 * The query string a case-list URL carries, `?` included, or `""` for the unfiltered list.
 *
 * The only place a link to the list is built, so a tab, a sort header and a page number cannot each
 * remember a different subset of the state. Everything is URL-encoded by `URLSearchParams`, which is what
 * lets a condition's value hold a colon, a comma, an ampersand or a space.
 *
 * A part this app has nothing to say about is **omitted rather than defaulted**, for the reason
 * `listCases` omits it: writing `size=25` or `filter=all` into a URL a caseworker bookmarks would pin
 * api's current default into their bookmark.
 *
 * Blank rows are carried, because "Add condition" is a submit and the row it adds has to survive the
 * round trip. The single exception is a builder holding **one** entirely blank row, which is what an
 * unfiltered list renders anyway — writing `where=:` for it would put a parameter in the URL that says
 * nothing.
 */
export function caseListSearch(link: CaseListLink): string {
  const conditions = link.conditions ?? [];
  const carried = conditions.length === 1 && isBlankCondition(conditions[0]) ? [] : conditions;

  const parameters = new URLSearchParams();
  // The first filter is the one an absent key falls back to, at both ends, so naming it says nothing.
  if (link.filter !== undefined && link.filter !== "" && link.filter !== LIST_FILTERS[0].key) parameters.set("filter", link.filter);
  for (const entry of serialiseConditions(carried)) parameters.append("where", entry);
  if (link.sort !== undefined && link.sort !== "") parameters.set("sort", link.sort);
  if (link.page !== undefined && link.page > 1) parameters.set("page", String(link.page));

  const search = parameters.toString();

  return search === "" ? "" : `?${search}`;
}

/** Whether the row holds nothing at all — the state "Add condition" leaves a new row in. */
export function isBlankCondition({ field, operator, values }: CaseCondition): boolean {
  return field === "" && operator === "" && values.every((value) => value.trim() === "");
}

/**
 * api addresses a condition refusal to a position among the conditions it was **sent** (`where.0`,
 * `where.1`), and the incomplete rows of a half-built query are never sent — so the two numberings
 * differ as soon as one row is unfinished. This is the translation back to a row a caseworker can see.
 */
export function rowForSentCondition(conditions: CaseCondition[], sentIndex: number): number | undefined {
  const rows = conditions.map((_, row) => row).filter((row) => isCompleteCondition(conditions[row]));

  return rows[sentIndex];
}

/** One entry, split on the first two colons and no further. */
function parseCondition(entry: string): CaseCondition {
  const firstColon = entry.indexOf(PART_SEPARATOR);
  if (firstColon < 0) {
    // A field and nothing asked of it — a row mid-edit, not an error to report.
    return { field: entry.trim(), operator: "", values: [] };
  }
  const secondColon = entry.indexOf(PART_SEPARATOR, firstColon + 1);
  const operator = (secondColon < 0 ? entry.slice(firstColon + 1) : entry.slice(firstColon + 1, secondColon)).trim();

  return {
    field: entry.slice(0, firstColon).trim(),
    operator,
    values: secondColon < 0 ? [] : parseValues(operator, entry.slice(secondColon + 1))
  };
}

/**
 * A value part read as the operator's arity implies.
 *
 * An unknown operator takes the value whole. Splitting it would guess at an arity nobody published,
 * and the round trip has to survive a row whose operator is a typo just as much as one whose operator
 * is real.
 */
function parseValues(operator: string, valuePart: string): string[] {
  if (!takesValueList(operator)) {
    return [valuePart];
  }
  return valuePart.split(LIST_SEPARATOR).map((value) => value.trim());
}

/**
 * `field:operator`, plus `:value` when there is one.
 *
 * A single-valued operator writes only its first value. It cannot hold two — `caseConditionSchema`
 * refuses a row that claims otherwise, so such a row never reaches the wire — and the alternative of
 * joining them with a comma would write one value containing a comma, which is a different condition
 * from the one held.
 */
function serialiseCondition({ field, operator, values }: CaseCondition): string {
  const parts = [field, operator];
  if (values.length === 0) {
    return parts.join(PART_SEPARATOR);
  }
  const value = takesValueList(operator) ? values.join(LIST_SEPARATOR) : values[0];
  return [...parts, value].join(PART_SEPARATOR);
}

/** Whether the operator's values are comma-separated: `between`'s two bounds and `isOneOf`'s set. */
function takesValueList(operator: string): boolean {
  if (!isQueryOperator(operator)) {
    return false;
  }
  const arity = valueArity(operator);
  return arity === 2 || arity === "many";
}

/** What to say about a row whose value controls are not filled in as its operator needs. */
function valuesMessage(label: string, arity: ValueArity): string {
  if (arity === 0) {
    return `Remove the value from ${label}, which is compared without one`;
  }
  if (arity === 2) {
    return `Enter both values for ${label}`;
  }
  return `Enter a value for ${label}`;
}

/**
 * One row of the builder: what a caseworker has chosen so far.
 *
 * Strings rather than a resolved `FieldDef` and a `QueryOperator`, because a row arrives from a URL and
 * may be unfinished or wrong — a type that could only hold a valid condition would have nothing to put
 * a half-filled row in, and the page has to render exactly that. `queryableField` and
 * `caseConditionSchema` are how a row becomes a condition.
 *
 * A single-valued operator's value is the whole string, commas and all. `values` holds one entry for a
 * single-valued operator, two for `between`, one or more for `isOneOf`, and none for `isEmpty` and
 * `isNotEmpty`.
 */
export interface CaseCondition {
  field: string;
  operator: string;
  values: string[];
}

/** Everything a link to the case list carries. The path is the page's business, not this file's. */
export interface CaseListLink {
  filter?: string;
  conditions?: CaseCondition[];
  sort?: string;
  page?: number;
}
