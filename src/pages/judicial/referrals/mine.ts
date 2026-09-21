/**
 * A judge's own referrals: the ones they are holding, and the directions the office has not yet actioned.
 *
 * **The page `referrals-admin-6` exists for.** The pool is `Open` only, so a successful claim took a referral off
 * the only judicial list — a judge who navigated away could reach it again only through browser history or a
 * remembered UUID, which is what business testing found. This is the second list, and the reason it is a second
 * api-backed collection rather than a filter of the first (decision 1): "mine" is api's answer from the token's
 * IDAM subject, so nothing here derives it from rows previously seen, from the session or from `claimedBy`, and
 * there is no judge in the request to forge.
 *
 * **Membership, order, paging and the total are api's** (decision 2). `Claimed` and `Decided` only — current
 * judicial work and recently finished work still awaiting the office, not a history screen — which is why this
 * page has no filter bar, no status tabs and no sortable headers: there is nothing for a judge to compose, and a
 * control here would be this app deciding which of their own referrals comes next.
 *
 * **The same narrow summary the pool's rows are built from and nothing more** (decision 3). `buildMyReferralRows`
 * formats `JudicialReferralSummary`, so there is no applicant name, no case reference and no direction text to
 * show — and no second call to fetch them with, which is both the disclosure boundary and what keeps a worklist
 * from becoming an N+1. The link is keyed on the referral id alone.
 *
 * **`/mine` is a literal segment that must win over `[referralId]`** (decision 6). `simple-router` sorts static
 * paths ahead of parameterised ones, so this file is dispatched before `[referralId].ts` and the word is never
 * read as a referral id; `mine.test.ts` pins that from the router rather than trusting the sort.
 *
 * Gated by `requireJudicial`, mounted on `/judicial` in `app.ts`. Nothing in this file asks about the role: the
 * gate is the area's, not the page's.
 */
import { buildMyReferralRows, buildPaging, listMyReferrals, parsePage } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

/** This page's own path, which its pagination links back to. */
const MINE_PATH = "/judicial/referrals/mine";

const en = {
  title: "My referrals",
  heading: "My referrals",
  // Says what the two statuses mean and what leaves the list, because both are surprising otherwise: a
  // direction stays here until the office actions it, and then the row simply goes.
  intro:
    "These are the referrals you have claimed. A referral stays here until the court has actioned your direction, and the ones still needing a direction are first.",
  statusHeading: "Status",
  urgencyHeading: "Urgency",
  reasonsHeading: "Reasons for referral",
  raisedHeading: "Referred on",
  actionHeading: "Action",
  view: "View",
  // The visually-hidden half of each row's link, so "View" is not the accessible name of every link on the page.
  // Qualified by the referral date for the pool's reason — there is no case reference to name, by api's decision
  // 2 — and by the status, which is what distinguishes one of a judge's own referrals from another.
  viewHintFor: (status: string, raisedOn: string) => `the referral referred on ${raisedOn}, ${status}`,
  // A judge holding nothing is api's empty page rather than a refusal, and it is the ordinary state at the start
  // of a day. It says where the work is instead of only that there is none here.
  empty: "You have no referrals. Referrals you claim from the shared list appear here.",
  pagingLabel: "Pages of referrals",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} referrals`,
  // The navigation shared with the pool. Both entries are named on both pages so neither can grow a link the
  // other lacks — see `list-navigation.njk`.
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

  // One call, and the only one this page makes. There is nothing additive beside the list — no count and no nav
  // to read — so `[id].ts`'s degrade-a-panel rule has nothing to apply to: if this cannot be read, there is no
  // page, and an empty "My referrals" would tell a judge their work had gone.
  const mine = await listMyReferrals({ page }, callerFromRequest(req));
  const paging = buildPaging(mine, (wanted) => `${MINE_PATH}?page=${wanted}`);

  res.render("judicial/referrals/mine", {
    // Each row's hidden qualifier is resolved here rather than called from the template, following the pool: a
    // template that called its own content functions would be the second place that knows which locale's words
    // it holds.
    rows: buildMyReferralRows(mine.referrals).map((row) => ({ ...row, viewHint: content.viewHintFor(row.status, row.raisedOn) })),
    paging,
    // Empty rather than a zero range, as the pool does: "0 to 0 of 0 referrals" is what stating one would
    // produce for a judge holding nothing, and the empty message is the honest answer.
    pagingSummary: paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total),
    navCurrent: "mine",
    en,
    cy
  });
};
