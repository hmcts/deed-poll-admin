/**
 * The case list, ported from the prototype's `@Get()` page handler.
 *
 * Everything substantive is in the domain: `filterFor` resolves the saved-query filter and
 * `buildCaseList` formats the rows. What is left here is the page's own content and the shape the
 * template needs, which is what a page handler should be.
 *
 * The prototype's template formatted cells with two custom Nunjucks filters. Those came from
 * `nunjucks.setup.ts`, which `configureGovuk` replaces and which does not register them, so the
 * formatting moved into the view model — see `list-view.ts`.
 */
import { buildCaseList, CASE_LIST_COLUMNS, filterFor, filterTabs, findDeedPolls } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

const en = {
  title: "Deed poll cases",
  heading: "Deed poll cases",
  filterLabel: "Filter by status",
  empty: "No cases match this filter.",
  newCase: "New case",
  columns: CASE_LIST_COLUMNS,
  privateTag: "Private"
};

// Welsh deliberately carries the English text for now. The migration plan's decision is to build
// the en/cy shape and translate later, and the workspace's translation catalogue covers court
// listing terminology rather than deed-poll caseworker forms. Keeping the keys in place means
// translating is a content change rather than a page rewrite.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const filter = filterFor(req.query.filter);
  const cases = await findDeedPolls(filter.where);

  res.render("deed-polls/index", {
    cases: buildCaseList(cases),
    filters: filterTabs(),
    activeFilter: filter.key,
    en,
    cy
  });
};
