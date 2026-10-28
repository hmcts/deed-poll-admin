/**
 * Assign a referral to a Master, or move it to another (plan Db1).
 *
 * **Any caseworker, while the referral is `Open` or `Claimed`.** The link is drawn on those two states only
 * (`assignAction`), and api is still the authority: a referral directed, closed or withdrawn since the page was drawn
 * is api's 409, which redirects to the referral with `?assign=conflict` so the fresh read picks the sentence — the
 * withdraw and close pattern. A `GET` on a referral in any other state goes there too, rather than drawing a form api
 * would refuse.
 *
 * **The cap's 409 names `masterId`, which is the only way it is told from the state's 409**, never api's prose. It
 * redraws the page with api's sentence beside the radios, as the raise form does. An unknown or unavailable Master is
 * api's 400 on the same field.
 *
 * **The current Master is pre-selected and stays selectable when full** (`masterRadioItems`): choosing them again is
 * api's no-op. Reassigning restarts the new Master's processing window, which the page says in days read off api's
 * own `assignedAt` and `directionDueBy` rather than a number restated here.
 *
 * The Masters list degrades as the raise form's does: without it, or with nobody to offer, the page says so and offers
 * no submit. The case and the referral are the page and stay fatal.
 */
import {
  assignReferral,
  assignReferralSchema,
  buildMasterChoices,
  buildReferralDetail,
  ConflictError,
  type FieldError,
  findDeedPoll,
  findMasterChoices,
  findReferral,
  InvalidInputError,
  type ReferralView,
  UnauthorizedError,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { casePath } from "../../../../../case-path.js";
import { forLog } from "../../../../../for-log.js";
import { masterRadioItems } from "../../../../../master-radios.js";
import { pathSegment } from "../../../../../path-segment.js";

/** What the referral page reads back after a refusal for the referral's state, and after a success. */
const ASSIGN_CONFLICT = "conflict";
const ASSIGNED = "1";

const en = {
  title: "Assign this referral to a Master",
  heading: "Assign this referral to a Master",
  reassignTitle: "Assign this referral to another Master",
  reassignHeading: "Assign this referral to another Master",
  currentlyWith: (name: string, assignedOn: string) => `This referral is with ${name}. It was assigned on ${assignedOn}.`,
  // A claim made before assignment existed has a holder and no assignment.
  currentlyWithUnnamed: "This referral is with a Master.",
  restartsWindow: (days: number) => `If you assign it to another Master, they will have ${days} ${days === 1 ? "day" : "days"} from today to give a direction.`,
  restartsWindowUntimed: "If you assign it to another Master, their time to give a direction starts from today.",
  masterLegend: "Which Master should this go to?",
  masterRoom: (held: number, cap: number, when: string) => `${held} of ${cap} ${cap === 1 ? "referral" : "referrals"} for ${when}`,
  masterFull: (when: string) => `Full for ${when}`,
  masterRoomUntimed: (held: number, cap: number) => `${held} of ${cap} ${cap === 1 ? "referral" : "referrals"}`,
  masterFullUntimed: "Full",
  thisMorning: "this morning",
  thisAfternoon: "this afternoon",
  morningOf: (date: string) => `the morning of ${date}`,
  afternoonOf: (date: string) => `the afternoon of ${date}`,
  noMasters: "There are no Masters to assign to. Ask a Delivery Manager to add one.",
  mastersUnavailable: "The list of Masters could not be loaded, so this referral cannot be assigned now. Try again later.",
  submit: "Assign referral",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  // api's rejection naming no control this page has.
  assignRefused: "The referral could not be assigned. Try again."
};

// English content in the cy shape — see the note in ../../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  await render(req, res, undefined, {});
};

export const POST = async (req: Request, res: Response) => {
  // Before the write, so an id that cannot be redirected to is refused rather than assigned and then refused.
  const href = referralHref(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = assignReferralSchema.safeParse({ masterId: body.masterId });

  if (!parsed.success) {
    return rerender(req, res, 400, fieldMessages(zodErrorToFieldErrors(parsed.error)));
  }

  try {
    await assignReferral(req.params.id, req.params.referralId, parsed.data.masterId, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError && error.errors.some((rejection) => rejection.field === "masterId")) {
      // The cap: this Master filled since the page was drawn.
      return rerender(req, res, 409, fieldMessages(error.errors.filter((rejection) => rejection.field === "masterId")));
    }
    if (error instanceof ConflictError) {
      return res.redirect(`${href}?assign=${ASSIGN_CONFLICT}`);
    }
    if (error instanceof InvalidInputError) {
      const placed = error.errors.filter((rejection) => rejection.field === "masterId");
      if (placed.length > 0) return rerender(req, res, 400, fieldMessages(placed));

      console.error(`referral assignment refused with rejections this page cannot place: ${forLog(error.message)}`);
      return rerender(req, res, 400, {}, en.assignRefused);
    }
    throw error;
  }

  res.redirect(`${href}?assigned=${ASSIGNED}`);
};

function fieldMessages(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.map((error) => [error.field, error.message]));
}

async function rerender(req: Request, res: Response, status: number, errors: Record<string, string>, formError?: string) {
  res.status(status);
  // The posted choice, so a refused answer is still the one on screen; anything that is not a string selects nothing.
  const posted = (req.body as Record<string, unknown> | undefined)?.masterId;
  await render(req, res, typeof posted === "string" ? posted : "", errors, formError);
}

async function render(req: Request, res: Response, selectedId: string | undefined, errors: Record<string, string>, formError?: string) {
  const href = referralHref(req);
  const caller = callerFromRequest(req);
  const [caseRead, referralRead, mastersRead] = await Promise.allSettled([
    findDeedPoll(req.params.id, caller),
    findReferral(req.params.id, req.params.referralId, caller),
    findMasterChoices(caller)
  ]);
  if (caseRead.status === "rejected") throw caseRead.reason;
  if (referralRead.status === "rejected") throw referralRead.reason;
  if (mastersRead.status === "rejected") {
    if (mastersRead.reason instanceof UnauthorizedError) throw mastersRead.reason;
    console.error(`masters unavailable: ${forLog(mastersRead.reason instanceof Error ? mastersRead.reason.message : String(mastersRead.reason))}`);
  }

  const referral = referralRead.value;
  const view = buildReferralDetail(referral);
  if (view.assignAction === null) return res.redirect(`${href}?assign=${ASSIGN_CONFLICT}`);

  const content = res.locals.locale === "cy" ? cy : en;
  const currentMasterId = referral.assignedMaster?.id;
  const masters = mastersRead.status === "fulfilled" ? buildMasterChoices(mastersRead.value, selectedId ?? currentMasterId) : null;
  const isReassign = view.assignAction === "reassign";

  res.render("deed-polls/referral-assign", {
    case: caseRead.value,
    referral: view,
    // The heading and the title follow the link the caseworker clicked, resolved here so both stay this page's words.
    title: isReassign ? content.reassignTitle : content.title,
    heading: isReassign ? content.reassignHeading : content.heading,
    currentlyWith: isReassign ? currentlyWith(view, content) : "",
    restartsWindow: isReassign ? restartsWindow(view, content) : "",
    masterItems: masters ? masterRadioItems(masters, content, currentMasterId) : [],
    isMastersUnavailable: masters === null,
    hasNoMasters: masters !== null && masters.choices.length === 0,
    action: `${href}/assign`,
    referralHref: href,
    errors,
    errorList: formError ? [{ text: formError }] : errors.masterId ? [{ text: errors.masterId, href: "#masterId" }] : [],
    en,
    cy
  });
}

function currentlyWith(view: ReferralView, content: typeof en): string {
  return view.assignment?.hasName ? content.currentlyWith(view.assignment.masterName, view.assignment.assignedOn) : content.currentlyWithUnnamed;
}

function restartsWindow(view: ReferralView, content: typeof en): string {
  const days = view.assignment?.processingDays ?? null;

  return days === null ? content.restartsWindowUntimed : content.restartsWindow(days);
}

function referralHref(req: Request): string {
  return `${casePath(req.params.id)}/referrals/${pathSegment(req.params.referralId, "Referral id")}`;
}
