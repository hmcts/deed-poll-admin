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
import { isReorderable, parseSort, serialiseSort } from "../deed-poll/list-sort.js";

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
 *
 * **`q` is restored here, which is the whole of the read half.** Every path back to a saved query's list —
 * `savedQueryHref`, the library rows and the filter nav's entries — builds its URL through this function and
 * then `caseListSearch`, so restoring the term in one place restores it everywhere. `caseListSearch` drops a
 * blank one, so a query api holds no term for is byte-identically the URL it was before.
 *
 * **An order stored against a tab this app does not order is dropped too** — `isReorderable`, and `notify-3b`
 * decision 4. The list handler drops the awaiting-confirmation worklist's `sort` however it arrives, so a link
 * that carried one would state an order the rows are not in *and* would never match the request it produced:
 * `buildSavedQueryNav` compares serialised links, so the entry a caseworker just followed would be the one the
 * bar left unhighlighted. api's filter enum carries the tab, so such a query is savable and this is the fourth
 * way a `sort` reaches the worklist — after the previous tab's link, a bookmark and a hand-edited URL.
 */
export function savedQueryLink(query: SavedQuery): CaseListLink {
  const filter = filterFor(query.filter).key;

  return {
    filter,
    conditions: parseConditions(query.conditions),
    sort: isReorderable(filter) ? savedQuerySort(query) : undefined,
    q: query.searchTerm ?? undefined
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
 *     than as one that reorders the rows by a cell nobody can see. A tab this app does not order at all
 *     (`isReorderable`) stores no order either, for the reason `savedQueryLink` drops one on the way back:
 *     the list would not apply it, so storing it would name the query after an order it never runs in.
 *
 * The filter is narrowed against the adapter's published vocabulary rather than cast: `filterFor` answers
 * one of this app's tab keys and api's enum holds the same set, and going through the array is what fails
 * to compile on the day it does not.
 */
export function savedQueryStored(link: CaseListLink): StoredQueryParts {
  const filter = filterFor(link.filter).key;
  const sort = isReorderable(filter) ? parseSort(link.sort) : undefined;
  const term = link.q?.trim();

  return {
    filter: LIST_FILTER.find((key) => key === filter),
    conditions: caseQueryWhere(link.conditions ?? []),
    sortField: sort?.field,
    sortDirection: sort?.direction,
    // Trimmed, and `undefined` rather than `""` for a blank one: an omitted property is a column api leaves
    // unset, where an empty string is a stored term that matches everything. `caseListSearch` makes the same
    // distinction on the way out, so a saved blank and a saved term round-trip identically to no term.
    searchTerm: term === "" ? undefined : term
  };
}

/**
 * The caseworker's selected queries, as the filter nav's groups beside the statuses.
 *
 * Only the selected ones: the same response feeds the library screen, so the nav is a filter over data
 * already held. In api's order and not re-sorted — it orders by name, and a local sort would hide the day
 * api grows a position column.
 *
 * **Split on published-ness, identically to {@link buildSavedQueryGroups}** — plan 14's decision 3. The two
 * screens have to agree about which group a query is in, which is the whole reason both splits are in this
 * file rather than one here and one in a template. `selected` is applied *first*: a published query the
 * caseworker has not added is in the library screen but in nobody's bar.
 *
 * `current` is decided on the **serialised** link rather than by comparing objects, because that is the
 * form the URL carries and two structurally different conditions arrays can describe one query. `page` is
 * excluded from the comparison on both sides: a caseworker on page 2 of a saved query is still looking at
 * that query, and a nav entry that stopped being current when they paged would be telling them otherwise.
 */
export function buildSavedQueryNav(queries: SavedQuery[], options: { listPath: string; current?: CaseListLink }): SavedQueryNavGroups {
  const current = options.current === undefined ? undefined : linkKey(options.current);
  const selected = queries.filter((query) => query.selected);
  const entryFor = (query: SavedQuery): SavedQueryNavEntry => {
    // The same string twice over, and only because a saved query never carries a page: it is both the
    // link and what the request is compared against.
    const search = caseListSearch(savedQueryLink(query));

    return {
      key: query.id,
      label: query.name,
      href: `${options.listPath}${search}`,
      current: current !== undefined && search === current
    };
  };

  return {
    yours: selected.filter((query) => !query.shared).map(entryFor),
    library: selected.filter((query) => query.shared).map(entryFor)
  };
}

/**
 * Every query the caller can see, in the two groups the screen shows: their own, and the library.
 *
 * **Split on published-ness, not on ownership** — plan 14's decision 3. `yours` is everything not published;
 * `library` is everything published, *including the caller's own*. For a caseworker the two axes are
 * indistinguishable, because their queries are always unpublished and everything published belongs to
 * somebody else; they diverge only for an Administrator who published their own, and published-ness puts it
 * in the group that tells the truth about who else can see it.
 *
 * **This replaced a deliberate refusal to group, and the reasoning is worth keeping.** The previous version
 * returned one flat list and said grouping was the template's business, "and this file makes no claim about
 * which grouping reads better". That was right while grouping was undecided. It is now decided *and* it has
 * to hold identically on two different screens — this list and the case list's filter bar — so it belongs in
 * one tested function rather than being re-derived in two templates.
 *
 * One row shape serves both groups. `shared` stays on the row even though it is now implied by which group
 * the row is in: it is what a row keeps when read on its own, and the template still tags it.
 */
export function buildSavedQueryGroups(queries: SavedQuery[], listPath: string): SavedQueryGroups {
  const rows = queries.map((query) => savedQueryRow(query, listPath));

  return { yours: rows.filter((row) => !row.shared), library: rows.filter((row) => row.shared) };
}

/** One row of either group: what the query is, whose it is, and whether the caller has it in their bar. */
function savedQueryRow(query: SavedQuery, listPath: string): SavedQueryRow {
  return {
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
  };
}

/**
 * The stored order as the `sort` parameter, or `undefined` for api's default.
 *
 * Round-tripped through `parseSort` rather than concatenated, so the one rule about which orders this app
 * will apply — only the six columns the table shows — is applied here too. A query saved with a sort
 * field the table cannot show opens in api's own order rather than reordering the rows by a cell that is
 * not on screen.
 *
 * Reached only for a tab this app orders at all: the other rule — about the whole tab rather than one column —
 * is `savedQueryLink`'s, because it is the tab that decides it.
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
 * The five columns api stores a list query in, typed off the create body so a page cannot hand it a
 * filter or a direction api's enums do not carry.
 *
 * `searchTerm` was plan 12's and went unwritten by both plans — each handed it to the other — so a query
 * saved while a search was active reopened without the term and silently returned different results from
 * the ones it was named after. It is written here now, which is the only place it can be: this is the
 * function that turns a list URL into api's columns.
 */
export type StoredQueryParts = Pick<SavedQueryCreate, "filter" | "conditions" | "sortField" | "sortDirection" | "searchTerm">;

/**
 * The filter bar's saved-query groups, on the same axis as {@link SavedQueryGroups}.
 *
 * Both hold only the caller's **selected** queries, so either may be empty where the library screen's
 * equivalent is not — and an empty one must render no group at all rather than a labelled empty one.
 */
export interface SavedQueryNavGroups {
  /** Selected and not published: the caller's own. */
  yours: SavedQueryNavEntry[];
  /** Selected and published, whoever owns them. */
  library: SavedQueryNavEntry[];
}

/** One entry of a filter-nav saved-query group. Structurally a status tab's entry, deliberately. */
export interface SavedQueryNavEntry {
  /** The query's id. Not its label: two queries may be named the same and a label is not an identity. */
  key: string;
  label: string;
  href: string;
  current: boolean;
}

/**
 * The library screen's two groups.
 *
 * Both may be empty and each is rendered independently, because a labelled group over nothing announces a
 * list that is not there — the same rule `src/pages/deed-polls/index.ts`'s `filterGroups` states for the
 * filter bar. A caller with neither gets the page's single "nothing saved yet" message rather than two.
 */
export interface SavedQueryGroups {
  /** Not published: the caller's own, private to them. */
  yours: SavedQueryRow[];
  /** Published, and so findable by everyone — **including the caller's own published queries**. */
  library: SavedQueryRow[];
}

/** One row of either group. */
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
