/**
 * How long the Gazette send may still wait for api, counted from when the request reached this app.
 *
 * The frontend Application Gateway cuts the browser off 30 s after the request left it, however that time was spent
 * here (a token refresh, `/me`, the re-check of every selected review). So the send gets what is left of a 25 s budget,
 * which leaves about 5 s to render and answer, and the adapter caps it at `GAZETTE_SUBMIT_TIMEOUT_MS` (20 s), which
 * stays under the backend gateway's 30 s for the call itself. Under 5 s is too short for a send that api completes inside the
 * request, so nothing is sent and the page says so: an aborted send would be an unknown outcome, while one never made
 * leaves nothing to recover. The deadline bounds only the send: the re-check's case reads and a token refresh keep
 * their own timeouts, so a pre-send phase that alone outlasts the frontend gateway still ends on its error page,
 * having sent nothing. Plan `docs/plans/completed/20261021-r03b-gazette-send-deadline.md`.
 */
import type { Response } from "express";

const SEND_BUDGET_MS = 25_000;
const MIN_SEND_MS = 5_000;

/**
 * The milliseconds left to wait for the send, or `null` when that is under the floor and nothing must be sent.
 *
 * `res.locals.receivedAt` is set by `recordArrival`, mounted first in `createApp`. Its absence is a wiring fault and
 * throws, because counting from now would hand out the whole budget, the defect this deadline exists to fix.
 */
export function gazetteSendTimeLeft(res: Response): number | null {
  const receivedAt: unknown = res.locals.receivedAt;
  if (typeof receivedAt !== "number") throw new Error("The request's arrival time is not recorded: mount recordArrival first");
  // Whole milliseconds, because `AbortSignal.timeout` throws on a fraction and the monotonic clock carries one.
  const left = Math.floor(SEND_BUDGET_MS - (performance.now() - receivedAt));
  return left < MIN_SEND_MS ? null : left;
}
