/**
 * The judicial surface — the two lists a judge works from, the writes they make on a referral (claim, direct, change, withdraw), and
 * the download of its documents.
 *
 * Thin functions over `/judicial/**`, and they are a **sibling** of `../referrals/service.ts` rather than
 * a section of it. Three things follow from that, and all three are api's decisions rather than this file's:
 *
 * **No case id, anywhere.** api keys the whole judicial surface on the referral so a judge cannot name an
 * application, and resolves the case at its own end. So none of these takes a `deedPollId`, there is no
 * judicial equivalent of `findDeedPoll`, and a page that wanted one has nothing to call: the application a judge
 * sees arrives inside `getReferral` as `application`, a projection of its own (`JudicialApplicationView`: the
 * details, witnesses and attached documents, no payment or refund data) that is deliberately not a subset of the
 * caseworker case — api's own architecture test asserts the two records are
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
 * **The 409s and the 404 divide by visibility, not by the action.** (A change or withdraw 409 means "not a `Decided` referral you directed", a state and never a holder.) Visibility is checked first, so a `409` only
 * ever describes a referral the caller can still see. For a claim that leaves exactly one case — they already
 * hold it, or they have already directed it — because a referral in *another* judge's hands is invisible and so a
 * 404. For a direction it is the referral they can see but do not hold (it went back to the pool, or they have
 * already directed it), and the 404 is again the one that moved out of sight. **So no `ConflictError` from either
 * call can mean "somebody else has it", and a page that renders one as "already claimed" is saying something api
 * cannot have said.** Both reach a page as expected states rather than faults: `ConflictError` is a message
 * beside the state it describes, `NotFoundError` is "no longer available", and reaching the 500 page with either
 * means a handler did not catch it.
 *
 * **No role check here, and no author.** api gates every one of these routes on the judicial role and takes the
 * holder and the decider from the token, so a `Caller` is `{ accessToken }` as it is everywhere else. The
 * `requireJudicial` gate in `src/auth/require-role.ts` is the *UI* boundary — which persona's chrome a signed-in
 * user is shown — and not a substitute for api's.
 */
import {
  claimJudicialReferral,
  type DocumentDownload,
  type DocumentPreview,
  directJudicialReferral,
  downloadJudicialDocument,
  getJudicialMyReferrals,
  getJudicialPool,
  getJudicialReferral,
  type JudicialMyReferrals,
  type JudicialPool,
  type JudicialPoolQuery,
  type JudicialReferralDetail,
  previewJudicialDocument,
  reviseDirection,
  withdrawDirection
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi, callPreviewApi } from "../api/deed-poll-api.js";
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
 * claimed and decided referrals are {@link listMyReferrals}'s, and putting them here would show them to every
 * other judge.
 *
 * `paging` last-but-one and `caller` last, as every service in this repo orders them — the plan writes
 * `listPool(caller, paging)`, and matching `findDeedPolls(query, caller)` matters more than matching its prose.
 */
export function listPool(paging: JudicialPoolQuery, caller: Caller): Promise<JudicialPool> {
  return callApi(caller, (config) => getJudicialPool(paging, config));
}

/**
 * One page of the referrals this judge has in hand: the ones they are holding, and the directions the office has
 * not yet actioned.
 *
 * **The list `referrals-admin-6` exists for, and it is a second API-backed collection rather than a filter of the
 * first** (decision 1). Claiming a referral takes it out of `listPool`, which was the only judicial list, so a
 * judge who left the papers could not find them again. Nothing here derives "mine" from rows previously seen, from
 * the session, from `claimedBy` or from anything else this app holds: api keys ownership on the token's IDAM
 * subject and returns the complete page, which is why this function takes no judge and there is none to forge.
 *
 * **Membership, order, paging and the total are all api's** (decision 2). `Claimed` and `Decided` only — no
 * `Open`, which belongs to the pool, and no `Withdrawn` or `Closed`, because this is current work rather than an
 * audit screen — ordered unfinished-work-first and then by the pool's own keys. **Do not filter, regroup or sort
 * what comes back**: api's membership rule is its visibility rule, so a row this list offers is one whose detail
 * read answers 200, and a client-side opinion about either would be a second answer to a question api has settled.
 *
 * `paging` and `caller` in the order every service in this repo takes them, and `JudicialPoolQuery` for the paging
 * because api parses both lists' parameters identically.
 */
export function listMyReferrals(paging: JudicialPoolQuery, caller: Caller): Promise<JudicialMyReferrals> {
  return callApi(caller, (config) => getJudicialMyReferrals(paging, config));
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
 * One of the referral's supporting documents, still streaming, with the headers api put on it.
 *
 * Keyed on the referral and never the case, like every judicial read: api resolves the document against the
 * application behind the referral and answers the same 404 for a document that is not on it as for a referral this
 * judge may not see, so there is nothing to pre-check here either.
 */
export function downloadReferralDocument(referralId: string, documentId: string, caller: Caller): Promise<DocumentDownload> {
  return callApi(caller, (config) => downloadJudicialDocument(referralId, documentId, config));
}

/**
 * The judicial twin of the caseworker preview: one PDF of a referral's document, keyed on the referral and never the
 * case. api applies exactly the download's visibility and answers the same 404 for a document that is not on the
 * referral, so a 404 here is that document being unavailable, not evidence about the referral's holder.
 */
export function previewReferralDocument(referralId: string, documentId: string, caller: Caller, signal?: AbortSignal): Promise<DocumentPreview> {
  return callPreviewApi(caller, (config) => previewJudicialDocument(referralId, documentId, config), signal);
}

/**
 * Pick a referral up out of the pool, becoming its holder.
 *
 * No body — the sub-resource names the transition and the holder comes from the token. The claimed referral
 * comes back in full, so the page that lands on it renders the state it reached rather than assuming one.
 *
 * **Nothing here checks that it is still `Open` first.** The pool a judge is looking at is shared, so a referral
 * open when the page rendered may have been taken since, and only api can say: a pre-read would be a second
 * round trip whose answer was stale by the time it arrived. api re-checks, and its answer for "taken since" is a
 * **404** — visibility before state (`referrals-admin-3` decision 5). The 409 is the narrow remainder: a referral
 * this judge can see and cannot claim, meaning they already hold it or have already directed it.
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

/**
 * Replace the direction this judge gave, while the referral is `Decided` and before the office closes it.
 *
 * The body is {@link recordDirection}'s and validated by the same form. api keeps the earlier direction on its audit
 * trail, writes the caseworker a case note and sets `directionChangedAt`, so nothing here says what changed.
 * `ConflictError` is a visible referral that is not this judge's direction; `NotFoundError` is one out of sight,
 * closed included. Neither can mean somebody else directed it.
 */
export function changeDirection(referralId: string, direction: DirectionInput, caller: Caller): Promise<JudicialReferralDetail> {
  return callApi(caller, (config) => reviseDirection(referralId, direction, config));
}

/**
 * Take back the direction this judge gave, leaving the referral `Claimed` by them with the direction cleared, to be
 * directed again with {@link recordDirection}. No body. The refusals are {@link changeDirection}'s.
 *
 * Named apart from the adapter's `withdrawDirection`, and from the caseworker's `withdrawReferral`, which withdraws
 * the referral itself.
 */
export function withdrawOwnDirection(referralId: string, caller: Caller): Promise<JudicialReferralDetail> {
  return callApi(caller, (config) => withdrawDirection(referralId, config));
}
