/**
 * The referral queue (plan Fa1, api F1): the `Open` referrals waiting for a Team leader or Delivery Manager to send
 * them to a Master, the `Claimed` ones already sent, and the referral window's state and counts.
 *
 * **api owns membership, order and the window.** The queue arrives urgent first, then oldest raised (or oldest sent
 * for `Claimed`), and nothing here re-sorts or narrows it. The window's cap, how many have been sent in it and which
 * Masters are available are api's answer too; this module only words the answer, and the page decides nothing from
 * it that api does not decide again at the send.
 */
import {
  sendReferrals as apiSendReferrals,
  getReferralQueue,
  type ReferralQueue,
  type ReferralQueueItem,
  type ReferralQueueWindow,
  type ReferralSend
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import { formatShortDate, NOT_RECORDED } from "../deed-poll/case-header.js";
import { referralReasonLabels } from "./referrals-view.js";
import type { SendSelection } from "./schemas.js";

const LONDON_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" });
const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London" });
// A window's `date` is a calendar day with no zone, so it is formatted as UTC midnight to keep the day it names.
const LONG_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** One page of `Open` or `Claimed` referrals, with the window. Only the state and paging travel. */
export function findReferralQueue(query: { state: "Open" | "Claimed"; page?: number }, caller: Caller): Promise<ReferralQueue> {
  return callApi(caller, (config) => getReferralQueue(query, config));
}

/**
 * The window panel: inside a window, which one, when it closes and how many of the cap have been sent; outside one,
 * when the next opens. `null` when api sent no window, which the page says rather than showing a count of nothing.
 *
 * **"today" and "tomorrow" are this app's clock against api's next window.** api publishes the next window's date and
 * not its own "now", so `now` is the server's; the two agree in every deployed environment. `room` is never negative:
 * a cap lowered below what has already been sent leaves no room, not a debt.
 */
export function buildQueueWindowView(window: ReferralQueueWindow | null | undefined, now: Date): QueueWindowView | null {
  if (!window) return null;

  const current = window.current ?? null;
  const next = window.next ?? null;

  return {
    isOpen: current !== null,
    slot: current?.slot ?? null,
    closesAt: current ? LONDON_TIME.format(new Date(current.closesAt)) : null,
    opensAt: next ? LONDON_TIME.format(new Date(next.opensAt)) : null,
    opensDay: next ? relativeDay(next.date, now) : null,
    opensDate: next ? longDay(next.date) : null,
    cap: window.cap,
    sent: window.sent,
    room: Math.max(window.cap - window.sent, 0),
    masters: window.masters.map((master) => ({ id: master.id, name: master.name ?? NOT_RECORDED, sent: master.sentInWindow }))
  };
}

/** The queue's rows in api's order, every cell a display string. One shape for both tabs. */
export function buildQueueRows(items: readonly ReferralQueueItem[]): QueueRow[] {
  return items.map((item) => ({
    id: item.id,
    caseId: item.caseId,
    reference: item.displayReference ?? NOT_RECORDED,
    newName: fullName(item.newForename, item.newMiddleName, item.newSurname),
    reasons: referralReasonLabels(item.reasons),
    isUrgent: item.urgency === "Urgent",
    raisedBy: item.createdBy ?? NOT_RECORDED,
    raisedOn: formatShortDate(item.createdOn),
    master: item.assignedMaster ? (item.assignedMaster.name ?? NOT_RECORDED) : null,
    sentOn: item.assignedAt ? formatShortDate(item.assignedAt) : null,
    dueBy: item.directionDueBy ? formatShortDate(item.directionDueBy) : null
  }));
}

/**
 * Send the selection, all or nothing (api F1). No pre-read: api checks the window, each referral, each Master and the
 * cap, and a refusal names the entry by its index in `allocations`, which is the selection's order. Sending the same
 * selection again after a lost response is api's no-op, so a page may simply offer the send again.
 */
export function sendReferrals(selection: SendSelection, caller: Caller): Promise<ReferralSend> {
  return callApi(caller, (config) => apiSendReferrals({ allocations: selection.allocations }, config));
}

/** What a send did, from api's answer rather than the selection: the referrals it holds and how many Masters have them. */
export function summariseSend(result: ReferralSend): { referrals: number; masters: number } {
  const masters = new Set(result.referrals.flatMap((referral) => (referral.assignedMaster ? [referral.assignedMaster.id] : [])));

  return { referrals: result.referrals.length, masters: masters.size };
}

/**
 * The review of a selection against a fresh page of the queue: each pair with its referral and its Master, and what
 * the window will hold after the send.
 *
 * `missing` is a ticked referral no longer on the page (sent, withdrawn or moved since), and `unavailable` one whose
 * Master api no longer lists as available; either sends the selection back to the queue. `canSend` is only ever the
 * page's decision about drawing the button: api decides the window, the cap and each pair again at the send.
 */
export function buildSendReview(window: QueueWindowView | null, items: readonly ReferralQueueItem[], selection: SendSelection): SendReview {
  const byId = new Map(buildQueueRows(items).map((row) => [row.id, row]));
  const masters = new Map((window?.masters ?? []).map((master) => [master.id, master.name]));
  const missing = selection.allocations.filter((allocation) => !byId.has(allocation.referralId)).map((allocation) => allocation.referralId);
  // Without a window api listed no Masters, so nothing can be said about one; the page draws no Send then anyway.
  const unavailable =
    window === null
      ? []
      : selection.allocations
          .filter((allocation) => byId.has(allocation.referralId) && !masters.has(allocation.masterId))
          .map((allocation) => allocation.referralId);
  const count = selection.allocations.length;
  const isOverRoom = window !== null && count > window.room;

  return {
    rows: selection.allocations.flatMap((allocation) => {
      const row = byId.get(allocation.referralId);
      const masterName = window === null ? NOT_RECORDED : masters.get(allocation.masterId);
      return row && masterName ? [{ ...row, masterId: allocation.masterId, masterName }] : [];
    }),
    missing,
    unavailable,
    count,
    sentAfter: window === null ? count : window.sent + count,
    isOverRoom,
    canSend: window?.isOpen === true && !isOverRoom && missing.length === 0 && unavailable.length === 0
  };
}

function relativeDay(date: string, now: Date): "today" | "tomorrow" | "later" {
  const today = LONDON_DAY.format(now);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  if (date === today) return "today";
  return date === tomorrow.toISOString().slice(0, 10) ? "tomorrow" : "later";
}

function longDay(date: string): string {
  // en-GB puts a comma after the weekday; GOV.UK style has none.
  return LONG_DAY.format(new Date(`${date}T00:00:00Z`)).replace(",", "");
}

function fullName(...parts: (string | null | undefined)[]): string {
  const name = parts.filter((part): part is string => typeof part === "string" && part.trim() !== "").join(" ");
  return name === "" ? NOT_RECORDED : name;
}

export interface QueueWindowView {
  isOpen: boolean;
  /** The open window's morning (`AM`) or afternoon (`PM`); `null` between windows. */
  slot: "AM" | "PM" | null;
  /** `HH:mm` in London, while a window is open. */
  closesAt: string | null;
  /** `HH:mm` in London, when the next window opens. */
  opensAt: string | null;
  opensDay: "today" | "tomorrow" | "later" | null;
  /** "Monday 2 November 2026", for a next window after tomorrow. */
  opensDate: string | null;
  cap: number;
  sent: number;
  room: number;
  masters: { id: string; name: string; sent: number }[];
}

export interface QueueRow {
  id: string;
  caseId: string;
  reference: string;
  newName: string;
  reasons: string[];
  isUrgent: boolean;
  raisedBy: string;
  /** `dd-mm-yy`. */
  raisedOn: string;
  /** The Master holding a `Claimed` referral; `null` for one still waiting. */
  master: string | null;
  /** `dd-mm-yy`, when it was sent; `null` for one still waiting. */
  sentOn: string | null;
  /** `dd-mm-yy`, when the Master's direction is due. */
  dueBy: string | null;
}

export interface SendReview {
  /** The pairs in the selection's order, each with its row and its Master's name. */
  rows: (QueueRow & { masterId: string; masterName: string })[];
  missing: string[];
  unavailable: string[];
  count: number;
  /** How many the window will have had sent once these are. */
  sentAfter: number;
  isOverRoom: boolean;
  canSend: boolean;
}
