/**
 * The shared judicial pool — a judge's home, the way `/deed-polls` is a caseworker's.
 *
 * **api's order, api's page, and no query at all.** The pool is one queue that api orders urgent-first then
 * longest-waiting (`referrals-admin-3` decision 3), so this page has no filter bar, no search and no sortable
 * headers: there is nothing for a judge to compose, and a control here would be this app deciding which work
 * comes next. What the request carries is a page number and nothing else.
 *
 * **The total is api's count, read off the envelope.** `buildPaging` is the case list's — its input is the four
 * counts any list envelope carries, which the pool's is — so "1 to 10 of 23" is arithmetic on api's numbers
 * rather than a count of the rows on screen. Ten is a page size, not a cap, so a row count would read as
 * "there are ten" on a pool of a hundred.
 *
 * **A claim api answered 404 to lands here, as a message rather than an error page**, because a referral that has
 * gone is not a referral to stay on: the judge needs the next one. The message names no other judge — api's 404
 * is deliberately indistinguishable between "withdrawn", "closed", "somebody else's" and "never existed"
 * (decision 10), and a message that guessed would enumerate exactly what that hides. A claim's **409** does not
 * land here: api checks visibility before state, so the only 409 it can give is a referral this judge already
 * holds, and that one belongs on the referral rather than on a list it has left.
 *
 * Gated by `requireJudicial`, mounted on `/judicial` in `app.ts`. Nothing in this file asks about the role: the
 * gate is the area's, not the page's, so a page added under it is covered by where it lives.
 */
import { buildPaging, buildPoolRows, listPool, parsePage } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

/** The pool's own path, and the one every judicial URL hangs off. */
const POOL_PATH = "/judicial/referrals";

/**
 * What `[referralId]/claim.ts` redirects back with: the referral is not visible to this judge at all.
 *
 * The only claim refusal that reaches the pool. There is no `taken` counterpart, and adding one would be
 * unreachable code with misleading copy: a referral another judge has taken is api's 404, not its 409.
 */
const CLAIM_UNAVAILABLE = "unavailable";

const en = {
  title: "Referrals for a direction",
  heading: "Referrals for a direction",
  // States the order rather than offering a control over it: the queue is api's, and a judge reading down from
  // the top is reading it in the order the business wants it worked.
  intro: "The most urgent referrals are first, then those waiting longest. Open a referral to read the application and claim it.",
  urgencyHeading: "Urgency",
  reasonsHeading: "Reasons for referral",
  waitingHeading: "Waiting since",
  actionHeading: "Action",
  view: "View",
  // The visually-hidden half of each row's link, so "View" is not the accessible name of every link on the
  // page. The wait is what distinguishes one row from another here — there is no case reference to name, by
  // api's decision 2.
  viewHintFor: (waitingSince: string) => `the referral waiting since ${waitingSince}`,
  empty: "There are no referrals waiting for a direction.",
  pagingLabel: "Pages of referrals",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} referrals`,
  errorSummaryTitle: "There is a problem",
  // The 404 from a claim, which covers a referral withdrawn, closed, taken by another judge, or never there.
  // One sentence for all four, because api answers all four identically on purpose — and decision 10's
  // constraint: it does not say who has it, and does not enumerate the causes either.
  noLongerAvailable: "This referral is no longer available. Choose another referral from the list.",
  // The navigation shared with `mine.ts`, which claiming a referral is now the way into: a claim takes the row off
  // this list, so the pool has to name the list it went to (`referrals-admin-6` decision 4). Both entries are named
  // on both pages so neither can grow a link the other lacks — see `list-navigation.njk`.
  nav: {
    label: "Referral lists",
    pool: "Referrals for a direction",
    mine: "My referrals"
  }
};

// English content in the cy shape — see the note in ../../deed-polls/index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  const page = parsePage(req.query.page);

  // One call, and the only one this page makes. There is nothing additive on it — no nav to build and no count
  // beside the list — so `[id].ts`'s degrade-a-panel rule has nothing to apply to: if the pool cannot be read,
  // there is no page.
  const pool = await listPool({ page }, callerFromRequest(req));
  const paging = buildPaging(pool, (wanted) => `${POOL_PATH}?page=${wanted}`);

  res.render("judicial/referrals/index", {
    // The link's hidden qualifier is resolved here rather than called from the template, following the case
    // list: a template that called its own content functions would be the second place that knows which
    // locale's words it holds.
    rows: buildPoolRows(pool.referrals).map((row) => ({ ...row, viewHint: content.viewHintFor(row.waitingSince) })),
    paging,
    // Empty rather than a zero range: "0 to 0 of 0 referrals" is what stating one would produce for an empty
    // pool, and the empty message is the honest answer.
    pagingSummary: paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total),
    claimRefused: claimRefusal(req.query.claim, content),
    navCurrent: "pool",
    en,
    cy
  });
};

/**
 * The message for a claim api refused, or nothing if the judge did not arrive from one.
 *
 * One outcome, not two: the referral is gone, and the pool is the honest place to say so. It is not rendered as a
 * fault — the pool is shared, so two judges opening the same page is ordinary — and an unrecognised value says
 * nothing at all, since a hand-typed `?claim=` pins no state.
 */
function claimRefusal(raw: unknown, content: typeof en): string {
  return raw === CLAIM_UNAVAILABLE ? content.noLongerAvailable : "";
}
