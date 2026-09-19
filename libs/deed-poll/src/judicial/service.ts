/**
 * The judicial surface — the shared pool a judge pulls from, and the two writes they make on a referral.
 *
 * Four thin functions over `/judicial/**`, and they are a **sibling** of `../referrals/service.ts` rather than
 * a section of it. Three things follow from that, and all three are api's decisions rather than this file's:
 *
 * **No case id, anywhere.** api keys the whole judicial surface on the referral so a judge cannot name an
 * application, and resolves the case at its own end. So none of these takes a `deedPollId`, there is no
 * judicial equivalent of `findDeedPoll`, and a page that wanted one has nothing to call: the application a judge
 * sees arrives inside `getReferral` as `application`, a **narrow** projection (`JudicialCaseView`) that is
 * deliberately not a subset of the caseworker case — api's own architecture test asserts the two records are
 * unrelated, because the failure it guards against is a field added to the caseworker response appearing on a
 * judge's screen. Enriching this data with any other call would be that failure, reintroduced here.
 *
 * **A referral this judge may not see is a 404, indistinguishable from one that never existed.** api's
 * visibility (`referrals-api-3` decision 3) admits an `Open` referral to every judge and a `Claimed`/`Decided`
 * one only to its holder; a withdrawn, closed or another judge's referral, and a mistyped id, all answer the
 * same 404. So `NotFoundError` from any of these means "no longer available" and a page must never render it as
 * "somebody else has it" — saying so would enumerate for a judge exactly what the shared 404 exists to hide.
 * `claimedBy` and `decidedBy` on a response can therefore only ever name this caller or nobody.
 *
 * **The 409s and the 404 divide by visibility, not by the action.** Claiming a referral that is not `Open` is a
 * 409 — including one this judge already holds, because two judges each shown "claimed by me" for different
 * reasons is worse than one being told plainly that somebody got there first. Directing one is a 409 when the
 * judge can see it but does not hold it (it was `Open`, or they have already directed it) and a **404** when they
 * cannot see it at all (another judge claimed it out from under them, or a caseworker withdrew it). Both reach a
 * page as expected states rather than faults: `ConflictError` is a message beside the control, `NotFoundError`
 * is "no longer available", and reaching the 500 page with either means a handler did not catch it.
 *
 * **No role check here, and no author.** api gates every one of these routes on the judicial role and takes the
 * holder and the decider from the token, so a `Caller` is `{ accessToken }` as it is everywhere else. The
 * `requireJudicial` gate in `src/auth/require-role.ts` is the *UI* boundary — which persona's chrome a signed-in
 * user is shown — and not a substitute for api's.
 */
import {
  claimJudicialReferral,
  directJudicialReferral,
  getJudicialPool,
  getJudicialReferral,
  type JudicialPool,
  type JudicialPoolQuery,
  type JudicialReferralDetail
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import type { DirectionInput } from "./schemas.js";

/**
 * One page of the shared pool: the referrals waiting to be picked up, urgent first then longest-waiting.
 *
 * **api's order, api's page, and no local sorting or filtering** (`referrals-admin-3` decision 3). The pool is
 * one queue in one order that api fixes, so `paging` carries a page and a size and nothing else — there is no
 * query to compose and no urgency for this app to decide.
 *
 * `total` on the envelope is what the page renders, rather than a count of the rows it was given: ten is a page
 * size and not a cap, so a bare row count is indistinguishable from "there are ten". `size` is the size api
 * *applied* — it clamps an over-cap value rather than refusing it — so a caller cannot mistake a full page for
 * the whole pool.
 *
 * `Open` only, which is what makes this a pool rather than a list of everything a judge may see: their own
 * claimed and decided referrals are reachable by id, and putting them here would show them to every other judge.
 *
 * `paging` last-but-one and `caller` last, as every service in this repo orders them — the plan writes
 * `listPool(caller, paging)`, and matching `findDeedPolls(query, caller)` matters more than matching its prose.
 */
export function listPool(paging: JudicialPoolQuery, caller: Caller): Promise<JudicialPool> {
  return callApi(caller, (config) => getJudicialPool(paging, config));
}

/**
 * One referral as the judge who may see it reads it: the referral, the narrow application view and the
 * application's timeline, in one call because they are one screen.
 *
 * **One call and no second one is available even in principle.** `application` and `caseNotes` arrive on this
 * payload, so re-reading either would be a round trip for an answer already held — and there is no judicial
 * route to read them from anyway. The notes are read-only here: a judge's writes are exactly claim and direct.
 */
export function getReferral(referralId: string, caller: Caller): Promise<JudicialReferralDetail> {
  return callApi(caller, (config) => getJudicialReferral(referralId, config));
}

/**
 * Pick a referral up out of the pool, becoming its holder.
 *
 * No body — the sub-resource names the transition and the holder comes from the token. The claimed referral
 * comes back in full, so the page that lands on it renders the state it reached rather than assuming one.
 *
 * **Nothing here checks that it is still `Open` first.** The pool a judge is looking at is shared, so a referral
 * open when the page rendered may have been taken since, and only api can say: a pre-read would be a second
 * round trip whose answer was stale by the time it arrived. api re-checks and 409s, which the page renders as
 * "already claimed" (`referrals-admin-3` decision 5).
 */
export function claimReferral(referralId: string, caller: Caller): Promise<JudicialReferralDetail> {
  return callApi(caller, (config) => claimJudicialReferral(referralId, config));
}

/**
 * Record the direction on a referral this judge holds — one call, complete, and final.
 *
 * `direction` is already validated by the page that took the form, so it goes on the wire unchanged. There is no
 * draft and no patch at either end (`referrals-api-2` decision 7): a direction is a single transition, which is
 * why the check-your-answers step carries its state through the request and persists nothing.
 */
export function recordDirection(referralId: string, direction: DirectionInput, caller: Caller): Promise<JudicialReferralDetail> {
  return callApi(caller, (config) => directJudicialReferral(referralId, direction, config));
}
