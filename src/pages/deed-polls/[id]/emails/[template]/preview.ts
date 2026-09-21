/**
 * Step two: the real email, as GOV.UK Notify renders it, with Send and a way back.
 *
 * **This is the check-your-answers page of the journey and it is mandatory, because sending is irreversible.** An
 * applicant cannot be un-told that their application was refused, which is why decision 2 of
 * `docs/plans/notify-2-caseworker-email-tab.md` puts a step between the form and the send at all, and why
 * `canSend` is false whenever there is no rendering to have checked.
 *
 * **The HTML renders inside a sandboxed `iframe` with `srcdoc` and is never interpolated into the page** —
 * decision 3, and `../../../email-preview.njk.test.ts` asserts the attribute so a later tidy-up fails a test
 * rather than shipping. It comes from Notify by way of api and contains text a caseworker typed, so showing it in
 * the page would mean `| safe` on a string that has been through two services and a human. The sandbox also keeps
 * the email's own styles out of the admin page.
 *
 * **The preview is unbranded, and decision 3's "looks more like what the applicant will read" overstated it.**
 * A `srcdoc` document inherits the embedder's Content-Security-Policy, and `configureHelmet()` sends
 * `img-src 'self' data:` (plus the analytics hosts) — so a remote image in Notify's HTML, which is how its crest
 * and branding arrive, is refused. Only a console message says so. **`sandbox=""` compounds it**: with no
 * `allow-same-origin` the frame has an opaque origin, and `'self'` can never match an opaque origin, so even a
 * same-origin image would be blocked. `data:` URIs would still render.
 *
 * **Nothing in the suite can catch this**, which is worth knowing before trusting a green run here: the in-memory
 * mock's rendered HTML contains no images at all, the template test only renders, and the e2e only asserts the
 * `sandbox` and `srcdoc` attributes. It was found by reading the policy, not by a failure.
 *
 * **Left as it is, deliberately, and the caption was corrected instead.** What this page exists to do is get a
 * caseworker to approve *wording* before an irreversible send, and the wording is exact — so the honest fix was to
 * stop the caption claiming appearance fidelity it does not have. Restoring the branding would mean allowing
 * Notify's static-image host in `img-src`, and **the directive lives in `libs/express-govuk-starter`, which is
 * template-provided**: an edit there is lost at the next re-scaffold with nothing failing, exactly as the
 * app-owned layouts in `src/pages/layouts/` exist to avoid. So it would need an app-owned override, widening the
 * policy on every page of a caseworker application for a cosmetic gain. That is a trade for the business to make
 * rather than a bug to fix quietly.
 *
 * **A `POST`, because a preview costs one of Notify's rate-limited calls** and that allowance is shared with real
 * sends — decision 9. It happens on an explicit action and never on a keystroke, a blur or an autosave; a tab that
 * previewed as the caseworker typed would spend the service's allowance on drafts and start failing real sends
 * with a 429. It is also the only way the typed wording can reach this step at all.
 *
 * **A rejected wording goes back to the form, not onto this page.** Local validation mirrors api's published rules
 * so the caseworker reads the message beside the control (decision 7); api's own 400 lands the same way, because
 * its field names are the slots' `snake_case` placeholder names and therefore this form's control names.
 */
import { InvalidInputError, previewCaseEmail, validateEmailSlots } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { en as composeEn, type EmailJourney, hasControl, loadEmailJourney, renderCompose, submittedSlots } from "./compose.js";

export const en = {
  title: "Check the email before sending",
  heading: "Check the email before sending",
  templateLabel: "Email",
  subjectLabel: "Subject",
  previewHeading: "The email",
  // **Claims the wording and not the appearance, because the appearance is not faithful here.** This said "as the
  // applicant will see it", which is false: no image in Notify's HTML can render inside the frame, so the crest
  // and any branding are missing. The caseworker's job on this page is to approve words before an irreversible
  // send, and the words *are* exact — so the caption says that and stops. See the CSP note in the docblock.
  previewCaption: "This is the wording GOV.UK Notify will send. The email's branding and images are not shown here.",
  // The iframe's accessible name. Decision 3's sandbox must not cost a screen-reader user the ability to read
  // what they are about to send, so this is not optional decoration.
  frameTitle: "Preview of the email that will be sent to the applicant",
  irreversible: "Once this email has been sent it cannot be recalled or edited.",
  warningIcon: "Warning",
  send: "Send the email",
  change: "Change the wording",
  backToCase: "Back to case",
  errorSummaryTitle: "There is a problem",
  // Fail closed: no rendering, no Send. api's `html` arrives empty rather than null when Notify returned nothing
  // (Task 1's correction), so both are this state — and a Send offered beside an empty frame is the one outcome
  // decision 3 exists to prevent.
  previewUnavailable:
    "GOV.UK Notify did not return a preview of this email, so there is nothing to check and it cannot be sent from here. Try again shortly, and tell the service team if it keeps happening.",
  // The lead sentence of a refusal. api's own message follows it and carries the detail — see `renderRefusal`.
  refused: "This email cannot be sent for this case."
};

// English content in the cy shape — see the note in ../../../../index.ts.
export const cy = { ...en };

export const POST = async (req: Request, res: Response) => {
  const journey = await loadEmailJourney(req);
  // The metadata the form was built from, so what is validated is what api published for this template rather
  // than a rule written here: a slot set is `EmailSlotResponse` rows at runtime and a template api adds later
  // arrives with slots this repo has never seen.
  const validated = validateEmailSlots(journey.compose.fields, submittedSlots(req));

  if (!validated.ok) {
    res.status(400);
    return renderCompose(res, journey, validated.errors);
  }

  try {
    const preview = await previewCaseEmail(req.params.id, req.params.template, validated.slots, callerFromRequest(req));

    return renderPreview(res, journey, validated.slots, preview);
  } catch (error) {
    // api's rules are the authority and its message is what the caseworker reads where the two disagree
    // (decision 7), so a rejection goes back to the control rather than to an error page.
    if (error instanceof InvalidInputError) return renderContentRejection(res, journey, validated.slots, error, "preview");
    throw error;
  }
};

/** The checked email, ready to send — or the sentence saying why there is nothing to check. */
export function renderPreview(
  res: Response,
  journey: EmailJourney,
  slots: Record<string, string>,
  preview: Awaited<ReturnType<typeof previewCaseEmail>>
): void {
  const html = renderableHtml(preview.html);

  render(res, journey, slots, { subject: preview.subject ?? null, html, canSend: html !== null, refusal: null });
}

/**
 * api refused the send itself, so this page says so and sends nobody anywhere else.
 *
 * **Not the 500 page, and not the tab.** api answers 409 when the case is in no state to send this email — for the
 * one shipped template, that no Master has refused the application — which is reachable without any double-click
 * at all: the referral may have been withdrawn or re-decided since the tab was rendered. A redundant *send* is not
 * this state; it is a 200 with `enqueued: false` and a success (see `send.ts`).
 *
 * **api's message carries the detail and this page's sentence carries the meaning.** api writes that message for a
 * caseworker, so it is rendered; but if a gateway ever answers with no body of its own the adapter has only
 * `deed-poll-api answered 409` to offer, which is why the lead sentence does not depend on it.
 *
 * No preview is fetched for this render: the wording is not what was wrong, and a second Notify call to say so
 * would spend the allowance decision 9 protects. The typed text is kept in the form that goes back to the
 * wording, so nothing is lost.
 */
export function renderRefusal(res: Response, journey: EmailJourney, slots: Record<string, string>, detail: string): void {
  render(res, journey, slots, { subject: null, html: null, canSend: false, refusal: detail.trim() === "" ? en.refused : `${en.refused} ${detail}` });
}

/**
 * A content rejection from api, placed against the controls it names where it can be.
 *
 * Shared with `send.ts`, because api applies the same rules to both write bodies — `PreviewEmailRequest` and
 * `SendEmailRequest` have identical properties — so a rejection means the same thing at either step and a second
 * copy of this would be a second chance to render it differently. `step` names the step in the log line only.
 *
 * Mixed rejections are split rather than dropped, as `../../referrals/new.ts` splits them: a 400 naming both a
 * slot and something this form has no control for would otherwise show the slot's message and lose the other,
 * and the caseworker would fix what they were shown and be refused again for the half they were not.
 *
 * One with no placeable field at all is the 422 for a case with no `applicantEmail`, which is not about the
 * wording: it becomes the refusal above, where the message can be read in full.
 */
export function renderContentRejection(res: Response, journey: EmailJourney, slots: Record<string, string>, error: InvalidInputError, step: string): void {
  const placeable = error.errors.filter((rejection) => hasControl(journey.compose, rejection.field));
  const unplaceable = error.errors.filter((rejection) => !hasControl(journey.compose, rejection.field));

  if (placeable.length === 0) {
    // A refusal is a 4xx even when this form has nowhere to put it. Without the status the documented 422 for a
    // case with no applicant email renders the check page at 200 OK, which makes a refused send indistinguishable
    // from an accepted one to logs, monitoring and anything between us and the browser — while the three sibling
    // refusal paths (`res.status(400)` below, and 400 and 409 in `send.ts`) all set one.
    //
    // 400 rather than api's own status, because `InvalidInputError` does not carry it: the adapter classifies a
    // 400 and a 422 into the same domain error, so this cannot distinguish them and neither can the branch below.
    // Preserving api's exact status would mean threading it through `libs/deed-poll/src/errors.ts`, which is a
    // wider change than this fix and is worth doing on its own terms rather than here.
    res.status(400);
    renderRefusal(res, journey, slots, error.message);
    return;
  }

  if (unplaceable.length > 0) {
    console.error(
      `email ${step} refused with rejections this form cannot place (${unplaceable.map((rejection) => rejection.field).join(", ")}): ${error.message}`
    );
  }

  res.status(400);
  renderCompose(res, journey, placeable, unplaceable.length > 0 ? composeEn.contentRefused : undefined);
}

/**
 * Notify's HTML when there is any to show, and `null` when there is not.
 *
 * **Empty or null, not null alone.** api's `EmailPreview.from` reads the Notify client's `Optional`s with
 * `orElse("")`, so an absent rendering arrives as an empty string; a check for null would render an empty frame
 * and offer a Send beside it. Whitespace counts as absent for the same reason.
 */
function renderableHtml(html: string | null | undefined): string | null {
  return typeof html === "string" && html.trim() !== "" ? html : null;
}

function render(res: Response, journey: EmailJourney, slots: Record<string, string>, state: PreviewState): void {
  res.render("deed-polls/email-preview", {
    case: journey.found,
    compose: journey.compose,
    // The checked values, carried as hidden controls: what was approved is what the send posts, so nothing can be
    // rendered for approval and then sent different.
    slots: Object.entries(slots).map(([name, value]) => ({ name, value })),
    ...state,
    en,
    cy
  });
}

/** What this page is showing: a rendering to approve, or the reason there is none. */
interface PreviewState {
  subject: string | null;
  /** Notify's HTML, for the sandboxed frame. `null` when there is nothing to check, and then `canSend` is false. */
  html: string | null;
  canSend: boolean;
  /** api's refusal, led by this page's own sentence. `null` on the ordinary path. */
  refusal: string | null;
}
