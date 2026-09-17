/**
 * The case list, ported from the prototype's `@Get()` page handler, and now the query builder with it.
 *
 * Everything substantive is in the domain: `filterFor` resolves the saved-query filter, `buildCaseList`
 * formats the rows, and `query-builder.ts` reads a submitted builder and decorates its rows. What is left
 * here is the page's own content, the URLs, and which of the two things a request is — a builder
 * submission to normalise, or a query to run.
 *
 * **A builder submission is redirected to its canonical URL.** A GET form cannot submit one
 * `where=field:operator:value` parameter built from three controls, so the form's controls are row-scoped
 * and the round trip ends at the URL `case-query.ts` defines — the one a caseworker bookmarks, shares and
 * goes back to. Everything the builder needs travels through that URL and nothing is held in the session.
 *
 * The prototype's template formatted cells with two custom Nunjucks filters. Those came from
 * `nunjucks.setup.ts`, which `configureGovuk` replaces and which does not register them, so the
 * formatting moved into the view model — see `list-view.ts`.
 */
import {
  buildCaseList,
  builderAction,
  builderDateErrors,
  buildPaging,
  buildQueryRows,
  buildSortHeaders,
  type CaseCondition,
  type CaseListPaging,
  type CaseListRow,
  type CaseListSort,
  caseListSearch,
  conditionsFromBuilder,
  type FieldError,
  fieldControlName,
  filterFor,
  filterTabs,
  findDeedPolls,
  InvalidInputError,
  type ListFilter,
  parseConditions,
  parsePage,
  parseSort,
  type QueryRowError,
  queryErrors,
  serialiseSort,
  unusedConditionRows
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../auth/current-user.js";

const LIST_PATH = "/deed-polls";

const en = {
  title: "Deed poll cases",
  heading: "Deed poll cases",
  filterLabel: "Filter by status",
  empty: "No cases match this filter.",
  newCase: "New case",
  privateTag: "Private",
  builderHeading: "Filter these cases",
  // Decision 4 in words. api ANDs the conditions and offers no OR, so the page says which it is rather
  // than offering a chooser with one option in it.
  builderHint: "Every condition you add must be met.",
  andWord: "and",
  conditionWord: "Condition",
  fieldLabel: "Case field for condition",
  operatorLabel: "Comparison for condition",
  valueLabel: "Value for condition",
  lowerBoundLabel: "Lower value for condition",
  upperBoundLabel: "Upper value for condition",
  addCondition: "Add condition",
  removeCondition: "Remove condition",
  applyFilters: "Apply filters",
  clearFilters: "Clear filters",
  errorSummaryTitle: "There is a problem",
  errorPrefix: "Error:",
  // Shown for a refusal addressed to the query as a whole rather than to a condition — the 20-condition
  // cap, the sort, the paging. api's own wording for those is developer-facing, so it is logged instead.
  queryRefused: "These filters could not be applied. Check them and try again.",
  // Decision 3: a condition the query ran without is stated where the results are, because the row's own
  // hint is below the fold once there are four conditions and filtering by less than was asked is the
  // worse failure. Plain words rather than an error — an unfinished row is a step, not a mistake.
  unusedConditionsFor: (numbers: number[]) =>
    numbers.length === 1
      ? `Condition ${numbers[0]} was not used, because it is not complete.`
      : `Conditions ${listOfNumbers(numbers)} were not used, because they are not complete.`,
  pagingLabel: "Pages of results",
  // Decision 9: the total in words, because a caseworker needs to know whether to refine the query and
  // not only that there is a next page. The numbers are api's counts across every page.
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} applications`,
  sortHint: "Sort by",
  queryLabels: {
    chooseField: "Choose a case field",
    chooseOperator: "Choose a comparison",
    chooseValue: "Choose a value",
    yes: "Yes",
    no: "No",
    enterValue: "Enter a value to use this condition",
    enterBothValues: "Enter both values to use this condition"
  }
};

// Welsh deliberately carries the English text for now. The migration plan's decision is to build
// the en/cy shape and translate later, and the workspace's translation catalogue covers court
// listing terminology rather than deed-poll caseworker forms. Keeping the keys in place means
// translating is a content change rather than a page rewrite.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  // Resolved locally as well as at api's end: the key is what api is sent, and the resolved filter is
  // what the tab bar highlights. Both fall back to "all", so a bookmarked `?filter=nonsense` shows
  // everything under a highlighted "All applications" rather than an unhighlighted tab bar.
  const filter = filterFor(req.query.filter);
  const query = req.query as Record<string, unknown>;
  const sort = parseSort(query.sort);

  const action = builderAction(query);
  if (action === null) {
    return await runQuery(req, res, { filter, conditions: parseConditions(query.where), sort, page: parsePage(query.page) });
  }

  const conditions = conditionsFromBuilder(query, action);
  const dateErrors = builderDateErrors(query, conditions);
  if (dateErrors.length === 0) {
    // The order is carried and the page number is not: a new query narrows a different set of rows, so
    // page 4 of the previous one is not a page of this one.
    return res.redirect(`${LIST_PATH}${caseListSearch({ filter: filter.key, conditions, sort: serialiseSort(sort) })}`);
  }

  // Not redirected: a set of date parts that names no real date composes to no value, so the canonical
  // URL could not carry what was typed and the caseworker would be looking at an empty box beside the
  // error explaining it. The submission is replayed over the rows instead, as a rejected save is.
  res.status(400);

  return await runQuery(req, res, { filter, conditions, sort }, dateErrors, query);
};

/**
 * Run the query and render, or render api's refusal of it against the rows it belongs to.
 *
 * A refused query is caught here rather than left to `domainErrorHandler`, which would answer 500 for
 * what is a caseworker's own filter to correct — the same reason the new-case form catches its own.
 */
async function runQuery(req: Request, res: Response, view: ListView, rowErrors: QueryRowError[] = [], submitted?: Record<string, unknown>) {
  const { filter, conditions, sort, page } = view;

  try {
    const results = await findDeedPolls({ filter: filter.key, conditions, sort: serialiseSort(sort), page }, callerFromRequest(req));

    // api's own counts, straight through: `total` and `totalPages` are across every page and cannot be
    // inferred from the rows this one holds — decision 9.
    const paging = buildPaging(results, (wanted) => listHref({ filter: filter.key, conditions, sort, page: wanted }));

    return render(res, view, buildCaseList(results.cases), paging, rowErrors, [], submitted);
  } catch (error) {
    if (!(error instanceof InvalidInputError)) throw error;

    const refusals = queryErrors(error.errors, conditions);
    if (refusals.unaddressed.length > 0) console.error(`case query refused: ${error.message}`);
    res.status(400);

    // No paging: a refused query has no page of results to be one of.
    return render(res, view, [], null, [...rowErrors, ...refusals.rows], refusals.unaddressed, submitted);
  }
}

function render(
  res: Response,
  view: ListView,
  cases: CaseListRow[],
  paging: CaseListPaging | null,
  rowErrors: QueryRowError[],
  unaddressed: FieldError[],
  submitted?: Record<string, unknown>
) {
  // Resolved here as well as by the render interceptor, because the row builder needs the words before
  // the template does — the pattern `.claude/rules/frontend.md` gives for a schema's messages.
  const content = res.locals.locale === "cy" ? cy : en;
  const { filter, conditions, sort } = view;
  // The rows `findDeedPolls` left off the wire, as a caseworker numbers them. Not a status change: the
  // query ran, and being told what it ran on is the point — decision 3.
  const unused = unusedConditionRows(conditions, rowErrors);

  res.render("deed-polls/index", {
    cases,
    // Each tab carries the query and the order, so switching tab narrows the same conditions within
    // another saved query rather than throwing them away — decision 6. The page number is left behind
    // for the reason a new query leaves it behind: another tab's page 4 holds other rows.
    filters: filterTabs().map((tab) => ({ ...tab, href: listHref({ filter: tab.key, conditions, sort }) })),
    activeFilter: filter.key,
    clearHref: listHref({ filter: filter.key, conditions: [], sort }),
    queryRows: buildQueryRows(conditions, content.queryLabels, { rowErrors, submitted }),
    hasQuery: conditions.length > 0,
    unusedConditions: unused.length === 0 ? "" : content.unusedConditionsFor(unused.map((row) => row + 1)),
    // Every header link carries the tab and the conditions, which is the bug this class of UI always has.
    sortHeaders: buildSortHeaders(sort, (next) => listHref({ filter: filter.key, conditions, sort: next })),
    // The builder submits as a GET, so the order it was applied to travels as a control of its own.
    sortValue: serialiseSort(sort) ?? "",
    paging,
    pagingSummary: paging === null || paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total),
    errorSummary: errorSummary(content, rowErrors, unaddressed),
    en,
    cy
  });
}

/** The condition numbers as a sentence reads them: `2`, `2 and 3`, `2, 3 and 5`. */
function listOfNumbers(numbers: number[]): string {
  return numbers.length < 2 ? numbers.join("") : `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * A link to the list, and the only way one is built here: `caseListSearch` owns which parts a URL carries
 * and which it omits, so a tab, a sort header and a page number cannot each remember a different subset.
 */
function listHref({ filter, conditions, sort, page }: { filter: string; conditions: CaseCondition[]; sort?: CaseListSort; page?: number }): string {
  return `${LIST_PATH}${caseListSearch({ filter, conditions, sort: serialiseSort(sort), page })}`;
}

/**
 * The error summary, one entry per refused condition.
 *
 * Prefixed with the condition's number because a summary entry is read on its own, away from the row it
 * came from, and api's messages are written as continuations of the parameter they refuse.
 */
function errorSummary(content: typeof en, rowErrors: QueryRowError[], unaddressed: FieldError[]): { text: string; href?: string }[] {
  const conditions = rowErrors.map(({ row, message }) => ({
    text: `${content.conditionWord} ${row + 1}: ${message}`,
    href: `#${fieldControlName(row)}`
  }));

  return unaddressed.length === 0 ? conditions : [...conditions, { text: content.queryRefused }];
}

/**
 * What the request asks the list for: the tab, the query, the order and the page.
 *
 * Held together rather than passed part by part because every link on the page is built from all four, and
 * a header link that took three of them is exactly how a sort quietly drops a caseworker's conditions.
 */
interface ListView {
  filter: ListFilter;
  conditions: CaseCondition[];
  sort?: CaseListSort;
  page?: number;
}
