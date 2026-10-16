/**
 * Record what the applicant said when they were asked whether they still want their deed poll enrolled —
 * `notify-3b` decision 5.
 *
 * **One question page and no check-answers step.** The answer and the note are asked together because the note
 * is evidence for that answer rather than a second decision, and a second page would have to hold or retransmit
 * the same free text solely to repeat one radio. What stands in for it is the warning above the submit: the
 * answer cannot be replaced through this service, because api publishes no amend and refuses a second recording.
 *
 * **The GET is a read and offers the form only for a referral api says is waiting.** A referral nobody asked has
 * no answer to record and one already answered cannot take another, so both are redirected to the referral —
 * where the recorded answer is, and where the refusal would have sent them anyway. The same answer
 * `close.ts` gives a referral with no direction waiting.
 *
 * **The POST reads nothing first, and that is not an oversight** (decision 6). api owns the transition and
 * re-checks it; a state read here would be stale by the time it acted on the answer, and two authorities on one
 * transition is how a page comes to refuse something api would have allowed. So the guard is where the form is
 * rendered and the enforcement is where the answer is committed.
 *
 * **Success and the 409 both land on the referral, freshly read** (decision 7). The write's response is the saved
 * referral, so rendering it here would be one call cheaper — and it is deliberately not done: the conflict path
 * has no body to trust, and the two paths must end on the same page for the referral's own words to be able to
 * say which happened. The 409's sentence is chosen there, from api's fresh answer, because its two meanings are
 * distinguishable only by prose this app must not parse.
 *
 * **Nothing here says what to do about the case next.** api moves no case state and no case date when an answer
 * is recorded, and which date a caseworker should set next is an open business question (`notify-3b` flag 1), so
 * inventing "the case is now ready for enrolment" would be this page answering it.
 */
import {
  buildReferralDetail,
  CONFIRMATION_OUTCOME_CHOICES,
  ConflictError,
  type FieldError,
  findDeedPoll,
  findReferral,
  InvalidInputError,
  MAX_CONFIRMATION_NOTE,
  type ReferralConfirmationView,
  recordConfirmation,
  recordConfirmationSchema,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { forLog } from "../../../../../for-log.js";

// The order the controls appear in, so the error summary reads down the page rather than in whatever order the
// issues arrived.
const FIELD_ORDER = ["outcome", "note"];

const en = {
  title: "Record the applicant's response",
  heading: "Record the applicant's response",
  // Which request is being answered, so a caseworker working a worklist row knows they are on the right one.
  requestedLabel: "Confirmation requested",
  outcomeLegend: "What did the applicant say about proceeding?",
  // Says where the answer comes from: a monitored mailbox, transcribed here. This service neither reads nor
  // parses the reply (decision 9).
  outcomeHint: "Record what the applicant told you in reply to the email asking whether they still want their deed poll enrolled.",
  noteLabel: "Note (optional)",
  // api trims the note and treats whitespace-only as none, and writes it into the case notes with the answer —
  // so the hint says where it will be read rather than leaving that to be discovered.
  noteHint: "Add anything that evidences the response, for example how and when the applicant replied. This is saved with the response as a case note.",
  // Decision 5's warning. It says what is true of this service — api publishes no amend and refuses a second
  // answer — and claims nothing about what happens to the case, which is still an open business question.
  warning: "You cannot change or replace this response in this service once it is recorded.",
  // GOV.UK's own fallback for the warning icon, which is decorative and needs a text equivalent.
  warningIcon: "Warning",
  submit: "Record response",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  // A 400 from api naming no control this form renders. api's own text is written for whoever reads its logs, so
  // this stands in for it — the same split every form in this app makes.
  confirmationRefused: "The response could not be recorded. Check your answer and try again.",
  noteMax: MAX_CONFIRMATION_NOTE
};

// English content in the cy shape — see the note in ../../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const page = await awaiting(req, res);
  if (!page) return;

  render(res, page, {}, {});
};

export const POST = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = recordConfirmationSchema.safeParse(submitted(body));

  if (!parsed.success) {
    // The schema's own messages, as `../../referrals/new.ts` renders them: the cap on the note belongs beside the
    // rule that enforces it, and both ends publish the same 1,000.
    return rerender(req, res, 400, body, fieldMessages(zodErrorToFieldErrors(parsed.error)));
  }

  try {
    // `outcome` and an optional `note`, and no recorder: api stamps who recorded it and when from the token and
    // its own clock, so a body that named either would be asserting an identity api never verified.
    await recordConfirmation(req.params.id, req.params.referralId, parsed.data, callerFromRequest(req));
  } catch (error) {
    // Another caseworker recorded the answer first, or nobody asked the applicant at all. api's two 409s read
    // differently and are not parsed here — the referral page picks its sentence from the fresh read.
    if (error instanceof ConflictError) {
      return res.redirect(`${referralHref(req)}?confirmation=conflict`);
    }
    if (error instanceof InvalidInputError) return apiRefused(req, res, error);
    throw error;
  }

  res.redirect(`${referralHref(req)}?confirmation=recorded`);
};

/**
 * The referral this form is answering for, or nothing — having already redirected.
 *
 * Both reads are load-bearing and neither degrades: the reference names the application the answer is being
 * recorded against, and the confirmation is what decides whether there is anything to record. A referral not
 * waiting for an answer goes back to its own page rather than being shown a form whose only submit api answers
 * 409 to.
 *
 * A referral belonging to another case, or none at all, is api's 404 and is deliberately not caught: `findReferral`
 * puts both ids in the path, so scoping is answered by the read rather than by a check here.
 */
async function awaiting(req: Request, res: Response): Promise<ConfirmationPage | undefined> {
  const caller = callerFromRequest(req);
  const [found, referral] = await Promise.all([findDeedPoll(req.params.id, caller), findReferral(req.params.id, req.params.referralId, caller)]);

  const confirmation = buildReferralDetail(referral).confirmation;

  // Null for a referral never asked, and `awaiting` false for one already answered — the two states api refuses,
  // and neither is a form.
  if (!confirmation?.awaiting) {
    res.redirect(referralHref(req));
    return undefined;
  }

  // api allocates the reference, so an empty one is a case it has not published one for rather than a fault. The
  // template renders no caption then instead of an empty one, as `judicial/referrals/direction-form.njk` does.
  return { reference: found.displayReference ?? "", confirmation, referralHref: referralHref(req) };
}

/** api's 400: its own words where they name a control this form renders, this page's where they do not. */
function apiRefused(req: Request, res: Response, error: InvalidInputError) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const messages = fieldMessages(error.errors);
  const placed = Object.keys(messages).filter((field) => FIELD_ORDER.includes(field));
  const unplaceable = Object.keys(messages).filter((field) => !FIELD_ORDER.includes(field));

  if (unplaceable.length > 0 || placed.length === 0) {
    // The rejection, not the note: the caseworker's text is the one thing on this form that could carry an
    // applicant's words, and a log is read by whoever is asked why rather than by them.
    console.error(`confirmation refused with rejections this form cannot place (${unplaceable.join(", ") || "no field named"}): ${forLog(error.message)}`);
    return rerender(req, res, 400, body, Object.fromEntries(placed.map((field) => [field, messages[field]])), content(res).confirmationRefused);
  }

  return rerender(req, res, 400, body, messages);
}

/** The words for this request's language. Needed only for the one string this handler resolves itself. */
function content(res: Response): typeof en {
  return res.locals.locale === "cy" ? cy : en;
}

/**
 * The submitted body as the schema's shape.
 *
 * The two controls and nothing else, so a post carrying `confirmationRecordedBy` or `confirmationReceivedAt`
 * cannot reach api — which accepts unknown properties and ignores them, so nothing would fail if it did. The
 * identity is the token's.
 */
function submitted(body: Record<string, unknown>): Record<string, unknown> {
  return { outcome: body.outcome, note: body.note };
}

/** Rejections keyed by the control they belong against, as the other forms in this app key them. */
function fieldMessages(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.map((error) => [error.field.split(/[.[]/)[0], error.message]));
}

/**
 * The form again, with what was entered and what is wrong with it.
 *
 * Re-renders rather than redirecting with `?error=`, as every form in this app does: the note takes up to 1,000
 * characters and losing them to an unticked radio would be the expensive failure. The referral is re-read for the
 * caption and the request date, which is also the guard — a referral answered between the submit and this render
 * lands on its own page rather than on a form it can no longer use.
 */
async function rerender(req: Request, res: Response, status: number, values: Record<string, unknown>, errors: Record<string, string>, formError?: string) {
  const page = await awaiting(req, res);
  if (!page) return;

  res.status(status);
  render(res, page, values, errors, formError);
}

function render(res: Response, page: ConfirmationPage, values: Record<string, unknown>, errors: Record<string, string>, formError?: string) {
  res.render("deed-polls/referral-confirmation", {
    reference: page.reference,
    requestedOn: page.confirmation.requestedOn,
    // The values are api's enum members and go on the wire unchanged; the wording is the domain's, shared with
    // the answer the referral page reads back, so a caseworker cannot be shown two sentences for one answer.
    // Checked state is worked out here rather than in the template, so it is computed once in something testable.
    outcomeItems: CONFIRMATION_OUTCOME_CHOICES.map((choice) => ({ ...choice, checked: values.outcome === choice.value })),
    values,
    errors,
    errorList: summaryList(errors, formError),
    // The form posts to itself, and both hrefs are stated by the handler rather than assembled from fragments in
    // the template.
    confirmationHref: `${page.referralHref}/confirmation`,
    referralHref: page.referralHref,
    en,
    cy
  });
}

/**
 * Error-summary rows, ordered by the controls rather than by whatever order the errors arrived in.
 *
 * The form-level row carries no `href`, as `../../referrals/new.ts` explains: it stands in for a rejection that
 * names no control here, so there is nothing to send focus to.
 */
function summaryList(errors: Record<string, string>, formError?: string): { text: string; href?: string }[] {
  const rows = FIELD_ORDER.filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` }));

  return formError ? [{ text: formError }, ...rows] : rows;
}

function referralHref(req: Request): string {
  return `/deed-polls/${req.params.id}/referrals/${encodeURIComponent(req.params.referralId)}`;
}

/** What the form needs about the referral it is answering for: the caption, the request, and where back is. */
interface ConfirmationPage {
  reference: string;
  confirmation: ReferralConfirmationView;
  referralHref: string;
}
