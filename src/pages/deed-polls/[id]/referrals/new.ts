/**
 * Raise-a-referral form — the caseworker's half of sending a case to the judiciary.
 *
 * Static, so it resolves before `[referralId].ts`: `sortRoutes` orders by parameter count and this has one
 * fewer. The same ordering `witnesses/new.ts` relies on.
 *
 * **No permission check, deliberately.** api decides who may raise a referral from the token, and it is the
 * only end that can — `requireAuth` is global, so a signed-in caseworker reaches this page and a forged POST
 * from anyone else is api's 403.
 *
 * **The messages come from the schema, not from this page**, which is the opposite of `../witnesses/new.ts`
 * and for a stated reason: `createReferralSchema` has two things to say about `notes` — required because
 * `Other` was ticked, and too long — and a page that maps one message per field cannot say both. So
 * `zodErrorToFieldErrors` output is rendered as it arrives. What *is* this page's is the wording of the
 * choices: api's enum members go on the wire, `REFERRAL_REASON_CHOICES` is what a caseworker reads.
 *
 * **The 409 is a state this page renders, not a fault.** api answers 409 when the case already has a referral
 * that is not terminal, because a case holds at most one. That is an ordinary thing for two caseworkers to
 * discover, so it is an error summary with a link to the referral already open rather than the 500 page —
 * `ConflictError` reaching `domainErrorHandler` from here would be a bug in this handler. Resolving *which*
 * referral to link to costs a second read, which is why it only happens on that path.
 *
 * **Validation re-renders rather than redirecting with `?error=`**, as every form in this app does: the notes
 * field takes up to 1,000 characters and losing them to a missed checkbox would be the expensive failure.
 */
import {
  buildReferralsView,
  ConflictError,
  createReferral,
  createReferralSchema,
  type FieldError,
  findDeedPoll,
  findReferrals,
  InvalidInputError,
  MAX_REFERRAL_NOTES,
  MAX_REFERRAL_URGENCY_REASON,
  REFERRAL_REASON_CHOICES,
  REFERRAL_URGENCY_CHOICES,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { forLog } from "../../../../for-log.js";

// The order the controls appear in, so the error summary reads down the page rather than in whatever order
// the issues arrived.
const FIELD_ORDER = ["reasons", "notes", "urgency", "urgencyReason"];

const en = {
  title: "Refer this case to the judiciary",
  heading: "Refer this case to the judiciary",
  reasonsLegend: "Why are you referring this case?",
  reasonsHint: "Select all that apply.",
  notesLabel: "Give the other reason",
  notesHint: "Explain why this case needs to go to the judiciary.",
  urgencyLegend: "How urgent is this referral?",
  urgencyReasonLabel: "Why is this referral urgent?",
  urgencyReasonHint: "For example, a hearing date or a deadline the judiciary needs to know about.",
  submit: "Raise referral",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  // Decision 6: an expected 409, in the caseworker's terms. The link is added by the template, because the
  // referral it points at is data.
  alreadyOpen: "This case already has an open referral.",
  viewOpenReferral: "View the open referral",
  // api's rejections carry their own wording; this is for one that names no field, whose text is written for
  // whoever reads api's logs.
  referralRefused: "The referral could not be raised. Check the details and try again.",
  notesMax: MAX_REFERRAL_NOTES,
  urgencyReasonMax: MAX_REFERRAL_URGENCY_REASON
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  await render(req, res, {}, {});
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createReferralSchema.safeParse(submitted(req));

  if (!parsed.success) {
    return rerender(req, res, 400, fieldMessages(zodErrorToFieldErrors(parsed.error)));
  }

  try {
    // Every field the form produced and nothing else: the state of a new referral is always api's, and so is
    // the author it stamps from the token.
    await createReferral(req.params.id, parsed.data, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError) {
      return rerender(req, res, 409, {}, undefined, await openReferralHref(req));
    }
    if (error instanceof InvalidInputError) {
      // api's field names are the wire names, which are this form's control names, so they land in place —
      // but only the four this form has a control for (a `reasons` member included, see `fieldMessages`).
      // Anything else (no field at all, or one this form does not render) has nowhere to land, so it is
      // logged and the page's own copy stands in for it. Per rejection, not per response: a 400 naming both
      // `notes` and a field with no control would otherwise show the notes message and drop the other, and
      // the caseworker would fix what they were shown and be refused again for the half they were not.
      const messages = fieldMessages(error.errors);
      const placed = Object.keys(messages).filter((field) => FIELD_ORDER.includes(field));
      const unplaceable = Object.keys(messages).filter((field) => !FIELD_ORDER.includes(field));

      if (unplaceable.length > 0 || placed.length === 0) {
        console.error(
          `referral create refused with rejections this form cannot place (${unplaceable.join(", ") || "no field named"}): ${forLog(error.message)}`
        );
        return rerender(req, res, 400, Object.fromEntries(placed.map((field) => [field, messages[field]])), en.referralRefused);
      }

      return rerender(req, res, 400, messages);
    }
    throw error;
  }

  res.redirect(`/deed-polls/${req.params.id}#referrals`);
};

/**
 * The submitted body as the schema's shape.
 *
 * `reasons` is normalised to an array because a checkbox group posts a bare string when exactly one box is
 * ticked and nothing at all when none is — so the untouched group becomes `[]` and fails `min(1)` with the
 * message written for it, rather than failing the type check with a different one.
 *
 * **A revealed field that is not revealed was not answered.** GOV.UK's conditional reveal only *hides* its
 * input — the textarea stays in the form and the browser posts whatever is in it — so a caseworker who types
 * a reason for urgency, then changes their mind and picks Standard, posts `urgency=Normal` with the reason
 * still attached. api stores what it is sent, and decision 10 leaves no edit page to correct it with, so a
 * referral would read "Standard / because there is a hearing on Friday" for the rest of its life. Dropping it
 * here is the form's own knowledge — which question it actually asked — and not a domain rule, which is why
 * it is not in `createReferralSchema`. The value is still put back on a re-render (see `submittedValues`), so
 * re-ticking the box brings the text back rather than making it be typed twice.
 */
function submitted(req: Request): Record<string, unknown> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const reasons = reasonsFrom(body.reasons);

  return {
    reasons,
    notes: reasons.includes("Other") ? body.notes : undefined,
    urgency: body.urgency,
    urgencyReason: body.urgency === "Urgent" ? body.urgencyReason : undefined
  };
}

function reasonsFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];

  return [];
}

/**
 * Rejections keyed by the control they belong against.
 *
 * The path up to its first index or property separator, so an issue about one member of `reasons` lands on
 * the checkbox group — there is no control for a member, and an error addressed to the member itself would
 * leave the summary link pointing at nothing. **Both spellings of a member, because the two ends spell it
 * differently:** zod dots it (`reasons.0`) and Spring brackets it (`reasons[0]`), and an api rejection of a
 * reason is about the group the caseworker can actually change.
 */
function fieldMessages(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.map((error) => [error.field.split(/[.[]/)[0], error.message]));
}

/**
 * Where to send someone who has just learned the case is already with the judiciary.
 *
 * A second read, on the conflict path only: api's 409 says that a referral is live, not which one, and "view
 * it" needs an id. A case whose live referral has been withdrawn between the two calls falls back to the
 * case's referrals tab rather than linking to nothing — `liveReferral` is the view model's answer to "which
 * one", and api remains the authority on the transition itself.
 *
 * **A failed read falls back rather than throwing.** This runs inside the handler's `catch`, so letting it
 * reject would turn a 409 this page knows how to render into the 500 page and take up to 1,000 typed
 * characters with it — the expensive failure the re-render exists to prevent. The tab link is worse than a
 * direct one and better than an error page.
 */
async function openReferralHref(req: Request): Promise<string> {
  const referralsTab = `/deed-polls/${req.params.id}#referrals`;

  try {
    const referrals = await findReferrals(req.params.id, callerFromRequest(req));
    const live = buildReferralsView(referrals).liveReferral;

    return live ? `/deed-polls/${req.params.id}/referrals/${live.id}` : referralsTab;
  } catch (error) {
    console.error(`could not resolve the open referral to link to: ${forLog(error instanceof Error ? error.message : String(error))}`);
    return referralsTab;
  }
}

async function rerender(req: Request, res: Response, status: number, errors: Record<string, string>, formError?: string, conflictHref?: string) {
  res.status(status);
  // The submitted values, not blanks: the point of re-rendering is that what was chosen and typed is still
  // there to be corrected.
  await render(req, res, submittedValues(req), errors, formError, conflictHref);
}

/**
 * The body as the controls want it back — `reasons` an array, so the boxes can be re-checked.
 *
 * Deliberately not `submitted(req)`: that drops a value whose reveal is closed because it is not an answer,
 * and this keeps it because it is still typing. A caseworker who re-ticks Other finds their text where they
 * left it.
 */
function submittedValues(req: Request): Record<string, unknown> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  return { ...body, reasons: reasonsFrom(body.reasons) };
}

async function render(req: Request, res: Response, values: Record<string, unknown>, errors: Record<string, string>, formError?: string, conflictHref?: string) {
  const found = await findDeedPoll(req.params.id, callerFromRequest(req));
  const chosen = Array.isArray(values.reasons) ? values.reasons : [];

  res.render("deed-polls/referral-form", {
    case: found,
    values,
    // Built here rather than in the template so the checked state is computed once, in something testable.
    // The labels are this repo's; the values are api's enum members and go on the wire unchanged.
    reasonItems: REFERRAL_REASON_CHOICES.map((choice) => ({ ...choice, checked: chosen.includes(choice.value) })),
    urgencyItems: REFERRAL_URGENCY_CHOICES.map((choice) => ({ ...choice, checked: values.urgency === choice.value })),
    errors,
    errorList: summaryList(errors, formError),
    conflictHref,
    en,
    cy
  });
}

/**
 * Error-summary rows, ordered by the controls rather than by whatever order the errors arrived in.
 *
 * **The form-level row carries no `href`, for the same reason the conflict row in `referral-form.njk` does
 * not.** It stands in for a rejection that named no control this page renders, so there is no control to send
 * anyone to — linking it at a guess would move focus to a checkbox group that may be perfectly valid, which is
 * worse for a keyboard or screen-reader user than a row that simply reads. Field rows stay linked.
 */
function summaryList(errors: Record<string, string>, formError?: string): { text: string; href?: string }[] {
  const rows = FIELD_ORDER.filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` }));

  return formError ? [{ text: formError }, ...rows] : rows;
}
