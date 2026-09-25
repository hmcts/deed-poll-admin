/**
 * The correspondence a case owes its applicant, read and sent through `deed-poll-api`.
 *
 * Three thin functions over the three operations api publishes, and no rules of their own. What is worth
 * knowing before reading a caller of these:
 *
 * **One read serves the whole tab, the per-email page and the compose form.** api's `GET …/emails` answers
 * `{ availability, history, slotDefaults }` in one response, so nothing above here asks a second time: the
 * compose form opens from `slotDefaults` rather than spending a Notify call on `previewCaseEmail` merely to
 * discover the judge's words, and the per-email content page reads its row out of the same `history` the tab
 * rendered. Decision 8 of `docs/plans/notify-2-caseworker-email-tab.md`.
 *
 * **`previewCaseEmail` costs one of Notify's rate-limited calls and that allowance is shared with real sends**,
 * so it belongs behind an explicit action and never behind a keystroke, a blur or an autosave — decision 9. A
 * tab that previewed as the caseworker typed would spend the service's allowance on drafts and start failing
 * real sends with a 429.
 *
 * **A redundant send is a success, not a conflict, and a `ConflictError` here means something else.** api's
 * insert is `ON CONFLICT DO NOTHING` on one-email-per-referral, so a double-click answers 200 with the first
 * row's id and `enqueued: false`; the caller renders that as "already sent" rather than as a failure, because a
 * reported failure invites a third attempt. `ConflictError` means the case is in no state to send this email at
 * all — for the one shipped template, that no Master has refused the application — which a caseworker reaches
 * when the referral was withdrawn or re-decided after the tab was rendered.
 *
 * **Both of api's refusals of content arrive as `InvalidInputError`**: its 400 naming each offending slot, and
 * its 422 for a case with no `applicantEmail` to send to, which names that column so a page can say whose
 * address is missing. `slot-validation.ts` mirrors the first locally so a caseworker gets a message beside the
 * field instead of a round trip; api stays the authority, and its message is what the page shows if the two
 * ever disagree (decision 7).
 *
 * **No author, but the idempotency key is now required.** api stamps the outbox row's `createdBy` from the
 * caller's own token, as everywhere else. The key is the one thing a send carries that api does not derive:
 * notify-6 made `Idempotency-Key` a required header, so `sendCaseEmail` takes it and passes it on. It is
 * **never generated here** — the key identifies the compose journey, and a service minting its own would hide
 * that identity from the only thing that defines it, making every retry a new send. It goes in the header and
 * not the body: `SendEmailRequest` is one of the two bodies in this contract with
 * `additionalProperties: false`, so smuggling it in would be a 400 that names it.
 */
import { type CaseEmails, type EmailPreview, type EmailSlotsWrite, getCaseEmails, previewEmail, type SentEmail, sendEmail } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";

/**
 * Everything the Email tab needs about one case: what may be sent, what has been sent, and the values api
 * resolved for each sendable template's slots.
 *
 * A missing case is api's 404 rather than an empty payload, so this never answers three empty arrays for a
 * mistyped id — the same guarantee `../referrals/service.ts` relies on.
 */
export function findCaseEmails(deedPollId: string, caller: Caller): Promise<CaseEmails> {
  return callApi(caller, (config) => getCaseEmails(deedPollId, config));
}

/**
 * The email as GOV.UK Notify renders it, from the slot text the caseworker has typed so far. Writes nothing.
 *
 * `slots` is already validated by the page that took the form, so it goes on the wire unchanged. An
 * unprovisioned template is api's 502 and therefore a plain `Error` and the 500 page; a tab knows that in
 * advance from `availability[].provisioned` instead, which is why nothing here pre-checks it.
 */
export function previewCaseEmail(deedPollId: string, template: string, slots: EmailSlotsWrite, caller: Caller): Promise<EmailPreview> {
  return callApi(caller, (config) => previewEmail(deedPollId, template, slots, config));
}

/**
 * Send the email: api freezes the recipient and the content into an outbox row and drains it immediately.
 *
 * The row that now owes the email comes back, so a page can render `enqueued: false` as the already-sent state
 * it is rather than assuming its click created something.
 *
 * `idempotencyKey` is the compose journey's UUID, minted by the page that rendered the Send button and reused by
 * every retry of that one submission — see the note above on why nothing here generates it.
 */
export function sendCaseEmail(deedPollId: string, template: string, slots: EmailSlotsWrite, idempotencyKey: string, caller: Caller): Promise<SentEmail> {
  return callApi(caller, (config) => sendEmail(deedPollId, template, slots, idempotencyKey, config));
}
