/**
 * Step one of the send-an-email journey: the slots a caseworker fills, pre-populated from the case.
 *
 * **This file owns the journey's shared parts**, because the other two steps re-render this form. `preview.ts`
 * renders it when the wording fails validation and `send.ts` renders it when api refuses the content, and both
 * must show *this* page's copy — a second set of labels for the same controls would be a second thing for a
 * translator to keep in step, and `yarn welsh:check` reads `en`/`cy` per file rather than per page. So
 * `loadEmailJourney`, `renderCompose` and the copy live here and the later steps import them; nothing imports the
 * other way, so there is no cycle.
 *
 * **The template is a route parameter, and an unsendable one is a 404.** `buildComposeView` answers `null` for an
 * unknown key, for a template api says is not applicable to this case and for one this environment has not
 * provisioned, and all three are the same 404 here: distinguishing them would tell somebody probing which keys
 * exist, and a caseworker never reaches this page except from a button the tab built out of the same payload.
 *
 * **One read, and it is the tab's.** api answers availability, history and the slot defaults in one response
 * (decision 8 of `docs/plans/notify-2-caseworker-email-tab.md`), so the form opens with the judge's own words in
 * it without spending one of Notify's rate-limited preview calls to discover them — decision 9. `findDeedPoll` is
 * the second call and is the case reference in the caption, as on the per-email page.
 *
 * **Both calls are load-bearing here**, unlike on the case detail page: this page *is* the email, so a failed
 * read has nothing to render and its error goes to the page.
 *
 * **`POST` is how the check page comes back**, not a second submission: it re-renders the form from the posted
 * body, so the caseworker's own text survives the return. A link could not carry it.
 *
 * **There is no idempotency token here, and its removal is the point rather than an omission.** One was built to
 * decision 16 of the plan — minted on `GET`, carried through the check page in a hidden control, re-validated on
 * the way back — and **compared against nothing**, so it protected against nothing while reading like a guard to
 * anyone who found it. What actually stops a double-click sending twice is api's partial unique index on
 * `("referralId", "template")`, which answers a redundant send as a 200 with `enqueued: false`. See `send.ts` for
 * the case that is not covered and what would have to be built if it ever arrives.
 */

import { buildComposeView, type EmailComposeView, type FieldError, findCaseEmails, findDeedPoll, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";

export const en = {
  title: "Write the email",
  heading: "Write the email",
  templateLabel: "Email",
  intro: "The applicant will receive this as an email from GOV.UK Notify. You will be able to check the wording before it is sent.",
  // Said once on the form rather than as a hint per control, because which slots are pre-populated is api's
  // answer and changes with the template: `slotDefaults` fills the judge's reason from their direction and
  // leaves the rest empty.
  prePopulatedHint: "Anything already filled in comes from the case and the Master's direction. Change it if the applicant needs to read something different.",
  optional: "(optional)",
  submit: "Continue",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  // For a rejection api addressed to something this form has no control for, whose own wording is written for
  // whoever reads api's logs rather than for a caseworker — the same split `../../notes/new.ts` makes.
  contentRefused: "The email could not be prepared. Check the wording and try again."
};

// English content in the cy shape — see the note in ../../../../index.ts.
export const cy = { ...en };

/** The form, opened from the tab, with api's defaults in the slots. */
export const GET = async (req: Request, res: Response) => {
  renderCompose(res, await loadEmailJourney(req));
};

/**
 * The same form, returned to from the check page.
 *
 * Identical to the `GET` because `loadEmailJourney` reads the values out of the body when there is one: what
 * makes this a different route is the method, not the rendering. It is a `POST` rather than a link precisely so
 * the caseworker's typing comes back with them.
 */
export const POST = GET;

/**
 * The case and the compose form for the template in the path.
 *
 * Shared by all three steps so the 404 rule is decided once. The submitted body is what the form is built from,
 * which is what makes a failed validation keep the caseworker's own words rather than reverting to api's
 * defaults — `buildComposeView` prefers a submitted slot untrimmed and falls back to `slotDefaults`.
 */
export async function loadEmailJourney(req: Request): Promise<EmailJourney> {
  const caller = callerFromRequest(req);
  // Together, because neither answer depends on the other, and `all` rather than `allSettled`: both are the page.
  const [found, emails] = await Promise.all([findDeedPoll(req.params.id, caller), findCaseEmails(req.params.id, caller)]);

  const compose = buildComposeView(emails, req.params.template, submittedSlots(req));
  // Unknown, not applicable, not provisioned — one answer for all three. The template is user input in a path.
  if (!compose) throw new NotFoundError(`Email ${req.params.template} cannot be sent for case ${req.params.id}`);

  return { found, compose };
}

/** The posted body as the slot values, which is `{}` on a `GET` and therefore api's defaults. */
export function submittedSlots(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

/**
 * Render the form, with any rejections against the controls they belong to.
 *
 * `errors` are the slot rejections, local or api's; `formError` leads the summary and carries no `href`, for the
 * reason `../../referrals/new.ts` gives — it stands in for a rejection that named no control on this page, so
 * there is nothing to send focus to.
 */
export function renderCompose(res: Response, journey: EmailJourney, errors: FieldError[] = [], formError?: string): void {
  const messages = fieldMessages(journey.compose, errors);

  res.render("deed-polls/email-compose", {
    case: journey.found,
    compose: journey.compose,
    errors: messages,
    // Ordered by the controls rather than by whatever order the rejections arrived in, so the summary reads
    // down the page.
    errorList: [
      ...(formError ? [{ text: formError }] : []),
      ...journey.compose.fields.filter((field) => messages[field.name]).map((field) => ({ text: messages[field.name], href: `#${field.name}` }))
    ],
    en,
    cy
  });
}

/** Whether this form has a control a given rejection can be shown against. */
export function hasControl(compose: EmailComposeView, field: string): boolean {
  return compose.fields.some((candidate) => candidate.name === field);
}

/** Rejections keyed by the control they belong against, keeping only the ones this form renders. */
function fieldMessages(compose: EmailComposeView, errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.filter((error) => hasControl(compose, error.field)).map((error) => [error.field, error.message]));
}

/** The case and the form — everything all three steps of the journey share. */
export interface EmailJourney {
  found: Awaited<ReturnType<typeof findDeedPoll>>;
  compose: EmailComposeView;
}
