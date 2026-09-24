/**
 * The saved-query filters above the case list, porting the Dynamics system views.
 *
 * In the domain rather than on the page because each one is a `where` clause — a statement about
 * which states count as "open", which is a business rule the list page merely renders. The
 * prototype had them as a module-level constant in its pages controller, which meant the API could
 * not offer the same filters without restating them.
 *
 * `all` deliberately has no `where`: `findDeedPolls({}, …)` returns everything, and an empty object
 * would be an equivalent but noisier way of saying so.
 *
 * **Not to be confused with the query builder's conditions.** `DeedPollQuery.conditions` are a
 * caseworker's own question, sent as api's repeated `where` parameters and ANDed with whichever of these
 * tabs is selected. A tab is never expressed as a condition — that would change what a bookmarked
 * `?filter=open` means.
 *
 * **`where` is no longer read by anything.** Since the cutover the service sends api the filter's KEY
 * and api resolves it — its `ListFilters` is the port of this file, the same keys in the same
 * order. What is left here is the tab bar and the record of what each key stands for, kept because it
 * is the business rule this app's list page is expressing and a key on its own says nothing about it.
 */
import { DeedPollState } from "./enums/option-sets.js";

/**
 * api's key for the awaiting-confirmation worklist, written down once because three things have to agree
 * on it: the tab below, the count read with it, and the link that count carries
 * (`../referrals/awaiting-confirmation.ts`, and `notify-3b` decision 3). Two spellings of it would be two
 * answers to one question the first time either moved.
 */
export const AWAITING_CONFIRMATION_FILTER = "awaitingConfirmation";

export interface ListFilter {
  key: string;
  label: string;
  where?: ListFilterWhere;
}

/**
 * The state predicate a filter stands for.
 *
 * Structurally what the deleted data access layer's generated `where` type supplied for the
 * `state` column, restated when that layer went because no filter here ever constrained any of
 * the other 70. It stays a predicate rather than
 * becoming a bare list of states so the "Open" rule below can still be written by exclusion.
 */
export interface ListFilterWhere {
  state: DeedPollState | { notIn: DeedPollState[] };
}

/**
 * Order matters: it is the order the tabs render in, and the first entry is the fallback for an
 * unrecognised key.
 *
 * "Open" is defined by exclusion — everything not yet finished — rather than by listing the active
 * states. That way a state added to the enum later shows up as open by default, which is the safe
 * direction: a new state appearing in a caseworker's open list is noticeable, whereas one silently
 * missing from it is not.
 */
export const LIST_FILTERS: ListFilter[] = [
  { key: "all", label: "All applications" },
  { key: "open", label: "Open", where: { state: { notIn: [DeedPollState.Enroled, DeedPollState.Returned] } } },
  { key: "received", label: "Received", where: { state: DeedPollState.Received } },
  { key: "enroled", label: "Enroled", where: { state: DeedPollState.Enroled } },
  { key: "returned", label: "Returned", where: { state: DeedPollState.Returned } },
  // The one tab whose criterion is not a case state, which is why it has no `where` to state: a case is on
  // it because api's `awaitingConfirmationSince` is set, and its `state` still reads `Returned` — there is
  // no ninth case state (`notify-3b` decision 2). Appended after `returned` because api appends it there,
  // so a caseworker's existing tab bar keeps its shape rather than having a tab inserted into the middle.
  { key: AWAITING_CONFIRMATION_FILTER, label: "Awaiting confirmation" }
];

/**
 * Resolve a filter key from a query string, falling back to the first filter.
 *
 * Falls back rather than throwing because the key comes from a URL a caseworker may have edited or
 * bookmarked against an older version. A 400 on `?filter=nonsense` would be technically defensible
 * and useless: the list is the service's front page, and showing everything is a safe answer.
 */
export function filterFor(key: unknown): ListFilter {
  return LIST_FILTERS.find((filter) => filter.key === key) ?? LIST_FILTERS[0];
}

/** The filters as the tab bar needs them — no `where`, which is not the template's business. */
export function filterTabs(): { key: string; label: string }[] {
  return LIST_FILTERS.map(({ key, label }) => ({ key, label }));
}
