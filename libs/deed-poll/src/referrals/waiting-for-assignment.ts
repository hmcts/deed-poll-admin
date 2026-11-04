/**
 * "Waiting to be sent": the cases whose live referral no Master has (plans Db1 and Fa1), as a count and as the query that
 * count links to.
 *
 * Built exactly as `returned-for-action.ts` is, for its reasons: one condition written down once, so the number and
 * the worklist behind it are the same question. **A `where` on `currentReferralState`, not a filter key**, because api
 * publishes no tab for it. A referral waits to be sent when it has just been raised (plan Fa1: every raise is `Open`),
 * or when api's sweep took it back from a Master after the processing window passed with no direction; both are
 * `Open`, and this module decides nothing about which.
 */
import type { Caller } from "../api/deed-poll-api.js";
import type { CaseCondition } from "../deed-poll/case-query.js";
import { findDeedPolls } from "../deed-poll/service.js";

/** The fixed condition: a case whose live referral is `Open`. A fresh copy per caller, as `returnedForActionConditions`. */
export function waitingForAssignmentConditions(): CaseCondition[] {
  return [{ field: "currentReferralState", operator: "is", values: ["Open"] }];
}

/** How many cases have a referral waiting for a Master. api's `total`, read with the smallest page. */
export async function countWaitingForAssignment(caller: Caller): Promise<number> {
  const page = await findDeedPolls({ conditions: waitingForAssignmentConditions(), size: 1 }, caller);

  return page.total;
}
