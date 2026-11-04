/**
 * View model for the case-list table.
 *
 * Built here rather than formatted in the template, which is how the prototype did it via two
 * custom Nunjucks filters (`govdate` and `label`) registered in `nunjucks.setup.ts`. Those filters
 * were the only reason that file existed beyond view-engine setup, and `configureGovuk` — which
 * the app already uses — does not register them. Reproducing them would mean either patching a
 * template-provided starter or carrying a bespoke Nunjucks environment; formatting in the view model
 * needs neither, and unlike a filter it can be tested directly.
 *
 * It reuses `formatValue` and `FIELD_BY_NAME`, so a column shows exactly what the same field shows
 * on the detail page. A second formatter here would be a second opinion about what a Type is called.
 */
import type { CaseSummary } from "@hmcts/deed-poll-api-client";
import { NOT_RECORDED } from "./case-header.js";
import { formatValue, NOT_PROVIDED } from "./detail-view.js";
import { FIELD_BY_NAME } from "./form-fields.js";

/**
 * The heading of the column the awaiting-confirmation tab adds, and the only tab that shows it —
 * `notify-3b` decision 4. A choice about which table needs a workflow column rather than about where the
 * value exists: api publishes `daysAwaitingConfirmation` on every row and leaves it null for a case waiting
 * for nothing, so the other tabs could show it and would be showing a column of blanks.
 *
 * **Deliberately not in `CASE_LIST_COLUMNS`, so it is not sortable.** api gives that tab its own default
 * order — `awaitingConfirmationSince:asc`, longest wait first — which is the order the worklist exists to
 * present, and a header link would replace it. It would also point the wrong way: ascending by the date the
 * applicant was asked is *descending* by the number of days in the cell, so `aria-sort="ascending"` above a
 * column counting down from 14 would be a lie a screen-reader user has no way to check.
 *
 * Keeping it out of the catalogue was only half of that argument: the other seven columns *are* in it, and a
 * link on any of them replaced api's order just as effectively. `isReorderable` (`list-sort.ts`) is the other
 * half — on this tab the page sends no order and offers no header link at all.
 */
export const WAITING_COLUMN_LABEL = "Waiting";

/** A row of the list table, with every cell already a string the template prints as-is. */
export interface CaseListRow {
  id: string;
  reference: string;
  /** Rendered as a red tag when private, so the state is not carried by colour alone. */
  privacy: string;
  isPrivate: boolean;
  dateReceived: string;
  type: string;
  state: string;
  newForename: string;
  /**
   * Beside the forename because a search matches on it — plan 12's decision 6. A `q` of "Smith" that
   * matched `newSurname` and showed only forenames would be a table of results with the reason for each
   * of them off screen.
   */
  newSurname: string;
  /**
   * How long the applicant has been waiting to answer, as api counted it — shown only on the
   * awaiting-confirmation tab, but built on every row because the value is on every row. See `waitingFor`.
   */
  waiting: string;
}

/**
 * The table's columns, beside the row builder so the two cannot fall out of step: the heading a
 * caseworker reads and the field api orders that column by.
 *
 * The two travel together because a sortable header is the pair — decision 8 limits sorting to the
 * columns the table shows, and a column whose heading and sort field were declared separately could
 * offer an order for a cell that is not on screen. Each `sort` is one of api's sortable fields, which
 * arrive in `openapi.json` as prose in the `sort` parameter's description rather than as an enum, so
 * `contract.test.ts` cannot pin them: read that description on the next spec refresh.
 */
export const CASE_LIST_COLUMNS: CaseListColumn[] = [
  { label: "Reference", sort: "displayReference" },
  { label: "Privacy", sort: "privacy" },
  { label: "Received", sort: "dateReceived" },
  { label: "Type", sort: "type" },
  { label: "Status", sort: "state" },
  { label: "New forename", sort: "newForename" },
  // Sortable, and confirmed so rather than assumed: `newSurname` is named in the `sort` parameter's
  // sortable-field prose, so the header this pair produces cannot earn a 400.
  { label: "New surname", sort: "newSurname" }
];

/**
 * `CaseSummary` is exactly these columns — api's list response carries no more, because a table that
 * shows seven cells has no business asking for 70 — so the row builder takes it whole rather than
 * picking from it.
 */
export function buildCaseList(cases: CaseSummary[]): CaseListRow[] {
  return cases.map((record) => ({
    id: record.id,
    // Not run through formatValue: the reference is already a display string, so formatting it
    // would only risk changing it. It is nullable in the schema even though `createDeedPoll` always
    // allocates one — a seeded or imported row need not have — so the placeholder is possible here,
    // and a reference-less case showing as such is the honest rendering. The row still links.
    reference: record.displayReference ?? NOT_PROVIDED,
    privacy: formatValue(FIELD_BY_NAME.privacy, record.privacy),
    isPrivate: record.privacy === "Private",
    dateReceived: formatValue(FIELD_BY_NAME.dateReceived, record.dateReceived),
    type: formatValue(FIELD_BY_NAME.type, record.type),
    state: formatValue(FIELD_BY_NAME.state, record.state),
    newForename: formatValue(FIELD_BY_NAME.newForename, record.newForename),
    newSurname: formatValue(FIELD_BY_NAME.newSurname, record.newSurname),
    waiting: waitingFor(record.daysAwaitingConfirmation)
  }));
}

/**
 * api's day count as a caseworker scans it.
 *
 * **Rendered, never computed.** `daysAwaitingConfirmation` is an integer api derived from its own clock, and
 * a second subtraction here would disagree with it across a midnight or a timezone. It is not run through
 * `format` either: it is not one of the 70 case fields, so `FIELD_BY_NAME` has no metadata for it and the
 * fallback would print a bare integer.
 *
 * Three cases, because api publishes three: `0` on the day the email was sent — its own words, and never
 * `1` — which reads as "Today" rather than "0 days", since a caseworker reading a zero has to work out
 * whether it means "no wait" or "not counted". Null means api returned a row it counted no wait for, which on
 * this tab is a disagreement between its filter and its own projection: "Not recorded" says that without
 * claiming the applicant is not waiting. A negative count is not a thing api produces and is answered the
 * same way as a zero rather than printed.
 */
function waitingFor(days: number | null | undefined): string {
  if (days === null || days === undefined) return NOT_RECORDED;
  if (days <= 0) return "Today";

  return days === 1 ? "1 day" : `${days} days`;
}

/** One column of the list table: its heading, and the api field a header link orders by. */
export interface CaseListColumn {
  label: string;
  sort: string;
}
