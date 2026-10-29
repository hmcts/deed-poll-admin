/**
 * A Master's own referrals — since api D2 their home, and the only judicial list.
 *
 * **Every referral here was assigned, not claimed.** Raising a referral assigns it to a Master, so there is no pool
 * and nothing to pick up: this page is the referrals assigned to this Master that still need a direction, and the
 * directions the office has not yet actioned. "Mine" is api's answer from the token's IDAM subject, so nothing here
 * derives it from rows previously seen, from the session or from `claimedBy`, and there is no judge in the request
 * to forge (`referrals-admin-6` decision 1).
 *
 * **Three sections, as Steve chose on 2026-10-28, read off api's order** (`buildMyReferralSections`): Urgent first,
 * then "Awaiting your direction" and "Directed, awaiting the office", each under one heading per day referred. api's
 * `MINE_ORDER` already puts urgent undirected first, then undirected by date, then directed by date, so the grouping
 * is presentation: nothing is re-sorted, and membership, paging and the total stay api's.
 *
 * **The largest page api serves**, so a day's group is rarely split by a page boundary. `JudicialPoolQuery` publishes
 * no bound; api's `CasePaging.MAX_SIZE` is 100 and it clamps a larger size rather than refusing it. Where a boundary
 * does split a day, the next page is grouped from its own rows and repeats the day's heading.
 *
 * **The summary carries no case reference** (decision 3), so a row is its reasons, its dates and its link, and a
 * page needs no second call per row to say more.
 *
 * **`/mine` is a literal segment that must win over `[referralId]`** (decision 6). `simple-router` sorts static
 * paths ahead of parameterised ones; `mine.test.ts` pins that from the router rather than trusting the sort.
 *
 * Gated by `requireJudicial`, mounted on `/judicial` in `app.ts`. Nothing in this file asks about the role.
 */
import { buildMyReferralSections, buildPaging, listMyReferrals, type MyReferralDay, type MyReferralRow, parsePage } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

/** This page's own path, which its pagination links back to. */
const MINE_PATH = "/judicial/referrals/mine";

/** api's `CasePaging.MAX_SIZE`: the most referrals one page can carry. */
const PAGE_SIZE = 100;

const en = {
  title: "My referrals",
  heading: "My referrals",
  // Says what leaves the list, because otherwise it is surprising: a direction stays here until the office actions
  // it, and then the row simply goes.
  intro: "These are the referrals assigned to you. A referral stays here until the court has actioned your direction.",
  urgentHeading: "Urgent",
  awaitingHeading: "Awaiting your direction",
  directedHeading: "Directed, awaiting the office",
  dayHeadingFor: (day: string) => `${day} referrals`,
  referredOnFor: (day: string) => `Referred ${day}`,
  dueByFor: (day: string) => `Direction due by ${day}`,
  reasonsHeading: "Reasons for referral",
  datesHeading: "Dates",
  actionHeading: "Action",
  view: "View",
  // The visually-hidden half of each row's link, so "View" is not the accessible name of every link on the page.
  // There is no case reference to name, by api's decision 2, so the date and the reasons tell the rows apart.
  viewHintFor: (referredOn: string, reasons: string) => `the referral referred on ${referredOn}: ${reasons}`,
  // A Master with nothing assigned is api's empty page rather than a refusal, and the ordinary state at the start
  // of a day.
  empty: "You have no referrals. Referrals assigned to you appear here.",
  pagingLabel: "Pages of referrals",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} referrals`
};

// English content in the cy shape — see the note in ../../deed-polls/index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  const page = parsePage(req.query.page);

  // One call, and the only one this page makes. There is nothing additive beside the list, so if this cannot be
  // read there is no page: an empty "My referrals" would tell a judge their work had gone.
  const mine = await listMyReferrals({ page, size: PAGE_SIZE }, callerFromRequest(req));
  const paging = buildPaging(mine, (wanted) => `${MINE_PATH}?page=${wanted}`);
  const sections = buildMyReferralSections(mine.referrals);

  // Every sentence is resolved here rather than called from the template: a template that called its own content
  // functions would be the second place that knows which locale's words it holds.
  const row = (referral: MyReferralRow) => ({
    ...referral,
    referredOnText: content.referredOnFor(referral.referredOn),
    dueByText: referral.directionDueBy === null ? "" : content.dueByFor(referral.directionDueBy),
    viewHint: content.viewHintFor(referral.referredOn, referral.reasons.join(", "))
  });
  const days = (groups: MyReferralDay[]) => groups.map((group) => ({ heading: content.dayHeadingFor(group.day), rows: group.rows.map(row) }));

  res.render("judicial/referrals/mine", {
    urgent: sections.urgent.map(row),
    awaiting: days(sections.awaiting),
    directed: days(sections.directed),
    isEmpty: sections.isEmpty,
    paging,
    // Empty rather than a zero range: "0 to 0 of 0 referrals" is what stating one would produce for a judge holding
    // nothing, and the empty message is the honest answer.
    pagingSummary: paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total),
    en,
    cy
  });
};
