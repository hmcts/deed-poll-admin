/**
 * The order the case list is in: read off a URL, written back into one, and turned into the header links
 * a caseworker clicks.
 *
 * In the domain rather than on the page for the reason `list-filters.ts` records, and because the order is
 * `CASE_LIST_COLUMNS`' business: **only the columns the table shows are sortable** — the plan's
 * decision 8. api will order by any of its 68 stored fields, and a `?sort=applicantEmail` off a
 * hand-edited URL would reorder the rows by a cell that is not on screen, which reads as a bug rather
 * than as an answer. An order this app cannot show is dropped, leaving api's own default of newest first,
 * the same way `filterFor` falls back rather than refusing an unrecognised tab.
 *
 * The wire format is api's, `field` or `field:asc|desc` with the direction defaulting to ascending. It is
 * restated here rather than negotiated, and `list-sort.test.ts` round-trips it.
 */
import { AWAITING_CONFIRMATION_FILTER } from "./list-filters.js";
import { CASE_LIST_COLUMNS } from "./list-view.js";

/** Separates the field from the direction. api splits on it too, and a field name never contains one. */
const PART_SEPARATOR = ":";

/** api's default when the direction is omitted, so `dateReceived` and `dateReceived:asc` are one order. */
const DEFAULT_DIRECTION: SortDirection = "asc";

/**
 * Whether this app may order the tab at all, or api's own order is what the tab is for.
 *
 * **False for the awaiting-confirmation worklist** (`notify-3b` decision 4). api gives that tab the default
 * `awaitingConfirmationSince:asc` — longest wait first — and the default is *only* a default, so any `sort` this
 * app sends replaces the order the worklist exists to present. Sending none from the count and from the banner's
 * link was not enough: a tab link carries the order the previous tab was in, so arriving from a list sorted by
 * state asked for `sort=state:desc` and buried the longest wait in the middle of the queue, with nothing on the
 * page saying the queue was no longer a queue.
 *
 * So the rule is the whole tab rather than the one column: `WAITING_COLUMN_LABEL` records why the Waiting cell
 * itself can carry no header link, and this is the other half of that argument — with the request's order dropped
 * here, a link on any *other* column would point at a URL whose `sort` this function then discards, which is a
 * header that visibly does nothing. Sorting is removed with the order, not left pointing at it.
 */
export function isReorderable(filterKey: string): boolean {
  return filterKey !== AWAITING_CONFIRMATION_FILTER;
}

/**
 * The order a URL asks for, or `undefined` for api's own default.
 *
 * `undefined` covers three cases on purpose — no `sort` at all, a field the table does not show, and a
 * direction that is not one of api's two. All three are answered by the order api gives an unsorted
 * request, because the alternative is a 400 for a URL a caseworker may have edited or bookmarked against
 * an older version of the table.
 */
export function parseSort(raw: unknown): CaseListSort | undefined {
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (typeof entry !== "string") return undefined;

  const separator = entry.indexOf(PART_SEPARATOR);
  const field = (separator < 0 ? entry : entry.slice(0, separator)).trim();
  const direction = separator < 0 ? DEFAULT_DIRECTION : entry.slice(separator + 1).trim();
  if (!isSortableColumn(field) || !isSortDirection(direction)) return undefined;

  return { field, direction };
}

/**
 * The `sort` parameter for an order, or `undefined` when there is none to send.
 *
 * The direction is always written out, even though api defaults it: the header links are built from this,
 * and a link that omitted `asc` would send a caseworker to a URL that no longer says which way the column
 * they just clicked is pointing.
 */
export function serialiseSort(sort: CaseListSort | undefined): string | undefined {
  return sort === undefined ? undefined : `${sort.field}${PART_SEPARATOR}${sort.direction}`;
}

/**
 * The table's headers, each carrying the link that reorders by it and the `aria-sort` that says how it is
 * ordered now.
 *
 * The column in force links to the **opposite** direction and every other column links to ascending, so
 * clicking the current column reverses it and clicking another starts it afresh. `href` is a callback
 * because a link to the list carries the tab and the query as well as the order, and `caseListSearch` is
 * the only place that knows how — task 5 going through it is what stops a header link from being the one
 * place the conditions are quietly dropped.
 *
 * **`null` for a tab this app does not order** — see `isReorderable`. The headings are still built, because the
 * table still needs them; what they lose is the link and the `aria-sort`, and losing both together is the point.
 * An `aria-sort="none"` left on a column nothing can reorder announces a sortable table to a screen-reader user
 * and then offers them nothing to sort it with.
 */
export function buildSortHeaders(sort: CaseListSort | undefined, href: ((sort: CaseListSort) => string) | null): CaseListSortHeader[] {
  return CASE_LIST_COLUMNS.map((column) => {
    if (href === null) return { label: column.label, field: column.sort };

    const current = sort?.field === column.sort ? sort.direction : undefined;

    return {
      label: column.label,
      field: column.sort,
      href: href({ field: column.sort, direction: current === "asc" ? "desc" : "asc" }),
      ariaSort: current === undefined ? "none" : current === "asc" ? "ascending" : "descending"
    };
  });
}

/** Whether the field is one of the columns the table shows, and so one this app can order by. */
function isSortableColumn(field: string): boolean {
  return CASE_LIST_COLUMNS.some((column) => column.sort === field);
}

function isSortDirection(direction: string): direction is SortDirection {
  return direction === "asc" || direction === "desc";
}

/** api's two directions. Nothing else is offered, and nothing else is accepted off a URL. */
export type SortDirection = "asc" | "desc";

/** An order the table can both apply and show. */
export interface CaseListSort {
  field: string;
  direction: SortDirection;
}

/** One rendered column heading: the word, the link that reorders by it, and how it is ordered now. */
export interface CaseListSortHeader {
  label: string;
  field: string;
  /** Absent on a tab this app does not order, where the heading is plain text — see `isReorderable`. */
  href?: string;
  /**
   * `aria-sort`, which is how a screen reader learns the order — the link text alone does not say it. Absent
   * with the `href`, because a column that cannot be reordered has no order of its own to announce.
   */
  ariaSort?: "ascending" | "descending" | "none";
}
