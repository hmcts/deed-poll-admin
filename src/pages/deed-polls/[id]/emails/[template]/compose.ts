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
 * **The journey's idempotency key is read here and minted by the check page.** api's notify-6 made
 * `Idempotency-Key` a required header on the send, and a key api enforces is a different thing from the token
 * this journey once carried and nothing compared — see `send.ts`, whose docblock records the difference.
 * `loadEmailJourney` reads whatever key the body carries and mints none, which is what makes a re-render of this
 * form keep the journey it belongs to: `preview.ts` mints one only when the check page renders without one.
 */

import { buildComposeView, type EmailComposeView, type FieldError, findCaseEmails, findDeedPoll, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";

/**
 * The hidden control carrying the journey's idempotency key.
 *
 * camelCase, unlike every control beside it: the others are GOV.UK Notify placeholder names and must stay
 * `snake_case`, so a name in this repo's own convention cannot collide with a slot api publishes.
 */
export const JOURNEY_KEY_FIELD = "idempotencyKey";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  return { found, compose, key: submittedJourneyKey(req) };
}

/** The posted body as the slot values, which is `{}` on a `GET` and therefore api's defaults. */
export function submittedSlots(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

/**
 * The idempotency key the submitted form carried, or `null` when it carried none this app would send.
 *
 * A value that is not a UUID is `null` rather than an error, because this is the *reading* of the key and the
 * two steps want different things from a missing one: the check page mints, and `send.ts` treats it as this app
 * being broken. The field is user input and api parses it as a `UUID`, so an unparseable one must never go on
 * the wire — its 400 names a header no form has a control for.
 */
function submittedJourneyKey(req: Request): string | null {
  const submitted = submittedSlots(req)[JOURNEY_KEY_FIELD];

  return typeof submitted === "string" && UUID_PATTERN.test(submitted) ? submitted : null;
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
    // Carried back out as a hidden control so a form returned to from the check page — a rejected wording, or a
    // send api refused — stays the journey it was. `null` on a form opened from the tab: nothing has minted one
    // yet, and this template is not where that happens.
    journeyKeyField: JOURNEY_KEY_FIELD,
    journeyKey: journey.key,
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
  /** The idempotency key this request arrived with, and `null` when it arrived with none. Never minted here. */
  key: string | null;
}
