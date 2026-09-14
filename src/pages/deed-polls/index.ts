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
  buildQueryRows,
  CASE_LIST_COLUMNS,
  type CaseCondition,
  type CaseListRow,
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
  type QueryRowError,
  queryErrors
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
  columns: CASE_LIST_COLUMNS,
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
  queryLabels: {
    chooseField: "Choose a case field",
    chooseOperator: "Choose a comparison",
    chooseValue: "Choose a value",
    yes: "Yes",
    no: "No"
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

  const action = builderAction(query);
  if (action === null) return await runQuery(req, res, filter, parseConditions(query.where));

  const conditions = conditionsFromBuilder(query, action);
  const dateErrors = builderDateErrors(query, conditions);
  if (dateErrors.length === 0) {
    return res.redirect(`${LIST_PATH}${caseListSearch({ filter: filter.key, conditions })}`);
  }

  // Not redirected: a set of date parts that names no real date composes to no value, so the canonical
  // URL could not carry what was typed and the caseworker would be looking at an empty box beside the
  // error explaining it. The submission is replayed over the rows instead, as a rejected save is.
  res.status(400);

  return await runQuery(req, res, filter, conditions, dateErrors, query);
};

/**
 * Run the query and render, or render api's refusal of it against the rows it belongs to.
 *
 * A refused query is caught here rather than left to `domainErrorHandler`, which would answer 500 for
 * what is a caseworker's own filter to correct — the same reason the new-case form catches its own.
 */
async function runQuery(
  req: Request,
  res: Response,
  filter: ListFilter,
  conditions: CaseCondition[],
  rowErrors: QueryRowError[] = [],
  submitted?: Record<string, unknown>
) {
  try {
    const page = await findDeedPolls({ filter: filter.key, conditions }, callerFromRequest(req));

    return render(res, filter, conditions, buildCaseList(page.cases), rowErrors, [], submitted);
  } catch (error) {
    if (!(error instanceof InvalidInputError)) throw error;

    const refusals = queryErrors(error.errors, conditions);
    if (refusals.unaddressed.length > 0) console.error(`case query refused: ${error.message}`);
    res.status(400);

    return render(res, filter, conditions, [], [...rowErrors, ...refusals.rows], refusals.unaddressed, submitted);
  }
}

function render(
  res: Response,
  filter: ListFilter,
  conditions: CaseCondition[],
  cases: CaseListRow[],
  rowErrors: QueryRowError[],
  unaddressed: FieldError[],
  submitted?: Record<string, unknown>
) {
  // Resolved here as well as by the render interceptor, because the row builder needs the words before
  // the template does — the pattern `.claude/rules/frontend.md` gives for a schema's messages.
  const content = res.locals.locale === "cy" ? cy : en;

  res.render("deed-polls/index", {
    cases,
    // Each tab carries the query, so switching tab narrows the same conditions within another saved
    // query rather than throwing them away — decision 6.
    filters: filterTabs().map((tab) => ({ ...tab, href: `${LIST_PATH}${caseListSearch({ filter: tab.key, conditions })}` })),
    activeFilter: filter.key,
    clearHref: `${LIST_PATH}${caseListSearch({ filter: filter.key })}`,
    queryRows: buildQueryRows(conditions, content.queryLabels, { rowErrors, submitted }),
    hasQuery: conditions.length > 0,
    errorSummary: errorSummary(content, rowErrors, unaddressed),
    en,
    cy
  });
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
