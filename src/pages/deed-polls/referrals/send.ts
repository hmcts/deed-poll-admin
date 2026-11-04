/**
 * Send the reviewed selection (plan Fa1, api F1), all or nothing.
 *
 * **Where a refusal is drawn follows what it is about.** api names a refused row by its index in the selection: a
 * referral no longer waiting (409 on `allocations[i].referralId`) or a Master no longer available (400 on
 * `allocations[i].masterId`). Both go back to the queue, the only page with a control to change them, the Master's
 * beside its row in api's words. A 409 naming no field is the window or the cap, which the check page redraws with
 * api's own sentence, from a fresh read, so the page's totals and its Send button follow api's answer.
 *
 * **A lost response is recovered by pressing Send again**: api skips a referral already sent to the same Master in the
 * same window, so the same body is a 200 that changes nothing. Nothing here mints a key or says anything about it.
 */
import { ConflictError, type FieldError, InvalidInputError, sendReferrals, sendSelectionSchema, summariseSend, zodErrorToFieldErrors } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";
import { forLog } from "../../../for-log.js";
import { REFERRAL_QUEUE_PATH } from "../../../referral-queue/paths.js";
import { queueContentCy, queueContentEn, renderQueue, SENT_MASTERS_PARAM, SENT_PARAM } from "../../../referral-queue/queue-page.js";
import { renderReview, reviewContentCy, reviewContentEn } from "../../../referral-queue/review-page.js";

const ALLOCATION_FIELD = /^allocations\[(\d+)\]\.(referralId|masterId)$/;

export const GET = (_req: Request, res: Response) => {
  res.redirect(REFERRAL_QUEUE_PATH);
};

export const POST = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = sendSelectionSchema.safeParse(body);
  if (!parsed.success) return renderQueue(req, res, { status: 400, body, errors: zodErrorToFieldErrors(parsed.error) });

  const selection = parsed.data;
  const isWelsh = res.locals.locale === "cy";

  try {
    const sent = summariseSend(await sendReferrals(selection, callerFromRequest(req)));
    return res.redirect(303, `${REFERRAL_QUEUE_PATH}?${SENT_PARAM}=${sent.referrals}&${SENT_MASTERS_PARAM}=${sent.masters}`);
  } catch (error) {
    if (!(error instanceof ConflictError || error instanceof InvalidInputError)) throw error;

    const rows = rowRefusals(error.errors, selection.allocations);
    if (error instanceof ConflictError && rows.some((row) => row.kind === "referralId")) {
      return renderQueue(req, res, { status: 409, body, errors: [], message: (isWelsh ? queueContentCy : queueContentEn).noLongerWaiting });
    }
    const masters = rows.filter((row) => row.kind === "masterId");
    if (error instanceof InvalidInputError && masters.length > 0) {
      return renderQueue(req, res, { status: 400, body, errors: masters.map((row) => ({ field: `master-${row.referralId}`, message: row.message })) });
    }
    if (error instanceof ConflictError) return renderReview(req, res, body, selection, { status: 409, message: error.message });

    console.error(`referral send refused with rejections this page cannot place: ${forLog(error.message)}`);
    return renderReview(req, res, body, selection, { status: 400, message: (isWelsh ? reviewContentCy : reviewContentEn).sendRefused });
  }
};

/** api's per-entry errors, read back onto the selection's referrals by their index. */
function rowRefusals(errors: FieldError[], allocations: { referralId: string }[]) {
  return errors.flatMap((error) => {
    const match = ALLOCATION_FIELD.exec(error.field);
    const allocation = match ? allocations[Number(match[1])] : undefined;
    return match && allocation ? [{ kind: match[2], referralId: allocation.referralId, message: error.message }] : [];
  });
}
