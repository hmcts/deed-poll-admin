/**
 * Reassign a referral already with a Master (plan Fa1, api F1), from the queue's With a Master tab. Any time, inside a
 * referral window or not: a reassignment takes no place in a window and checks no cap.
 *
 * The case id arrives as `?case=` from the queue row, as the check view's does, and the form posts back to the same
 * address. Both paths are built before any read or write, so an unusable id is refused with nothing sent.
 *
 * **Two reads, both load-bearing**: the referral (who has it, since when, when their direction is due) and the queue's
 * envelope, whose `masters` are the available Masters the radios offer. A referral that is not `Claimed` goes back to
 * the queue with the conflict sentence rather than drawing a form api would refuse.
 *
 * **api's 409 means the referral is not with a Master waiting for a direction** (`Open`, or directed, closed or
 * withdrawn since), told apart only by prose, so both redirect to the queue with one state sentence. Choosing the Master
 * it already has is api's no-op 200, which reads as a success. An unknown or unavailable Master is api's 400 on
 * `masterId`, drawn beside the radios.
 */
import {
  assignReferral,
  buildQueueWindowView,
  buildReferralDetail,
  ConflictError,
  findReferral,
  findReferralQueue,
  InvalidInputError,
  NotFoundError,
  type ReferralView
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { z } from "zod";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { forLog } from "../../../../for-log.js";
import { queueReassignPath, queueReferralPath, REFERRAL_QUEUE_PATH } from "../../../../referral-queue/paths.js";
import { REASSIGN_CONFLICT, REASSIGN_CONFLICT_PARAM, REASSIGNED_PARAM } from "../../../../referral-queue/queue-page.js";

const WITH_A_MASTER = "#with-a-master";

const en = {
  title: "Reassign this referral",
  heading: "Reassign this referral",
  back: "Back to referrals",
  checkReferral: "Check the referral",
  currentlyWithFor: (name: string, sentOn: string) => `This referral is with ${name}. It was sent to them on ${sentOn}.`,
  currentlyWithUnnamed: "This referral is with a Master.",
  // Not a number of days: the new Master's time is api's, read off directionDueBy, and the window may have changed.
  restartsWindow: "If you reassign it to another Master, their time to give a direction starts again from today.",
  emailed: "The Master you choose will be sent an email to tell them.",
  noPlaceInWindow: "Reassigning does not use a place in a referral window.",
  masterLegend: "Which Master should this go to?",
  noMasters: "There are no available Masters to reassign this referral to.",
  submit: "Reassign referral",
  errorSummaryTitle: "There is a problem",
  chooseMaster: "Select a Master",
  // api's rejection naming no control this page has.
  reassignRefused: "The referral could not be reassigned. Try again."
};

// The page's Welsh is pending, as the queue's is.
const cy = { ...en };

const reassignSchema = z.object({ masterId: z.string({ error: en.chooseMaster }).trim().min(1, en.chooseMaster) });

export const GET = async (req: Request, res: Response) => {
  await render(req, res, { status: 200, errors: {} });
};

export const POST = async (req: Request, res: Response) => {
  // Before the write, so an id that cannot be redirected to is refused rather than reassigned and then refused.
  const { caseId } = paths(req);
  const content = res.locals.locale === "cy" ? cy : en;
  const parsed = reassignSchema.safeParse({ masterId: (req.body as Record<string, unknown> | undefined)?.masterId });
  if (!parsed.success) return render(req, res, { status: 400, errors: { masterId: content.chooseMaster } });

  try {
    await assignReferral(caseId, req.params.referralId, parsed.data.masterId, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError) return res.redirect(303, `${REFERRAL_QUEUE_PATH}?${REASSIGN_CONFLICT_PARAM}=${REASSIGN_CONFLICT}${WITH_A_MASTER}`);
    if (error instanceof InvalidInputError) {
      const placed = error.errors.find((rejection) => rejection.field === "masterId");
      if (placed) return render(req, res, { status: 400, errors: { masterId: placed.message }, selected: parsed.data.masterId });

      console.error(`referral reassignment refused with rejections this page cannot place: ${forLog(error.message)}`);
      return render(req, res, { status: 400, errors: {}, selected: parsed.data.masterId, formError: content.reassignRefused });
    }
    throw error;
  }

  res.redirect(303, `${REFERRAL_QUEUE_PATH}?${REASSIGNED_PARAM}=1${WITH_A_MASTER}`);
};

/** The case from `?case=` and the page's own address, or the 404 a mistyped URL is. */
function paths(req: Request): { caseId: string; action: string; checkHref: string } {
  const caseId = typeof req.query.case === "string" ? req.query.case : "";
  if (caseId === "") throw new NotFoundError("Referral reassignment has no case");

  return { caseId, action: queueReassignPath(req.params.referralId, caseId), checkHref: queueReferralPath(req.params.referralId, caseId) };
}

async function render(req: Request, res: Response, state: RenderState) {
  const { caseId, action, checkHref } = paths(req);
  const caller = callerFromRequest(req);
  const [referral, queue] = await Promise.all([findReferral(caseId, req.params.referralId, caller), findReferralQueue({ state: "Claimed" }, caller)]);
  if (referral.state !== "Claimed") return res.redirect(`${REFERRAL_QUEUE_PATH}?${REASSIGN_CONFLICT_PARAM}=${REASSIGN_CONFLICT}${WITH_A_MASTER}`);

  const content = res.locals.locale === "cy" ? cy : en;
  const view = buildReferralDetail(referral);
  const selected = state.selected ?? referral.assignedMaster?.id;
  const masters = buildQueueWindowView(queue.window, new Date())?.masters ?? [];

  res.status(state.status);
  res.render("deed-polls/referrals/[referralId]/reassign", {
    en,
    cy,
    backHref: `${REFERRAL_QUEUE_PATH}${WITH_A_MASTER}`,
    checkHref,
    action,
    currentlyWith: currentlyWith(view, content),
    masterItems: masters.map((master) => ({ value: master.id, text: master.name, checked: master.id === selected })),
    errors: state.errors,
    errorList: state.formError ? [{ text: state.formError }] : state.errors.masterId ? [{ text: state.errors.masterId, href: "#masterId" }] : []
  });
}

function currentlyWith(view: ReferralView, content: typeof en): string {
  return view.assignment?.hasName ? content.currentlyWithFor(view.assignment.masterName, view.assignment.assignedOn) : content.currentlyWithUnnamed;
}

interface RenderState {
  status: number;
  errors: Record<string, string>;
  /** The posted choice, so a refused answer is still the one on screen. */
  selected?: string;
  formError?: string;
}
