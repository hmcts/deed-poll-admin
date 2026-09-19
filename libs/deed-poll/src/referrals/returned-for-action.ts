/**
 * "Returned — action needed": the cases whose referral a judge has decided and a caseworker has not yet
 * closed, as a count and as the query that count links to.
 *
 * **The count IS the alert.** This app has no push infrastructure — a caseworker learns things on page load —
 * so the shared-mailbox poll it replaces becomes a number on the case-list dashboard
 * (`docs/plans/completed/referrals-admin-2-returned-action-needed.md`, decision 9 made real).
 *
 * **The count and the worklist are one query, written down once.** `returnedForActionConditions()` is what
 * this module counts with and what the dashboard's link carries, so clicking the number runs the same
 * condition that produced it. Two copies of `currentReferralState:is:Decided` would be two answers to one
 * question the first time either was edited.
 *
 * **`Decided` is the whole of the definition, and it is api's.** The judge has recorded a direction
 * (`Claimed → Decided`) and the caseworker's `close` (`Decided → Closed`) has not happened; `Closed` and
 * `Withdrawn` are terminal and `Open`/`Claimed` are not the caseworker's turn. Nothing here inspects a
 * referral or decides what the state means — api resolves the condition and publishes the total, and a case
 * holds at most one non-terminal referral, so this is a per-case count rather than a fan-out.
 */
import type { Caller } from "../api/deed-poll-api.js";
import type { CaseCondition } from "../deed-poll/case-query.js";
import { findDeedPolls } from "../deed-poll/service.js";

/**
 * The fixed condition: a case whose live referral has been decided.
 *
 * A function rather than a shared constant, so the count and every link to the worklist get a copy of their
 * own: the condition is written down once, and nothing that normalises or sorts a `values` array in place can
 * narrow the other callers through it. (`Object.freeze` was the previous answer and only a partial one — it is
 * shallow, so the array a condition holds stayed mutable and shared.)
 *
 * It is deliberately **not** combined with the dashboard's current filter (decision 5): "N need action" is a
 * fact about the service, not about the tab on screen.
 */
export function returnedForActionConditions(): CaseCondition[] {
  return [{ field: "currentReferralState", operator: "is", values: ["Decided"] }];
}

/**
 * How many cases have a returned direction needing action.
 *
 * `size: 1` because the dashboard needs the number and not the rows — the rows are the worklist, fetched when
 * the caseworker clicks through. `total` is api's count across every page, which `.claude/rules/backend.md`
 * forbids recomputing from the rows of one.
 */
export async function countReturnedForAction(caller: Caller): Promise<number> {
  const page = await findDeedPolls({ conditions: returnedForActionConditions(), size: 1 }, caller);

  return page.total;
}
