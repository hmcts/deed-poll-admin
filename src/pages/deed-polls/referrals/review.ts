/**
 * The queue's selection, checked before it is sent (plan Fa1). The shape is this page's to refuse: nothing ticked, a
 * ticked row with no Master or a value no form offered redraws the queue beside the row. Everything after that is in
 * `../../../referral-queue/review-page.ts`.
 *
 * A `GET` has nothing to check, because the selection only ever arrives posted, so it goes back to the queue: the
 * language link and a reload land here.
 */
import { sendSelectionSchema, zodErrorToFieldErrors } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { REFERRAL_QUEUE_PATH } from "../../../referral-queue/paths.js";
import { renderQueue } from "../../../referral-queue/queue-page.js";
import { renderReview } from "../../../referral-queue/review-page.js";

export const GET = (_req: Request, res: Response) => {
  res.redirect(REFERRAL_QUEUE_PATH);
};

export const POST = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = sendSelectionSchema.safeParse(body);
  if (!parsed.success) return renderQueue(req, res, { status: 400, body, errors: zodErrorToFieldErrors(parsed.error) });

  await renderReview(req, res, body, parsed.data);
};
