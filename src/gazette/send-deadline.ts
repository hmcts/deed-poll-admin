/**
 * How long the Gazette send may still wait for api, counted from when the request reached this app.
 *
 * The frontend Application Gateway cuts the browser off 30 s after the request left it, however that time was spent
 * here (a token refresh, `/me`, the re-check of every selected review). So the send gets what is left of a 25 s budget,
 * which leaves about 5 s to render and answer, and the adapter caps it at `GAZETTE_SUBMIT_TIMEOUT_MS` (20 s), the
 * backend gateway's 30 s less the review re-check. Under 5 s is too short for a send that api completes inside the
 * request, so nothing is sent and the page says so: an aborted send would be an unknown outcome, while one never made
 * leaves nothing to recover. Plan `docs/plans/completed/20261021-r03b-gazette-send-deadline.md`.
 */
import type { Response } from "express";

const SEND_BUDGET_MS = 25_000;
const MIN_SEND_MS = 5_000;

/**
 * The milliseconds left to wait for the send, or `null` when that is under the floor and nothing must be sent.
 *
 * `res.locals.receivedAt` is set by `recordArrival`, mounted first in `createApp`. Without it the request is taken to
 * have arrived now, which is the send's behaviour before the deadline existed.
 */
export function gazetteSendTimeLeft(res: Response): number | null {
  const now = Date.now();
  const receivedAt: unknown = res.locals.receivedAt;
  const arrived = typeof receivedAt === "number" && Number.isFinite(receivedAt) ? Math.min(receivedAt, now) : now;
  const left = SEND_BUDGET_MS - (now - arrived);
  return left < MIN_SEND_MS ? null : left;
}
