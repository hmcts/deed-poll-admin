/**
 * The referral queue (plan Fa1): the referrals waiting to be sent to a Master, the ones already with a Master, and the
 * referral window's state. Gated once in `app.ts` on `ALLOCATE_REFERRALS`; this page never asks about the caller.
 *
 * **Two reads, one load-bearing.** "To send" is what the page is for and carries the window, so its failure is the
 * page's. "With a Master" is one tab of two, so its failure degrades to a sentence on that tab and a log line, as the
 * case page's referrals panel does. Only paging travels to api: membership, order and the window are api's.
 */
import { buildPaging, buildQueueRows, buildQueueWindowView, findReferralQueue, parsePage, type QueueRow, type QueueWindowView } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";
import { forLog } from "../../../for-log.js";
import { queueReassignPath, queueReferralPath, REFERRAL_QUEUE_PATH } from "../../../referral-queue/paths.js";

const en = {
  title: "Referrals",
  heading: "Referrals",
  back: "All applications",
  toSendTab: "To send",
  withMasterTab: "With a Master",
  morningOpenFor: (closesAt: string) => `This morning’s window closes at ${closesAt}.`,
  afternoonOpenFor: (closesAt: string) => `This afternoon’s window closes at ${closesAt}.`,
  opensTodayFor: (opensAt: string) => `Referrals can be sent from ${opensAt} today.`,
  opensTomorrowFor: (opensAt: string) => `Referrals can be sent from ${opensAt} tomorrow.`,
  opensOnFor: (opensAt: string, date: string) => `Referrals can be sent from ${opensAt} on ${date}.`,
  sentCountFor: (sent: number, cap: number) => `${sent} of ${cap} referrals sent.`,
  windowUnavailable: "The referral window could not be read, so referrals cannot be sent from here at the moment. Try again shortly.",
  mastersCaption: "Sent to each Master in this window",
  masterColumn: "Master",
  sentInWindowColumn: "Sent this window",
  noMasters: "There are no available Masters to send referrals to.",
  toSendIntro: "Urgent referrals are first, then the longest waiting. Select the referrals to send and choose a Master for each.",
  reference: "Reference",
  newName: "New name",
  reasons: "Reasons",
  raised: "Raised",
  select: "Select",
  selectFor: (reference: string) => `Select ${reference}`,
  masterFor: (reference: string) => `Master for ${reference}`,
  chooseMaster: "Choose a Master",
  urgent: "Urgent",
  continue: "Continue",
  noneToSend: "There are no referrals waiting to be sent.",
  sentOn: "Sent",
  dueBy: "Direction due by",
  reassign: "Reassign",
  noneWithMaster: "There are no referrals with a Master.",
  withMasterUnavailable: "The referrals with a Master could not be loaded. Try again shortly.",
  warningIcon: "Warning",
  emptyPage: "There are no referrals on this page.",
  firstPage: "Go to the first page",
  toSendPagingLabel: "Pages of referrals to send",
  withMasterPagingLabel: "Pages of referrals with a Master",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} referrals`
};

// The page's Welsh is pending, as the settings page's is: the copy is new and goes to translation with it.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  const caller = callerFromRequest(req);
  // Started before the load-bearing read and caught where it is started, so a failure here never rejects unobserved.
  const claimedRead = findReferralQueue({ state: "Claimed", page: parsePage(req.query.sentPage) }, caller).catch((error: unknown) => {
    console.error(`referral queue (with a Master) unavailable: ${forLog(error instanceof Error ? error.message : String(error))}`);
    return null;
  });
  const open = await findReferralQueue({ state: "Open", page: parsePage(req.query.page) }, caller);
  const claimed = await claimedRead;
  const window = buildQueueWindowView(open.window, new Date());

  res.render("deed-polls/referrals/index", {
    en,
    cy,
    window,
    windowText: windowText(window, content),
    toSend: tab(open, (page) => `${REFERRAL_QUEUE_PATH}?page=${page}#to-send`, content),
    withMaster: claimed === null ? null : tab(claimed, (page) => `${REFERRAL_QUEUE_PATH}?sentPage=${page}#with-a-master`, content),
    masterOptions: window?.masters.map((master) => ({ value: master.id, text: master.name })) ?? []
  });
};

/** The panel's sentences, resolved here because they interpolate the window. */
function windowText(window: QueueWindowView | null, content: typeof en): { state: string; count: string } | null {
  if (window === null) return null;

  return { state: windowState(window, content), count: content.sentCountFor(window.sent, window.cap) };
}

function windowState(window: QueueWindowView, content: typeof en): string {
  if (window.isOpen) return (window.slot === "PM" ? content.afternoonOpenFor : content.morningOpenFor)(window.closesAt ?? "");
  if (window.opensAt === null) return "";
  if (window.opensDay === "today") return content.opensTodayFor(window.opensAt);
  if (window.opensDay === "tomorrow") return content.opensTomorrowFor(window.opensAt);
  return content.opensOnFor(window.opensAt, window.opensDate ?? "");
}

/** One tab: its rows with their links, and its paging. The links are built here, through the path helpers. */
function tab(results: Awaited<ReturnType<typeof findReferralQueue>>, href: (page: number) => string, content: typeof en): QueueTab {
  const paging = buildPaging(results, href);

  return {
    rows: buildQueueRows(results.referrals).map((row) => ({
      ...row,
      checkHref: queueReferralPath(row.id, row.caseId),
      reassignHref: queueReassignPath(row.id, row.caseId)
    })),
    paging,
    isBeyondEnd: results.total > 0 && results.page > results.totalPages,
    pagingSummary: paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total)
  };
}

interface QueueTab {
  rows: (QueueRow & { checkHref: string; reassignHref: string })[];
  paging: ReturnType<typeof buildPaging>;
  isBeyondEnd: boolean;
  pagingSummary: string;
}
