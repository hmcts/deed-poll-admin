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
  buildSavedQueryNav,
  buildSortHeaders,
  type Caller,
  type CaseCondition,
  type CaseListPaging,
  type CaseListRow,
  type CaseListSort,
  caseListSearch,
  conditionsFromBuilder,
  countReturnedForAction,
  type FieldError,
  fieldControlName,
  filterFor,
  filterTabs,
  findDeedPolls,
  findSavedQueries,
  InvalidInputError,
  isBlankCondition,
  type ListFilter,
  parseConditions,
  parsePage,
  parseSort,
  type QueryRowError,
  type QueryScriptLabels,
  queryBuilderMetadata,
  queryErrors,
  returnedForActionConditions,
  type SavedQueryNavGroups,
  serialiseConditions,
  serialiseSort,
  unusedConditionRows
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../auth/current-user.js";

const LIST_PATH = "/deed-polls";

/** Where the saved-query pages live: the library, and `new` beneath it — plan 11's decision 9. */
const QUERIES_PATH = "/deed-polls/queries";

/**
 * The "returned — action needed" worklist: the condition the count is read with, as a link.
 *
 * Built from `returnedForActionConditions()` rather than written out, so clicking the number runs the query
 * that produced it — decision 3, and the reason the field had to be genuinely queryable rather than a bespoke
 * aggregate. It deliberately carries no filter, term, order or page: the count is global (decision 5), so its
 * worklist is the same query for every caseworker on every tab.
 */
const RETURNED_FOR_ACTION_PATH = `${LIST_PATH}${caseListSearch({ conditions: returnedForActionConditions() })}`;

const en = {
  title: "Deed poll cases",
  heading: "Deed poll cases",
  // True of every group in the bar rather than of the first one: plan 11's decision 4. "Filter by status"
  // was accurate while the bar held only statuses, and describing a bar of saved queries that way is a lie
  // told only to a screen-reader user.
  filterLabel: "Filter cases",
  // The search box, above the bar — plan 12's decision 4. The hint states what api actually matches: a
  // reference has to be the whole thing (api compares it exactly), a name matches any part of one, and
  // there is no tolerance for a misspelling because the matching is substring rather than fuzzy.
  searchLabel: "Search cases",
  searchHint: "Enter a full case reference, or part of any name on the case.",
  searchButton: "Search",
  // The first group's own label. Labelled because plan 11 puts saved queries in a second group beside it,
  // and an unlabelled bar of both reads as one list — decision 8.
  statusGroupLabel: "Status",
  // The saved-query groups' labels, each rendered only when the caseworker has queries of that kind in their
  // own bar — plan 14. They match the library screen's two headings word for word on purpose: the same query
  // must not appear under "Your queries" on one screen and something else on the other.
  yourQueriesGroupLabel: "Your queries",
  libraryGroupLabel: "Query library",
  empty: "No cases match this filter.",
  // "Returned — action needed" — decisions 4 and 7. Count-sensitive because "1 applications have" is the
  // kind of thing a caseworker stops trusting a service over, and the number is the whole of the message.
  bannerTitle: "Important",
  returnedForActionFor: (count: number) =>
    count === 1 ? "1 application has a returned direction needing action" : `${count} applications have a returned direction needing action`,
  returnedForActionLink: "View these applications",
  // Shown when the count could not be read. Worded so it cannot be mistaken for "nothing needs action", which
  // is precisely what its silent absence used to say — see `returnedForActionCount`.
  returnedForActionUnavailable:
    "The number of applications with a returned direction could not be loaded, so this page cannot say whether any need action. Try again shortly.",
  // GOV.UK's own fallback for the warning icon, which is decorative and needs a text equivalent.
  warningIcon: "Warning",
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
  // The three parts of a date input. Already on screen for a server-rendered one — govuk-frontend's macro
  // defaults each item's label to its own name — so they exist here only for the controls the browser
  // builds, which have no macro to default them.
  dayLabel: "Day",
  monthLabel: "Month",
  yearLabel: "Year",
  // What the builder's live region says when choosing a comparison reveals its value control, or takes one
  // away. `{n}` is the condition's number: one region serves every row, and "a value is wanted" leaves a
  // screen-reader user to guess which of four conditions is asking. Decision 4 — the appearance of a
  // control is announced, and focus is left where the caseworker put it.
  announceValue: "Condition {n} now asks for a value.",
  announceValues: "Condition {n} now asks for two values.",
  announceNoValue: "Condition {n} needs no value.",
  addCondition: "Add condition",
  removeCondition: "Remove condition",
  applyFilters: "Apply filters",
  clearFilters: "Clear filters",
  // The way out to the saved-query pages. A link and not a control in the builder — decision 9 — and it
  // carries the query as the URL states it, so it saves the filters that produced the rows on screen.
  saveQuery: "Save this query",
  savedQueryLibrary: "All saved queries",
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
  const q = searchTerm(query.q);

  const action = builderAction(query);
  if (action === null) {
    return await runQuery(req, res, { filter, q, conditions: parseConditions(query.where), sort, page: parsePage(query.page) });
  }

  const conditions = conditionsFromBuilder(query, action);
  const dateErrors = builderDateErrors(query, conditions);
  if (dateErrors.length === 0) {
    // The order and the search term are carried and the page number is not: a new query narrows a
    // different set of rows, so page 4 of the previous one is not a page of this one. The term travels for
    // the reason every link carries it — decision 1: applying a filter to a search must narrow the search,
    // not silently drop it.
    return res.redirect(`${LIST_PATH}${caseListSearch({ filter: filter.key, q, conditions, sort: serialiseSort(sort) })}`);
  }

  // Not redirected: a set of date parts that names no real date composes to no value, so the canonical
  // URL could not carry what was typed and the caseworker would be looking at an empty box beside the
  // error explaining it. The submission is replayed over the rows instead, as a rejected save is.
  res.status(400);

  return await runQuery(req, res, { filter, q, conditions, sort }, dateErrors, query);
};

/**
 * Run the query and render, or render api's refusal of it against the rows it belongs to.
 *
 * A refused query is caught here rather than left to `domainErrorHandler`, which would answer 500 for
 * what is a caseworker's own filter to correct — the same reason the new-case form catches its own.
 */
async function runQuery(req: Request, res: Response, view: ListView, rowErrors: QueryRowError[] = [], submitted?: Record<string, unknown>) {
  const { filter, q, conditions, sort, page } = view;
  const caller = callerFromRequest(req);
  // Started before the list call and awaited after it: the table, the nav and the count are three things
  // this page needs, and one waiting on the other's round trip would put a second api latency in front of
  // every case list for the sake of a navigation bar.
  const savedQueries = savedQueryEntries(caller, view);
  // A third query, and a different one from the list on screen — decisions 2 and 5. Not narrowed by this
  // request: "N need action" is a fact about the service rather than about the tab being looked at.
  const returnedForAction = returnedForActionCount(caller);

  try {
    const results = await findDeedPolls({ filter: filter.key, q, conditions, sort: serialiseSort(sort), page }, caller);

    // Decision 2: api names the case whose reference the term matched exactly, and somebody who typed a
    // whole reference wants that case rather than a list of one row. **Never on `total === 1`** — a single
    // name match is a list that happens to be short, and the distinction is api's to draw, not this page's.
    if (results.referenceMatch) return res.redirect(`${LIST_PATH}/${results.referenceMatch}`);

    // api's own counts, straight through: `total` and `totalPages` are across every page and cannot be
    // inferred from the rows this one holds — decision 9.
    const paging = buildPaging(results, (wanted) => listHref({ filter: filter.key, q, conditions, sort, page: wanted }));

    return render(res, view, await savedQueries, await returnedForAction, buildCaseList(results.cases), paging, rowErrors, [], submitted);
  } catch (error) {
    if (!(error instanceof InvalidInputError)) throw error;

    const refusals = queryErrors(error.errors, conditions);
    if (refusals.unaddressed.length > 0) console.error(`case query refused: ${error.message}`);
    res.status(400);

    // No paging: a refused query has no page of results to be one of. The count survives, because the
    // query it reads is not the one that was refused — decision 5.
    return render(res, view, await savedQueries, await returnedForAction, [], null, [...rowErrors, ...refusals.rows], refusals.unaddressed, submitted);
  }
}

/**
 * The caseworker's selected queries as nav entries, or none if they could not be read.
 *
 * **A failure here must not cost anyone their case list.** The list is what the page is for and the saved
 * queries are navigation, so an unreachable api leaves the status group alone rather than a 500 —
 * the same reasoning as the adapter never throwing: an unavailable api is a state a page renders. `callApi`
 * throws for every classified failure, so this catches all of them rather than naming one.
 *
 * Logged without the caller or the query, per `client.ts`'s no-PII rule: what a search of the logs needs
 * to answer is whether the nav is degrading, not whose nav it was.
 */
async function savedQueryEntries(caller: Caller, { filter, conditions, sort }: ListView): Promise<SavedQueryNavGroups> {
  try {
    const queries = await findSavedQueries(caller);

    // `current` is the request's own query against each saved one, compared as the URL states it —
    // `buildSavedQueryNav` serialises both sides and drops the page, so paging through a saved query
    // does not stop it being the one you are looking at.
    return buildSavedQueryNav(queries, { listPath: LIST_PATH, current: { filter: filter.key, conditions, sort: serialiseSort(sort) } });
  } catch (error) {
    console.error(`saved queries unavailable: ${error instanceof Error ? error.message : String(error)}`);

    // Both groups empty, so the degraded bar is the status group alone — **not** a labelled group over
    // nothing, and not one empty group beside a populated one. Same sentinel shape as before, one level down.
    return { yours: [], library: [] };
  }
}

/**
 * How many cases have a returned direction needing action, or `null` if the count could not be read.
 *
 * **A failure here must not cost anyone their case list.** The list is load-bearing and the count is one
 * element above it, so the rule `[id].ts` states for its referrals tab applies: an additive second query
 * degrades rather than taking the page with it. `countReturnedForAction` reads a `where` on a field the
 * caseworker did not choose, so a refusal of it is this app's own bug and not theirs to correct — which is
 * why every failure is caught here rather than only the unreachable ones.
 *
 * Logged **and** said on the page. "The count is the alert" has exactly one failure mode nobody would notice —
 * a silently absent banner looks identical to nothing needing action — and a log fixes that for an engineer
 * reading logs, not for the caseworker deciding whether there is work. So `null` is carried through to the
 * template as its own state rather than folded into the zero: three outcomes, three renderings. Same rule as
 * `[id].ts`'s referrals panel, where an unreadable panel says so instead of rendering "None recorded".
 */
async function returnedForActionCount(caller: Caller): Promise<number | null> {
  try {
    return await countReturnedForAction(caller);
  } catch (error) {
    console.error(`returned-for-action count unavailable: ${error instanceof Error ? error.message : String(error)}`);

    return null;
  }
}

function render(
  res: Response,
  view: ListView,
  savedQueries: SavedQueryNavGroups,
  returnedForAction: number | null,
  cases: CaseListRow[],
  paging: CaseListPaging | null,
  rowErrors: QueryRowError[],
  unaddressed: FieldError[],
  submitted?: Record<string, unknown>
) {
  // Resolved here as well as by the render interceptor, because the row builder needs the words before
  // the template does — the pattern `.claude/rules/frontend.md` gives for a schema's messages.
  const content = res.locals.locale === "cy" ? cy : en;
  const { filter, q, conditions, sort } = view;
  // The rows `findDeedPolls` left off the wire, as a caseworker numbers them. Not a status change: the
  // query ran, and being told what it ran on is the point — decision 3.
  const unused = unusedConditionRows(conditions, rowErrors);

  res.render("deed-polls/index", {
    cases,
    // Empty rather than a zero, so the template asks "is there something to say" rather than holding the
    // decision that a zero is not worth saying — decision 4: an alert with a zero in it is not an alert.
    returnedForAction: returnedForAction === null || returnedForAction === 0 ? "" : content.returnedForActionFor(returnedForAction),
    // The third state, and not folded into the empty one: a count that could not be read is not a count of
    // zero, and the template must be able to tell them apart to say so. `returnedForActionCount` has already
    // logged it; this is what the caseworker is told.
    returnedForActionFailed: returnedForAction === null,
    returnedForActionHref: RETURNED_FOR_ACTION_PATH,
    filterGroups: filterGroups(view, content, savedQueries),
    // The builder's own copy of the tab, and deliberately not the nav's: the hidden control is what carries
    // the filter through a GET submission, where a nav entry's `current` is what the bar draws. One value
    // serving both is how the two quietly become the same decision.
    filterValue: filter.key,
    // What the search box shows, so a refined search starts from the term that was searched rather than
    // from an empty box beside somebody else's results.
    searchTerm: q ?? "",
    // The active query as the search form's hidden inputs, so submitting a search composes with it rather
    // than replacing it — decision 4, and api ANDs `q` with `filter` and `where`. Blank rows are left out:
    // a row holding nothing narrows nothing, and `where=:` in the URL a search produces says nothing.
    searchWhere: serialiseConditions(conditions.filter((condition) => !isBlankCondition(condition))),
    clearHref: listHref({ filter: filter.key, q, conditions: [], sort }),
    // The save page is opened with the query in its URL rather than with hidden inputs, because a list URL is
    // the query — so this is `caseListSearch` again, under the other path. `q` is carried like everything
    // else: api stores a `searchTerm`, and a query saved from a set of search results that forgot the term
    // would reopen returning different rows from the ones it was named after.
    saveQueryHref: `${QUERIES_PATH}/new${caseListSearch({ filter: filter.key, q, conditions, sort: serialiseSort(sort) })}`,
    libraryHref: QUERIES_PATH,
    queryRows: buildQueryRows(conditions, content.queryLabels, { rowErrors, submitted }),
    // Once per page, for the enhancement that reveals a value control without a submit. The page renders it
    // whether or not a script is running: it is a data block, and the floor below it is the round trip.
    queryMetadata: queryMetadataJson(content),
    hasQuery: conditions.length > 0,
    unusedConditions: unused.length === 0 ? "" : content.unusedConditionsFor(unused.map((row) => row + 1)),
    // Every header link carries the tab and the conditions, which is the bug this class of UI always has.
    sortHeaders: buildSortHeaders(sort, (next) => listHref({ filter: filter.key, q, conditions, sort: next })),
    // The builder submits as a GET, so the order it was applied to travels as a control of its own.
    sortValue: serialiseSort(sort) ?? "",
    paging,
    pagingSummary: paging === null || paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total),
    errorSummary: errorSummary(content, rowErrors, unaddressed),
    en,
    cy
  });
}

/**
 * The bar's groups: the statuses, then the caseworker's own selected queries and the library's.
 *
 * One data shape for every group, so a third costs no template change — decision 4, and plan 14 is what
 * cashed that in: `index.njk` iterates `filterGroups` and names no group, so **the bar went from two groups
 * to three without a markup change**. Verified in the template rather than assumed.
 *
 * An empty group renders **nothing** rather than an empty one: a labelled group over nothing announces a list
 * that is not there, and to a screen-reader user a heading is a promise of content. With two saved-query
 * groups that rule now applies twice and independently, so the bar may carry one, two or three groups.
 */
function filterGroups(view: ListView, content: typeof en, savedQueries: SavedQueryNavGroups): FilterGroup[] {
  const groups = [statusGroup(view, content)];

  if (savedQueries.yours.length > 0) groups.push({ label: content.yourQueriesGroupLabel, entries: savedQueries.yours });
  if (savedQueries.library.length > 0) groups.push({ label: content.libraryGroupLabel, entries: savedQueries.library });

  return groups;
}

/**
 * The status tabs as a nav group.
 *
 * Each tab carries the query, the search term and the order, so switching tab narrows the same conditions
 * within another saved query rather than throwing them away — decision 6, and plan 12's decision 1. The
 * page number is left behind for the reason a new query leaves it behind: another tab's page 4 holds other
 * rows.
 *
 * `current` is decided here rather than by comparing keys in the template, because the template's
 * `f.key == activeFilter` only worked while every entry in the bar was a status — a saved query's identity
 * is its id, and the page it points at is not named by its label.
 */
function statusGroup({ filter, q, conditions, sort }: ListView, content: typeof en): FilterGroup {
  return {
    label: content.statusGroupLabel,
    entries: filterTabs().map((tab) => ({
      key: tab.key,
      label: tab.label,
      href: listHref({ filter: tab.key, q, conditions, sort }),
      current: tab.key === filter.key
    }))
  };
}

/**
 * The builder's metadata as the JSON text the page carries — decision 4: emitted **once**, never fetched
 * per keystroke, and never a second copy of the operator table. `queryBuilderMetadata` reads it off the same
 * domain functions the rows are rendered from; what is added here is the page's own words.
 *
 * `<` is escaped and nothing else is. A `<script>` element's contents are raw text, so the block cannot be
 * HTML-escaped — `&quot;` would not parse as JSON — which leaves exactly one sequence able to end the
 * element early. Escaping it as `<` is still valid JSON and still the same string.
 */
function queryMetadataJson(content: typeof en): string {
  const labels: QueryScriptLabels = {
    chooseOperator: content.queryLabels.chooseOperator,
    chooseValue: content.queryLabels.chooseValue,
    yes: content.queryLabels.yes,
    no: content.queryLabels.no,
    value: content.valueLabel,
    lowerBound: content.lowerBoundLabel,
    upperBound: content.upperBoundLabel,
    day: content.dayLabel,
    month: content.monthLabel,
    year: content.yearLabel,
    enterValue: content.queryLabels.enterValue,
    enterBothValues: content.queryLabels.enterBothValues,
    announceValue: content.announceValue,
    announceValues: content.announceValues,
    announceNoValue: content.announceNoValue
  };

  return JSON.stringify(queryBuilderMetadata(labels)).replaceAll("<", "\\u003c");
}

/** The condition numbers as a sentence reads them: `2`, `2 and 3`, `2, 3 and 5`. */
function listOfNumbers(numbers: number[]): string {
  return numbers.length < 2 ? numbers.join("") : `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * A link to the list, and the only way one is built here: `caseListSearch` owns which parts a URL carries
 * and which it omits, so a tab, a sort header and a page number cannot each remember a different subset.
 *
 * One shape for every call site is what makes plan 12's decision 1 hold: `q` was added here and to
 * `caseListSearch`, and every link on the page carried it without being visited.
 */
function listHref({
  filter,
  q,
  conditions,
  sort,
  page
}: {
  filter: string;
  q?: string;
  conditions: CaseCondition[];
  sort?: CaseListSort;
  page?: number;
}): string {
  return `${LIST_PATH}${caseListSearch({ filter, q, conditions, sort: serialiseSort(sort), page })}`;
}

/**
 * The search term the request carries: trimmed, and `undefined` for one that says nothing — decision 3.
 *
 * Not a parse of a domain value, which is why it is here rather than beside `parseSort`: `q` is free text
 * and what api does with it is api's (decision 5). All this decides is whether there is a term at all,
 * because a `q=` written into a bookmarked URL pins nothing and a term of spaces is not a search.
 * A repeated `?q=a&q=b` arrives as an array and is no term either — one search box, one term.
 */
function searchTerm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const term = value.trim();

  return term === "" ? undefined : term;
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
 * What the request asks the list for: the tab, the search term, the query, the order and the page.
 *
 * Held together rather than passed part by part because every link on the page is built from all of them,
 * and a header link that took all but one is exactly how a sort quietly drops a caseworker's conditions —
 * or, now, their search.
 */
interface ListView {
  filter: ListFilter;
  /** The search term, or nothing. Trimmed by `searchTerm` on the way in — decision 3. */
  q?: string;
  conditions: CaseCondition[];
  sort?: CaseListSort;
  page?: number;
}

/**
 * One labelled group of the filter bar — the statuses, and from task 5 the caseworker's saved queries.
 *
 * A group and not a flat list of entries with a label beside it, because the label belongs to the entries
 * it heads: the previous shape passed one scalar label for one hard-coded group, and a second group would
 * have had to be hard-coded in the template beside it.
 */
interface FilterGroup {
  label: string;
  entries: NavEntry[];
}

/**
 * One destination in the filter bar.
 *
 * `key` identifies the entry — a status's key, a saved query's id — and is never its label: two saved
 * queries may be named the same thing. `current` is the handler's answer to "are we looking at this
 * already", because only the handler knows what the request asked for.
 */
interface NavEntry {
  key: string;
  label: string;
  href: string;
  current: boolean;
}
