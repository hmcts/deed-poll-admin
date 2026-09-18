/**
 * Referrals to the judiciary, read and written through `deed-poll-api`.
 *
 * Four thin functions and no rules of their own. What is worth knowing before reading a caller of these:
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
 * **Both 409s reach a caller as `ConflictError`, and both are expected states rather than faults.** api
 * answers 409 on create when the case already has a referral that is not terminal, and on withdraw when the
 * referral is already closed or withdrawn. The page catches it; reaching the 500 page with one means a
 * handler did not, which is a bug in that handler.
 *
 * **No author parameter**, as everywhere else: api stamps `createdBy` from the caller's own token, so passing
 * a name alongside it would let this app attribute a referral to whoever it liked. The same token is how api
 * decides whether the caller may raise one at all — there is no role check here.
 *
 * **Claiming, directing and closing are not here on purpose.** The adapter carries `closeReferral` and the
 * four `/judicial/**` operations because it tracks the whole of api; this app's caseworker surface uses four
 * of the nine, and the rest arrive with the screens that need them.
 */
import {
  createReferral as apiCreateReferral,
  withdrawReferral as apiWithdrawReferral,
  getReferral,
  listReferrals,
  type Referral
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import type { CreateReferralInput } from "./schemas.js";

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
