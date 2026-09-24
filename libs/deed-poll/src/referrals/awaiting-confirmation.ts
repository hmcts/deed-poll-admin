/**
 * "Awaiting confirmation": the cases whose applicant has been asked whether they still want their deed
 * enrolled and has not answered yet — as a count for the dashboard, and as one sentence's worth of fact on
 * the case itself.
 *
 * **The count IS the alert**, for the reason `returned-for-action.ts` gives: this app has no push
 * infrastructure, so work a caseworker would otherwise have to remember to look for becomes a number on the
 * case list. What is different here is the *mechanism* — `notify-3b` decision 3. The returned-direction
 * worklist is a `where` on a queryable field, so it is written as a condition; this one is api's **published
 * filter key**, so the key goes on the wire and nothing here recreates the predicate. `awaitingConfirmationSince`
 * is api's denormalisation, recomputed in the transaction that records an answer, and a client-side copy of the
 * rule would be a second opinion about which cases are waiting.
 *
 * **The key is `AWAITING_CONFIRMATION_FILTER` and it lives beside the tab it names**, so the count, the tab and
 * the link the count carries are the same string. Clicking the number therefore runs the query that produced it.
 *
 * Nothing here computes a duration. api publishes `daysAwaitingConfirmation` per row and
 * `awaitingConfirmationSince` per case, both of which are rendered rather than recalculated
 * (`.claude/rules/backend.md`: do not recompute what api publishes).
 */
import type { CaseDetail } from "@hmcts/deed-poll-api-client";
import type { Caller } from "../api/deed-poll-api.js";
import { formatTimestamp } from "../deed-poll/case-header.js";
import { AWAITING_CONFIRMATION_FILTER } from "../deed-poll/list-filters.js";
import { findDeedPolls } from "../deed-poll/service.js";

/**
 * How many cases are waiting for the applicant to answer.
 *
 * `size: 1` because the dashboard needs the number and not the rows — the rows are the worklist, fetched when
 * the caseworker clicks through. `total` is api's count across every page.
 *
 * **No `sort`, deliberately.** api gives this tab its own default order, `awaitingConfirmationSince:asc`
 * — longest wait first — and that is only a *default*, so any order sent here would override it. There is no
 * `q` and no condition either: "N are waiting" is a fact about the service rather than about the tab on
 * screen, the same as the returned-direction count.
 */
export async function countAwaitingConfirmation(caller: Caller): Promise<number> {
  const page = await findDeedPolls({ filter: AWAITING_CONFIRMATION_FILTER, size: 1 }, caller);

  return page.total;
}

/**
 * When the applicant was asked, for a case that is waiting — or `null` for a case waiting for nothing, which
 * is nearly all of them.
 *
 * `null` rather than a placeholder because the case page says nothing at all when there is nothing to say: a
 * row reading "Awaiting confirmation: not applicable" on every case answers a question nobody put.
 *
 * **It is the EARLIEST outstanding request when a case holds more than one.** api recomputes the column as
 * the minimum `confirmationRequestedAt` of the referrals still waiting, and a referral's own state is not
 * consulted — closing one clears neither confirmation column — so answering the newer of two requests leaves
 * the case waiting under the older one's date. Nothing here may present the value as "the" request.
 *
 * Formatted with `formatTimestamp` rather than to the day, so the date reads identically here and on the
 * referral page's own `requestedOn`: one fact rendered two ways on two pages is how the two come apart.
 */
export function awaitingConfirmationRequestedOn(record: AwaitingConfirmationInput): string | null {
  const since = record.awaitingConfirmationSince;

  return since === null || since === undefined ? null : formatTimestamp(since);
}

/**
 * The one field of the case this reads, as a `Pick` rather than the whole record — the same honesty about
 * the coupling that `CaseHeaderInput` buys, and indifferent to the 70 columns it never touches.
 */
export type AwaitingConfirmationInput = Partial<Pick<CaseDetail, "awaitingConfirmationSince">>;
