/**
 * The referral queue page (plan Fa1): the referrals waiting to be sent to a Master, the ones already with a Master,
 * and the referral window's state. Its own module rather than `pages/deed-polls/referrals/index.ts` because the review
 * and the send redraw it, beside the row it is about, when a selection cannot go ahead: the queue is the only page
 * with a control to change it.
 *
 * **Two reads, one load-bearing.** "To send" is what the page is for and carries the window, so its failure is the
 * page's. "With a Master" is one tab of two, so its failure degrades to a sentence on that tab and a log line, as the
 * case page's referrals panel does. Only paging travels to api: membership, order and the window are api's.
 */
import {
  buildPaging,
  buildQueueRows,
  buildQueueWindowView,
  type FieldError,
  findReferralQueue,
  parsePage,
  type QueueRow,
  type QueueWindowView
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../auth/current-user.js";
import { forLog } from "../for-log.js";
import { queueReassignPath, queueReferralPath, REFERRAL_QUEUE_PATH } from "./paths.js";

/** What the queue reads back after a send, a reassignment and a reassignment api refused. */
export const SENT_PARAM = "sent";
export const SENT_MASTERS_PARAM = "masters";
export const REASSIGNED_PARAM = "reassigned";
export const REASSIGN_CONFLICT_PARAM = "reassign";
export const REASSIGN_CONFLICT = "conflict";

export const queueContentEn = {
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
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} referrals`,
  errorSummaryTitle: "There is a problem",
  errorPrefix: "Error:",
  successTitle: "Success",
  importantTitle: "Important",
  sentBannerFor: (referrals: number, masters: number) =>
    `${referrals} ${referrals === 1 ? "referral" : "referrals"} sent to ${masters} ${masters === 1 ? "Master" : "Masters"}.`,
  reassignedBanner: "Referral reassigned.",
  reassignConflict: "That referral could not be reassigned because it is no longer with a Master waiting for a direction.",
  // A referral the selection named is no longer on this page: someone else sent it, or it was withdrawn.
  noLongerWaiting: "A referral you selected is no longer waiting to be sent. Check the list and select again.",
  // api's own words for a Master no longer available, beside the row's select.
  masterUnavailable: "Select a Master who is available"
};

// The page's Welsh is pending, as the settings page's is: the copy is new and goes to translation with it.
export const queueContentCy = { ...queueContentEn };

/**
 * Draw the queue. With a `refusal`, the selection that was posted is drawn back ticked and chosen, its errors beside
 * their rows, on the page it was made on; without one, the banners the review, the send and the reassignment
 * redirect with.
 */
export async function renderQueue(req: Request, res: Response, refusal?: QueueRefusal): Promise<void> {
  const content = res.locals.locale === "cy" ? queueContentCy : queueContentEn;
  const caller = callerFromRequest(req);
  const toSendPage = parsePage(refusal ? refusal.body.page : req.query.page);
  // Started before the load-bearing read and caught where it is started, so a failure here never rejects unobserved.
  const claimedRead = findReferralQueue({ state: "Claimed", page: parsePage(req.query.sentPage) }, caller).catch((error: unknown) => {
    console.error(`referral queue (with a Master) unavailable: ${forLog(error instanceof Error ? error.message : String(error))}`);
    return null;
  });
  const open = await findReferralQueue({ state: "Open", page: toSendPage }, caller);
  const claimed = await claimedRead;
  const window = buildQueueWindowView(open.window, new Date());
  const selection = selectionFrom(refusal?.body ?? {});
  const errors = new Map((refusal?.errors ?? []).map((error) => [error.field, error.message]));
  const toSend = tab(open, (page) => `${REFERRAL_QUEUE_PATH}?page=${page}#to-send`, content);
  const toSendRows = toSend.rows.map((row, index) => ({
    ...row,
    isSelected: selection.ticked.has(row.id),
    masterValue: selection.masters.get(row.id) ?? "",
    masterError: errors.get(`master-${row.id}`) ?? "",
    masterControlId: `master-${index + 1}`
  }));

  if (refusal) res.status(refusal.status);
  res.render("deed-polls/referrals/index", {
    en: queueContentEn,
    cy: queueContentCy,
    window,
    windowText: windowText(window, content),
    toSend: { ...toSend, rows: toSendRows, page: open.page },
    withMaster: claimed === null ? null : tab(claimed, (page) => `${REFERRAL_QUEUE_PATH}?sentPage=${page}#with-a-master`, content),
    masterOptions: window?.masters.map((master) => ({ value: master.id, text: master.name })) ?? [],
    selectionError: errors.get("referrals") ?? "",
    errorList: refusal ? errorList(refusal, errors, toSendRows) : [],
    banner: refusal ? null : banner(req, content)
  });
}

/** The queue's sentences for the window panel, the review's too, resolved here because they interpolate the window. */
export function windowText(window: QueueWindowView | null, content: typeof queueContentEn): { state: string; count: string } | null {
  if (window === null) return null;

  return { state: windowState(window, content), count: content.sentCountFor(window.sent, window.cap) };
}

/** What was posted, read only as strings, so a refused selection is drawn back as the caseworker left it. */
function selectionFrom(body: Record<string, unknown>): { ticked: Set<string>; masters: Map<string, string> } {
  const posted = Array.isArray(body.referrals) ? body.referrals : [body.referrals];
  const ticked = posted.filter((value): value is string => typeof value === "string");
  const masters = ticked.flatMap((id) => {
    const master = body[`master-${id}`];
    return typeof master === "string" ? [[id, master] as const] : [];
  });

  return { ticked: new Set(ticked), masters: new Map(masters) };
}

function windowState(window: QueueWindowView, content: typeof queueContentEn): string {
  if (window.isOpen) return (window.slot === "PM" ? content.afternoonOpenFor : content.morningOpenFor)(window.closesAt ?? "");
  if (window.opensAt === null) return "";
  if (window.opensDay === "today") return content.opensTodayFor(window.opensAt);
  if (window.opensDay === "tomorrow") return content.opensTomorrowFor(window.opensAt);
  return content.opensOnFor(window.opensAt, window.opensDate ?? "");
}

/** One tab: its rows with their links, and its paging. The links are built here, through the path helpers. */
function tab(results: Awaited<ReturnType<typeof findReferralQueue>>, href: (page: number) => string, content: typeof queueContentEn): QueueTab {
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

/** The summary in the page's order: the selection's own sentence, the selection's error, then each row's. */
function errorList(refusal: QueueRefusal, errors: Map<string, string>, rows: { id: string; masterError: string; masterControlId: string }[]) {
  return [
    ...(refusal.message ? [{ text: refusal.message, href: "#to-send" }] : []),
    ...(errors.has("referrals") ? [{ text: errors.get("referrals") as string, href: "#select-1" }] : []),
    ...rows.filter((row) => row.masterError !== "").map((row) => ({ text: row.masterError, href: `#${row.masterControlId}` }))
  ];
}

/** The banner a redirect asked for. Counts that are not positive whole numbers draw none, so a URL cannot word one. */
function banner(req: Request, content: typeof queueContentEn): { type: "success" | "important"; text: string } | null {
  const referrals = parsePage(req.query[SENT_PARAM]);
  const masters = parsePage(req.query[SENT_MASTERS_PARAM]);
  if (referrals !== undefined && masters !== undefined) return { type: "success", text: content.sentBannerFor(referrals, masters) };
  if (req.query[REASSIGNED_PARAM] === "1") return { type: "success", text: content.reassignedBanner };
  if (req.query[REASSIGN_CONFLICT_PARAM] === REASSIGN_CONFLICT) return { type: "important", text: content.reassignConflict };
  return null;
}

/** A selection the queue is drawn back for: the posted body, the errors beside its rows and any sentence above them. */
export interface QueueRefusal {
  status: number;
  body: Record<string, unknown>;
  /** `referrals` for the selection itself, `master-<referralId>` for a row's Master. */
  errors: FieldError[];
  message?: string;
}

interface QueueTab {
  rows: (QueueRow & { checkHref: string; reassignHref: string })[];
  paging: ReturnType<typeof buildPaging>;
  isBeyondEnd: boolean;
  pagingSummary: string;
}
