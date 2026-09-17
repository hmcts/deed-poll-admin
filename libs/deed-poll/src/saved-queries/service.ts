/**
 * Saved case-list queries, read and written through `deed-poll-api`.
 *
 * Seven thin functions and no rules of their own, because every rule about a saved query is api's. In
 * particular **nothing here decides who may edit or delete one**: `SavedQueryResponse.editable` is api's
 * statement, derived server-side from the same predicate its write paths refuse on, so a local policy
 * function would be a second authority on somebody else's rule. That is why there is no
 * `delete-policy.ts` beside this file as there is beside `../notes/service.ts` and
 * `../witnesses/service.ts` — those two decide a rule this app owns, and this one has none to decide.
 *
 * **Ownership never travels.** api takes the owner from the token's subject, exactly as it takes the
 * audit author, so a `Caller` is still `{ accessToken }` and nothing else. This app holds no user id to
 * send even if a body would carry one — see `../auth/current-user.ts`.
 *
 * Two of api's behaviours are worth knowing before reading a caller of these:
 *
 *   - **A query the caller cannot see is a 404, not a 403.** Somebody else's *unshared* query is
 *     indistinguishable from an id that never existed, so no id is discoverable by watching status
 *     codes. A page must render "gone or never yours" and cannot say which.
 *   - **`deselectSavedQuery` succeeds for a query the caller cannot see**, deliberately unlike
 *     `selectSavedQuery`, which 404s. The selection row is keyed by the caller, so the delete cannot
 *     reach anybody else's — and requiring visibility would trap a subscriber holding a stale selection
 *     for a query its owner has since unshared. **Do not add a visibility pre-check before unselecting.**
 */
import {
  createSavedQuery as apiCreateSavedQuery,
  deselectSavedQuery as apiDeselectSavedQuery,
  selectSavedQuery as apiSelectSavedQuery,
  deleteSavedQuery,
  getSavedQuery,
  listSavedQueries,
  patchSavedQuery,
  type SavedQuery,
  type SavedQueryCreate,
  type SavedQueryPatch
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

/**
 * Every query the caller can see: the shared ones plus their own, each flagged `selected` and `editable`.
 *
 * One call answers both screens. The library lists all of these and the nav renders the `selected`
 * subset, which is a filter over data already held rather than a second round trip — api publishes no
 * "just my selection" operation to make one against, and `GET /caseworker/saved-queries` takes no
 * parameters at all.
 */
export function findSavedQueries(caller: Caller): Promise<SavedQuery[]> {
  return callApi(caller, (config) => listSavedQueries(config));
}

export function findSavedQuery(id: string, caller: Caller): Promise<SavedQuery> {
  return callApi(caller, (config) => getSavedQuery(id, config));
}

/** Save a new query, owned by the caller. `dto` is already validated by the page that took the form. */
export function createSavedQuery(dto: SavedQueryCreate, caller: Caller): Promise<SavedQuery> {
  return callApi(caller, (config) => apiCreateSavedQuery(dto, config));
}

/**
 * Amend a saved query.
 *
 * An omitted property is left as stored and an **explicit null clears the column**, which is unlike
 * `updateNote` and `updateWitness`: no column of theirs is nullable. So a page that means "leave the
 * description alone" must omit it rather than send null, and the two are distinguishable on the wire
 * because `JSON.stringify` drops an undefined property.
 */
export function updateSavedQuery(id: string, dto: SavedQueryPatch, caller: Caller): Promise<SavedQuery> {
  return callApi(caller, (config) => patchSavedQuery(id, dto, config));
}

/**
 * Delete a saved query, with every selection of it.
 *
 * Permitted even where colleagues have it in their lists — api cascades their selections away — which is
 * the whole reason plan 11's decision 5 puts a confirmation page in front of a *shared* query's delete.
 */
export function removeSavedQuery(id: string, caller: Caller): Promise<void> {
  return callApi(caller, (config) => deleteSavedQuery(id, config));
}

/** Add a query to the caller's own list. Idempotent, so a double submit is harmless. */
export function selectSavedQuery(id: string, caller: Caller): Promise<void> {
  return callApi(caller, (config) => apiSelectSavedQuery(id, config));
}

/** Remove a query from the caller's own list. Succeeds whether or not it was in it. */
export function deselectSavedQuery(id: string, caller: Caller): Promise<void> {
  return callApi(caller, (config) => apiDeselectSavedQuery(id, config));
}
