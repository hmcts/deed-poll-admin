/**
 * Cases, read and written through `deed-poll-api`.
 *
 * **There is no derived logic left in this file, and that is the point of the cutover.** It used to
 * orchestrate reference-number allocation, the create-time defaults, the Gazette and minor gates, the
 * privacy lock, the cross-field date rules and state derivation on every write. api does all of it now
 * — `DeedPollService` there is the port of exactly this file, rule for rule and comment for comment —
 * so keeping any of it here would be a second opinion about a case, which is the failure mode task 3 of
 * `docs/plans/completed/02-dal-cutover-to-api.md` exists to remove. The rules are not lost; they moved.
 *
 * What is left is the functions the pages and routes already call, so nothing above changed shape beyond
 * gaining a `Caller`. Absence still arrives as `NotFoundError` and a rejected write as
 * `InvalidInputError` carrying its field errors — see `../api/deed-poll-api.ts` for why the adapter's
 * `ApiResult` becomes a throw here rather than at the call site.
 *
 * **`removeDeedPoll` is not among them.** api has no case-delete endpoint, deliberately: the plan's "out
 * of scope" section records the deletes as not rebuilt until something asks, and nothing does — no page
 * offers one. Deleting the function rather than leaving one that could only fail is the honest version of
 * that, and `apps/api`'s `DELETE /deed-polls/:id` went with it.
 */
import {
  type CaseDetail,
  type CaseList,
  createCase,
  type FieldRules,
  type FieldRulesQuery,
  getCase,
  getFieldRules,
  listCases,
  patchCase,
  type SavedCase
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import { InvalidInputError } from "../errors.js";
import { type CaseCondition, caseQueryWhere } from "./case-query.js";
import * as validation from "./deed-poll-validation.js";
import type { CreateDeedPollInput, UpdateDeedPollInput } from "./schemas.js";

/**
 * One page of the cases a saved-query filter and a set of conditions admit.
 *
 * Takes the filter's KEY, not a predicate: api owns which states each key admits (its `ListFilters` is
 * the port of `list-filters.ts`), so resolving a tab into conditions would be this app deciding what
 * "Open" means for a store it no longer has. An unrecognised or absent key resolves to "all" at api's
 * end, which is what `filterFor` does here, so a bookmarked URL behaves the same either way. The tab and
 * the query compose — both are sent, and api ANDs them.
 *
 * The whole page is returned rather than only its rows, because `total` and `totalPages` are api's counts
 * across every page and a caller cannot infer either from the rows it was given. Counting locally is what
 * `.claude/rules/backend.md` means by not recomputing what api publishes.
 *
 * **The conditions are serialised on the way out and never validated here as authoritative.** api
 * re-checks every one against its own `FormFields` and wins any disagreement; `caseQueryWhere` only keeps
 * the incomplete rows of a half-built query off the wire, so adding a condition does not turn the request
 * into a 400 and lose the results already on screen.
 */
export function findDeedPolls(query: DeedPollQuery, caller: Caller): Promise<CaseList> {
  return callApi(caller, (config) =>
    listCases(
      {
        filter: query.filter,
        q: query.q,
        where: caseQueryWhere(query.conditions ?? []),
        sort: query.sort,
        page: query.page,
        size: query.size
      },
      config
    )
  );
}

/**
 * One case with its children.
 *
 * One call, because api returns the notes, witnesses and documents inside the case — and the derived
 * day counts with them, so nothing is computed on the way through. `withComputed()` and its module went
 * with the cutover for that reason.
 */
export function findDeedPoll(id: string, caller: Caller): Promise<CaseDetail> {
  return callApi(caller, (config) => getCase(id, config));
}

/**
 * Create a case.
 *
 * api allocates the reference number and returns it — this app must not generate one, and a second
 * allocator against the same counter would be a correctness bug rather than a duplication. A create
 * with no Date Received still fails with the error attributed to that field, because that is api's rule
 * too: the reference's year comes from it.
 */
export function createDeedPoll(dto: CreateDeedPollInput, caller: Caller): Promise<SavedCase> {
  return callApi(caller, (config) => createCase(dto, config));
}

/** Patch a case. Omitted fields are left alone; a field sent as null clears it. */
export function updateDeedPoll(id: string, dto: UpdateDeedPollInput, caller: Caller): Promise<SavedCase> {
  return callApi(caller, (config) => patchCase(id, dto, config));
}

/**
 * Field show/hide/mandate rules for a Type, from `GET /caseworker/cases/field-rules`.
 *
 * Asynchronous now, where it was a synchronous lookup. `deed-poll-validation.ts` still carries the
 * matrix and `edit-view.ts` still reads it directly, which is not an oversight: the plan keeps the
 * validation and the view models as they are, the conformance harness pins that matrix against the
 * Dataverse exports, and both ends enforcing the same rules is the arrangement `upload-policy.ts`
 * already has. What this function must not be is a local answer to a question api is now asked.
 */
export function getCaseFieldRules(query: FieldRulesQuery, caller: Caller): Promise<FieldRules> {
  return callApi(caller, (config) => getFieldRules(query, config));
}

/**
 * Validate a case for submission — the point at which the source form's required-levels must all be
 * satisfied. Kept separate from `updateDeedPoll` so incremental saves stay unblocked.
 *
 * Still local, because api has no `validate` endpoint: the plan records it among the operations not
 * rebuilt until something asks. The record it checks comes from api, so this reads no database either.
 *
 * api's `CaseDetail` is passed to `validate` **unasserted**, deliberately. It satisfies `ValidationInput`
 * structurally, so this is the one place the local rule matrix's field names and types are checked against
 * the shape api actually publishes — a cast here would let a renamed or retyped field drift past the
 * compiler, which is the divergence the matrix's whole both-ends arrangement exists to catch.
 */
export async function validateCaseForSubmit(id: string, caller: Caller): Promise<CaseDetail> {
  const record = await findDeedPoll(id, caller);
  const errors = validation.validate(record);
  if (errors.length > 0) {
    throw new InvalidInputError("Case is not valid for submission", errors);
  }
  return record;
}

/**
 * What to ask the case list for: a tab, a query, an order and a page.
 *
 * Conditions rather than `where` strings, because a page holds the rows a caseworker is editing and the
 * wire format is `case-query.ts`'s business. Everything is optional and an omitted part is not sent, so
 * api applies its own defaults — no sort is newest first, no page is the first 25.
 */
export interface DeedPollQuery {
  filter?: string;
  /**
   * The search term. api ORs it across the reference and the six name fields and ANDs the result with the
   * filter and the conditions, so a search narrows within a tab rather than replacing it.
   */
  q?: string;
  conditions?: CaseCondition[];
  /** `field` or `field:asc` or `field:desc`, as api reads it. */
  sort?: string;
  /** 1-based. */
  page?: number;
  size?: number;
}
