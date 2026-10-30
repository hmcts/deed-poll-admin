/**
 * The referral queue's check page (plan Fa1): each selected referral with the Master it will go to, what the window
 * will hold afterwards, and **Send referrals** only inside a window and within the room left. The send redraws it with
 * api's sentence when api refuses the window or the cap.
 *
 * **It re-reads the page of the queue the selection was made on**, because the rows it lists and the window it totals
 * must be api's now, not as the queue was drawn. A ticked referral no longer on that page, or a Master no longer
 * available, sends the selection back to the queue beside its row, where it can be changed. Nothing here is a
 * guarantee: api checks every pair, the window and the cap again at the send.
 *
 * The pairs travel in hidden inputs in the queue form's own shape, never in the session, so two tabs make two
 * independent selections and the send parses them with the same schema.
 */
import {
  buildQueueWindowView,
  buildSendReview,
  findReferralQueue,
  parsePage,
  type QueueWindowView,
  type SendReview,
  type SendSelection
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../auth/current-user.js";
import { REFERRAL_QUEUE_PATH } from "./paths.js";
import { queueContentCy, queueContentEn, renderQueue, windowText } from "./queue-page.js";

export const reviewContentEn = {
  title: "Check the referrals before sending",
  heading: "Check the referrals before sending",
  back: "Back to referrals",
  reference: "Reference",
  reasons: "Reasons",
  masterColumn: "Master",
  urgent: "Urgent",
  sendsFor: (count: number) => `This sends ${count} ${count === 1 ? "referral" : "referrals"}.`,
  morningTotalFor: (sent: number, cap: number) => `${sent} of ${cap} will have been sent this morning.`,
  afternoonTotalFor: (sent: number, cap: number) => `${sent} of ${cap} will have been sent this afternoon.`,
  morningRoomFor: (room: number) =>
    room === 0 ? "No more referrals can be sent this morning." : `Only ${room} more ${room === 1 ? "referral" : "referrals"} can be sent this morning.`,
  afternoonRoomFor: (room: number) =>
    room === 0 ? "No more referrals can be sent this afternoon." : `Only ${room} more ${room === 1 ? "referral" : "referrals"} can be sent this afternoon.`,
  selectFewer: "Go back to the referrals and select fewer.",
  sendOnceOpen: "Go back to the referrals and send them once the window opens.",
  windowUnavailable: "The referral window could not be read, so these referrals cannot be sent at the moment. Try again shortly.",
  send: "Send referrals",
  errorSummaryTitle: "There is a problem",
  // api's rejection naming nothing this page can place.
  sendRefused: "The referrals could not be sent. Go back to the referrals and try again."
};

// The page's Welsh is pending, as the queue's is.
export const reviewContentCy = { ...reviewContentEn };

/** Draw the check page for a valid selection, or send it back to the queue when it no longer fits the queue. */
export async function renderReview(req: Request, res: Response, body: Record<string, unknown>, selection: SendSelection, refusal?: ReviewRefusal) {
  const isWelsh = res.locals.locale === "cy";
  const content = isWelsh ? reviewContentCy : reviewContentEn;
  const queueContent = isWelsh ? queueContentCy : queueContentEn;
  const page = parsePage(body.page);
  const open = await findReferralQueue({ state: "Open", page }, callerFromRequest(req));
  const window = buildQueueWindowView(open.window, new Date());
  const review = buildSendReview(window, open.referrals, selection);

  if (review.missing.length > 0) return renderQueue(req, res, { status: 409, body, errors: [], message: queueContent.noLongerWaiting });
  if (review.unavailable.length > 0) {
    const errors = review.unavailable.map((referralId) => ({ field: `master-${referralId}`, message: queueContent.masterUnavailable }));
    return renderQueue(req, res, { status: 400, body, errors });
  }

  if (refusal) res.status(refusal.status);
  res.render("deed-polls/referrals/review", {
    en: reviewContentEn,
    cy: reviewContentCy,
    backHref: REFERRAL_QUEUE_PATH,
    rows: review.rows,
    page: open.page,
    totals: totals(window, review, content, queueContent),
    canSend: review.canSend,
    errorList: refusal ? [{ text: refusal.message }] : []
  });
}

/** The sentences under the list: what the send will do, or why it cannot be sent from here now. */
function totals(window: QueueWindowView | null, review: SendReview, content: typeof reviewContentEn, queueContent: typeof queueContentEn): string[] {
  if (window === null) return [content.windowUnavailable];
  if (!window.isOpen) return [windowText(window, queueContent)?.state ?? "", content.sendOnceOpen].filter((text) => text !== "");

  const isAfternoon = window.slot === "PM";
  if (review.isOverRoom) return [(isAfternoon ? content.afternoonRoomFor : content.morningRoomFor)(window.room), content.selectFewer];
  return [content.sendsFor(review.count), (isAfternoon ? content.afternoonTotalFor : content.morningTotalFor)(review.sentAfter, window.cap)];
}

/** api's refusal of the window or the cap, in api's words, above the list. */
export interface ReviewRefusal {
  status: number;
  message: string;
}
