/**
 * The referral queue (plan Fa1). Gated once in `app.ts` on `ALLOCATE_REFERRALS`; this page never asks about the
 * caller. The page is drawn by `../../../referral-queue/queue-page.ts`, which the review and the send also redraw.
 */
import type { Request, Response } from "express";
import { renderQueue } from "../../../referral-queue/queue-page.js";

export const GET = async (req: Request, res: Response) => {
  await renderQueue(req, res);
};
