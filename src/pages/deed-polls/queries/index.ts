/**
 * The library: every saved query this caseworker can see, and whether it is in their own filter bar.
 *
 * One api call answers the whole page. `GET /caseworker/saved-queries` takes no parameters and returns the
 * shared queries plus the caller's own, each already flagged `selected` and `editable`, so the shared/own
 * split is a property of a row rather than two calls — and there is no "just my selection" operation to make
 * a second one against.
 *
 * **Add and remove are the selection sub-resource, and both are idempotent**, so a double submit is
 * harmless: `PUT` on a query already in the list and `DELETE` on one that is not both succeed. That is why
 * neither needs a confirmation and why the page can redirect straight back to itself.
 *
 * **Amend and delete are rendered on api's `editable` and nothing else** — plan 11's decision 3. The flag is
 * derived server-side from the same predicate api's write paths refuse on, so there is no local policy
 * function here as there is beside the note and witness services: this app has no decision to make, only one
 * to render. The control is hidden rather than disabled, for the reason `witness-edit.njk` records — a
 * disabled button has no value to read.
 */
import { buildSavedQueryLibrary, deselectSavedQuery, findSavedQueries, selectSavedQuery } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

const LIST_PATH = "/deed-polls";

const LIBRARY_PATH = "/deed-polls/queries";

const en = {
  title: "Saved queries",
  heading: "Saved queries",
  intro: "Queries you have saved, and queries colleagues have published. Adding one puts it in your filter bar above the case list.",
  // Decision 6, said where somebody is about to add one: a shared query is a live reference, not a copy.
  sharedNote: "A query you add stays its owner's. If they change it, what you see changes with it.",
  sharedTag: "Published",
  selectedTag: "In your filter bar",
  ownerLabel: "Saved by",
  add: "Add to my filter bar",
  remove: "Remove from my filter bar",
  amend: "Amend",
  empty: "No queries have been saved yet. Filter the case list, then save the query you built.",
  backToList: "Back to the case list"
};

// English content in the cy shape — see the note in ../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const queries = await findSavedQueries(callerFromRequest(req));

  res.render("deed-polls/queries/index", {
    // Each row carries the list URL its query stands for, built by `caseListSearch` like every other link to
    // the list, so a library entry and a filter-bar entry cannot point at different results.
    rows: buildSavedQueryLibrary(queries, LIST_PATH),
    backHref: LIST_PATH,
    libraryPath: LIBRARY_PATH,
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { action?: unknown; queryId?: unknown };
  const id = typeof body.queryId === "string" ? body.queryId.trim() : "";
  const caller = callerFromRequest(req);

  // A body with no id is not something either button produces. Answering it with a redirect rather than a
  // call keeps an empty path segment off the wire, where api would read it as a different operation.
  if (id !== "") {
    // `remove` is checked first for the reason the delete branches elsewhere are: only the literal takes the
    // path that changes something a caseworker asked to keep, and neither branch is destructive of the query
    // itself — a selection is the caller's own row.
    if (body.action === "remove") await deselectSavedQuery(id, caller);
    else if (body.action === "add") await selectSavedQuery(id, caller);
  }

  // Back to the library rather than to the list: adding several queries is one visit, and a redirect is what
  // stops a refresh from re-posting.
  res.redirect(LIBRARY_PATH);
};
