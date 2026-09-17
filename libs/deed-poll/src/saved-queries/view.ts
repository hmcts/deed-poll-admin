/**
 * A saved query as the pages render it: a link back to the list it describes, and the row the library
 * shows.
 *
 * **A saved query IS a list URL**, which is what makes this file short. api stores the same four parts a
 * `?filter=…&where=…&sort=…` carries, so turning one back into a link is `caseListSearch` — the function
 * every other list link on the page already goes through. Building the query string here by hand would be
 * the second place that knows which parts a list URL carries, and the first place a caseworker's
 * conditions get quietly dropped.
 *
 * **The stored conditions are `where` strings, and the wire property is `conditions`.** Same
 * `field:operator:value` format the query parameter takes, so `parseConditions` reads them and
 * `serialiseConditions` — inside `caseListSearch` — writes them back. A request body with a `where` key
 * would be dropped in silence, which is worth stating because the two names sit either side of one
 * format.
 *
 * **Nothing here recomputes `editable` or `selected`.** Both are api's statements about the caller, and
 * `editable` in particular is derived server-side from the predicate api's write paths refuse on. They
 * are carried through to the row and no more.
 */
import { LIST_FILTER, type SavedQuery, type SavedQueryCreate } from "@hmcts/deed-poll-api-client";
import { NOT_RECORDED } from "../deed-poll/case-header.js";
import { type CaseListLink, caseListSearch, caseQueryWhere, parseConditions } from "../deed-poll/case-query.js";
import { filterFor } from "../deed-poll/list-filters.js";
import { parseSort, serialiseSort } from "../deed-poll/list-sort.js";

/**
 * The parts of a list link a saved query stands for.
 *
 * `page` is deliberately absent rather than defaulted: api does not store one — page 4 of a previous
 * result set is not a page of this one — so a saved query always opens at the first page.
 *
 * An unrecognised filter falls back through `filterFor`, and an order the table cannot show is dropped by
 * `parseSort`, both for the reason those functions fall back rather than refusing: a query saved against
 * an older version of the list is still a query, and answering it with everything in api's own order beats
 * answering it with a 400.
 */
export function savedQueryLink(query: SavedQuery): CaseListLink {
  return {
    filter: filterFor(query.filter).key,
    conditions: parseConditions(query.conditions),
    sort: savedQuerySort(query)
  };
}

/** Where a saved query points. The path is the page's, because only a page knows where the list lives. */
export function savedQueryHref(query: SavedQuery, listPath: string): string {
  return `${listPath}${caseListSearch(savedQueryLink(query))}`;
}

/**
 * A list link as api stores it — the other direction, and beside `savedQueryLink` so the two stay
 * inverses. `view.test.ts` round-trips a link through both, which is what would catch one of them growing
 * a part the other drops.
 *
 * Two deliberate asymmetries with `savedQueryLink`:
 *
 *   - **Only the complete conditions are stored**, through `caseQueryWhere` rather than
 *     `serialiseConditions`. A half-filled row is a normal state of the builder — "Add condition" produces
 *     one — and it is left off the wire when the list is queried, so storing it would save a query that
 *     finds something other than what was on screen when it was named, and that api may refuse when it is
 *     applied.
 *   - **The order is split into api's two columns**, `sortField` and `sortDirection`. `parseSort` has
 *     already dropped an order the table cannot show, so an unusable `?sort=` is stored as no order rather
 *     than as one that reorders the rows by a cell nobody can see.
 *
 * The filter is narrowed against the adapter's published vocabulary rather than cast: `filterFor` answers
 * one of this app's five keys and api's enum is the same five, and going through the array is what fails
 * to compile on the day it is not.
 */
export function savedQueryStored(link: CaseListLink): StoredQueryParts {
  const sort = parseSort(link.sort);

  return {
    filter: LIST_FILTER.find((key) => key === filterFor(link.filter).key),
    conditions: caseQueryWhere(link.conditions ?? []),
    sortField: sort?.field,
    sortDirection: sort?.direction
  };
}

/**
 * The caseworker's selected queries, as the filter nav's second group.
 *
 * Only the selected ones: the same response feeds the library, so the nav is a filter over data already
 * held. In api's order and not re-sorted — it orders by name, and a local sort would hide the day api
 * grows a position column.
 *
 * `current` is decided on the **serialised** link rather than by comparing objects, because that is the
 * form the URL carries and two structurally different conditions arrays can describe one query. `page` is
 * excluded from the comparison on both sides: a caseworker on page 2 of a saved query is still looking at
 * that query, and a nav entry that stopped being current when they paged would be telling them otherwise.
 */
export function buildSavedQueryNav(queries: SavedQuery[], options: { listPath: string; current?: CaseListLink }): SavedQueryNavEntry[] {
  const current = options.current === undefined ? undefined : linkKey(options.current);

  return queries
    .filter((query) => query.selected)
    .map((query) => {
      // The same string twice over, and only because a saved query never carries a page: it is both the
      // link and what the request is compared against.
      const search = caseListSearch(savedQueryLink(query));

      return {
        key: query.id,
        label: query.name,
        href: `${options.listPath}${search}`,
        current: current !== undefined && search === current
      };
    });
}

/**
 * The library: every query the caller can see, each with what it is, whose it is, and whether it is in
 * their own list.
 *
 * One row shape for both halves of the screen. Shared-versus-own is `shared` and `editable` on the row
 * rather than two lists, so the template decides how to group them and this file makes no claim about
 * which grouping reads better.
 */
export function buildSavedQueryLibrary(queries: SavedQuery[], listPath: string): SavedQueryRow[] {
  return queries.map((query) => ({
    id: query.id,
    name: query.name,
    description: query.description ?? "",
    // Display only, never a key: `ownerName` is audit text, which `../auth/current-user.ts` records is
    // neither stable nor unique — it falls back to a subject and then to a service account's name.
    ownerName: owner(query.ownerName),
    href: savedQueryHref(query, listPath),
    shared: query.shared,
    selected: query.selected,
    editable: query.editable
  }));
}

/**
 * The stored order as the `sort` parameter, or `undefined` for api's default.
 *
 * Round-tripped through `parseSort` rather than concatenated, so the one rule about which orders this app
 * will apply — only the six columns the table shows — is applied here too. A query saved with a sort
 * field the table cannot show opens in api's own order rather than reordering the rows by a cell that is
 * not on screen.
 */
function savedQuerySort(query: SavedQuery): string | undefined {
  const field = query.sortField?.trim();
  if (field === undefined || field === "") return undefined;

  return serialiseSort(parseSort(query.sortDirection ? `${field}:${query.sortDirection}` : field));
}

/** A link as the URL states it, for comparison. `page` is left out — see `buildSavedQueryNav`. */
function linkKey(link: CaseListLink): string {
  return caseListSearch({ filter: link.filter, conditions: link.conditions, sort: link.sort });
}

/** An owner's name, or the placeholder for a query api recorded none for. */
function owner(name: string | null | undefined): string {
  const trimmed = typeof name === "string" ? name.trim() : "";

  return trimmed === "" ? NOT_RECORDED : trimmed;
}

/**
 * The four columns api stores a list query in, typed off the create body so a page cannot hand it a
 * filter or a direction api's enums do not carry. `searchTerm` is plan 12's and is not written here.
 */
export type StoredQueryParts = Pick<SavedQueryCreate, "filter" | "conditions" | "sortField" | "sortDirection">;

/** One entry of the filter nav's saved-query group. Structurally a status tab's entry, deliberately. */
export interface SavedQueryNavEntry {
  /** The query's id. Not its label: two queries may be named the same and a label is not an identity. */
  key: string;
  label: string;
  href: string;
  current: boolean;
}

/** One row of the library. */
export interface SavedQueryRow {
  id: string;
  name: string;
  /** `""` when api holds none, so the template asks `{% if %}` rather than rendering "null". */
  description: string;
  ownerName: string;
  href: string;
  shared: boolean;
  /** Whether the caller has it in their own list, api's statement. */
  selected: boolean;
  /** Whether api will let the caller amend or delete it. **Never computed here.** */
  editable: boolean;
}
