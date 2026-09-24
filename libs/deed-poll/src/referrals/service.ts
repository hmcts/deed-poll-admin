/**
 * Referrals to the judiciary, read and written through `deed-poll-api`.
 *
 * Six thin functions and no rules of their own. What is worth knowing before reading a caller of these:
 *
 * **The reads are dedicated calls, unlike witnesses.** `GET /caseworker/cases/{id}` carries a case's notes,
 * witnesses and documents, so `findWitnesses` reads them off the case rather than paying for a second round
 * trip. `referrals` is **not** on that payload — `caseDetailSchema` has no such property — so a page that
 * wants the referral history has to ask for it, exactly as `../notes/service.ts` asks for notes. That is the
 * same rule ("one api call per thing a page needs") reaching the opposite conclusion on different facts, not
 * an inconsistency: a second call for data the first one already carried is the thing the rule forbids.
 *
 * **Nothing here decides whether a referral is open, or which actions it admits.** api publishes `state`, and
 * the live one on the case itself as `currentReferralState`; it also refuses the transitions its state
 * machine forbids. A local `isOpen`/`canWithdraw` would be a second authority on somebody else's rule and
 * would go stale the moment a judge claimed the referral in another session. A withdraw of a terminal
 * referral is api's 409, which `callApi` turns into the `ConflictError` the page renders as a message.
 *
 * **Every 409 reaches a caller as `ConflictError`, and all of them are expected states rather than faults.**
 * api answers 409 on create when the case already has a referral that is not terminal, on withdraw for
 * anything but `Open`/`Claimed`, on close for anything but `Decided`, and on a confirmation that has already
 * been answered or was never asked for. The page catches it; reaching the 500 page with one means a handler did
 * not, which is a bug in that handler.
 *
 * **Withdrawable and terminal are two different questions, both api's.** `Decided` is not terminal — the case
 * still holds it as its live referral and still counts as returned for action — and is still refused a
 * withdrawal, because the direction on it has to be carried out and the referral closed instead
 * (`ReferralState.canBeWithdrawn()`). A single local predicate over `state` would have to answer both and
 * would get one of them wrong.
 *
 * **No author parameter**, as everywhere else: api stamps `createdBy` from the caller's own token, so passing
 * a name alongside it would let this app attribute a referral to whoever it liked. The same token is how api
 * decides whether the caller may raise one at all — there is no role check here.
 *
 * **Claiming and directing are not here on purpose.** The adapter carries the five `/judicial/**` operations
 * because it tracks the whole of api, and the judge's own screens call them through `../judicial/service.ts`;
 * a caseworker never claims or directs. Closing *is* here, as of `referrals-admin-4`: it is how a caseworker
 * records that a returned direction has been carried out, and without it a case could not leave the
 * returned-for-action worklist through the UI at all.
 */
import {
  closeReferral as apiCloseReferral,
  createReferral as apiCreateReferral,
  recordConfirmation as apiRecordConfirmation,
  withdrawReferral as apiWithdrawReferral,
  getReferral,
  listReferrals,
  type Referral
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import type { CreateReferralInput, RecordConfirmationInput } from "./schemas.js";

/**
 * Every referral a case has ever had, newest first as api orders them — the order the tab renders.
 *
 * The whole history rather than the live one: a case may be referred many times over its life, and which of
 * them is live is `state`. A missing case is api's 404 rather than an empty list, so this never answers `[]`
 * for a mistyped id.
 */
export function findReferrals(deedPollId: string, caller: Caller): Promise<Referral[]> {
  return callApi(caller, (config) => listReferrals(deedPollId, config));
}

/**
 * One referral of one case.
 *
 * A referral id that is not under this case is api's 404 — its routes are nested — so there is no scoping
 * pre-read, the same guarantee `findNote` relies on.
 */
export function findReferral(deedPollId: string, id: string, caller: Caller): Promise<Referral> {
  return callApi(caller, (config) => getReferral(deedPollId, id, config));
}

/**
 * Raise a referral, unclaimed into the shared pool.
 *
 * `dto` is already validated by the page that took the form, so it goes on the wire unchanged: every field
 * `createReferralSchema` produces is a field api's create body takes, and there is nothing to add — the
 * state of a new referral is always `Open` and its author comes from the token.
 */
export function createReferral(deedPollId: string, dto: CreateReferralInput, caller: Caller): Promise<Referral> {
  return callApi(caller, (config) => apiCreateReferral(deedPollId, dto, config));
}

/**
 * Withdraw a referral — taking one back before the judiciary has finished with it.
 *
 * No body, which is api's shape: the sub-resource names the transition, so there is nothing left to state.
 * The withdrawn referral comes back, so a page can render the state it landed in rather than assuming one.
 */
export function withdrawReferral(deedPollId: string, id: string, caller: Caller): Promise<Referral> {
  return callApi(caller, (config) => apiWithdrawReferral(deedPollId, id, config));
}

/**
 * Close a referral — the caseworker's record that the judge's direction has been carried out.
 *
 * No body, as the withdrawal has none, and **no pre-read to check the state**: api refuses anything but
 * `Decided` with a 409 the page renders, and a read first would be a second round trip for a fact that could
 * change between the two calls anyway. The closed referral comes back with the judicial fields intact —
 * closing records that the direction was actioned, not that it was undone — so a page can render the state it
 * landed in.
 *
 * **No note and no author.** api stamps the actor from the token, and a closure note would be a second place
 * to look for what was done about a direction: the case's own notes are where that belongs
 * (`referrals-admin-4`, decision 6).
 */
export function closeReferral(deedPollId: string, id: string, caller: Caller): Promise<Referral> {
  return callApi(caller, (config) => apiCloseReferral(deedPollId, id, config));
}

/**
 * Record what the applicant said when they were asked whether they still want the deed enrolled.
 *
 * `dto` is already validated by the page that took the form and goes on the wire unchanged: `outcome` and an
 * optional `note` are the whole body api takes, and **no author** — api stamps the recorder from the token, as
 * everywhere else. The saved referral comes back, so a caller holds the recorded answer without a re-read.
 *
 * **No pre-read of the referral's state.** api refuses a second answer and an answer on a referral nobody asked
 * with 409s the page renders, and a read first would be a round trip for a fact another caseworker can change
 * between the two calls — which is the race the 409 exists for.
 *
 * **The two 409s are distinguishable only by their prose, so nothing here or above may branch on the message.**
 * `callApi` turns both into one `ConflictError`; the page decides what to say from the referral it re-reads.
 *
 * **Recording changes no case state and no case date** (`notify-3b` decision 8). api writes the four confirmation
 * columns, a case note, and the case's `awaitingConfirmationSince` — which is how the case leaves the
 * awaiting-confirmation worklist — and nothing else. What a caseworker should do next about the case's dates is
 * an open business question, so this app must not answer it.
 */
export function recordConfirmation(deedPollId: string, id: string, dto: RecordConfirmationInput, caller: Caller): Promise<Referral> {
  return callApi(caller, (config) => apiRecordConfirmation(deedPollId, id, dto, config));
}
