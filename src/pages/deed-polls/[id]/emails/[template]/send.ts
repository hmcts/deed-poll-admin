/**
 * Step three: send it. api freezes the recipient and the wording into an outbox row and drains it immediately.
 *
 * **`POST …/{template}/send` rather than `POST …/{template}`, which is one departure from decision 2's table and
 * the reason is the router.** `emails/[notificationId].ts` already answers `GET /deed-polls/:id/emails/:x`, so a
 * send at the same path would put two meanings — an outbox row's id and a template key — in one URL, told apart
 * only by the method and by which route `sortRoutes` happened to register first. `simple-router`'s conflict check
 * keys on the *parameter name*, so it would not have noticed. The sub-resource is also what
 * `../../referrals/[referralId]/withdraw.ts` does with api's own transition paths, and the URL is not something a
 * caseworker reads. Recorded in `docs/plans/notify-2-caseworker-email-tab.md` under Task 5.
 *
 * **A redundant send is a success and is told as one.** api's insert is `ON CONFLICT DO NOTHING` on one email per
 * referral, so a double-click or a browser resubmit answers 200 with the first row's id and `enqueued: false`.
 * Telling the caseworker their send failed would invite a third attempt, so the banner says the email had already
 * been sent and links to it.
 *
 * **The journey's key is back in a hidden control, and this docblock used to argue that it could not work.** What
 * it argued against was a token *nothing compared* — minted here, carried through the check page, re-validated on
 * the way back, and never checked against stored state, so it read like a guard while protecting nothing. It said
 * real idempotency "needs server-side state… Build it in api, where the outbox is", and **api's notify-6 did
 * exactly that**: it persists `requestId` against the case with a unique index on `("deedPollId", "requestId")`,
 * resolves a repeat itself, and made `Idempotency-Key` a **required** header of the send. So the hidden control is
 * no longer a client-side guarantee pretending to be one — it is the transport for a key the server gives meaning
 * to, which is the one thing the old objection did not cover.
 *
 * **What that closed.** api's other index is on `("referralId", "template")`, which makes "one of these per
 * referral" a database constraint — right for `application-rejected` and, as api's own notify-1 decision 4
 * flagged, a rule that does not generalise. notify-6's repeatable, case-driven chase has no unique row to conflict
 * with, so a double-click there would have told an applicant twice; the key is what stops it, for every template
 * rather than for the chase. There is no per-template branch anywhere in this journey.
 *
 * **The key is read, never minted here.** `preview.ts` mints it when the check page renders, because a key minted
 * at this POST would be new on every retry and the header would guarantee nothing. A missing or unparseable one is
 * therefore a bug in this app rather than something a caseworker did: it is a plain `Error` and the 500 page, not a
 * message against a control. api's own refusal would name the header, and no form has a control for a header — so
 * rendering it against one would ask a caseworker to correct something they cannot see or reach.
 *
 * **Both ways of learning that reach the same page, which takes two checks rather than one.** The guard below
 * covers a key this app can see is unusable; api's 400 naming the header covers one that left here fine and did
 * not arrive — a gateway dropping an unrecognised request header, which is a deployed-environment fault and the
 * only remaining way in. Without the second check that 400 is an `InvalidInputError` naming a field no control
 * matches, which `renderContentRejection` turns into the check page's *refusal* — "This email cannot be sent for
 * this case", said about a case that is perfectly sendable, with the Send button withheld and **nothing logged**,
 * because that function's `console.error` sits after its no-placeable-field return. Every send in the environment
 * would fail as a business refusal with no trace. Decision 7 asks for the 500 page, and it means both routes to it.
 *
 * **Tampering with the control changes nothing that matters.** A *reused* key with different content is api's 409
 * and is rendered like any other; a *fresh* one is indistinguishable from starting a new compose journey, which is
 * allowed. The unique index is scoped to the case, so a chosen UUID cannot collide across cases either.
 *
 * **That 409 is the one refusal this page cannot be corrected from, and it is left that way knowingly.** api's two
 * 409s here are distinguishable only by prose, which this app must not parse, so the refusal re-renders with the
 * same key either way — and for "this key was already used for a different email" that means "Change the wording"
 * leads back to a Send that earns the same 409. Re-keying every refusal instead would break the other one, where
 * keeping the key is the whole point (decision 2): a case that becomes sendable must be sendable by the journey
 * that was refused, not by a second send. api's own sentence says to start composing again, and the "Back to case"
 * link is where that starts; reaching it takes one click more than the page it is on. Worth revisiting only with a
 * way to tell api's two 409s apart, which today would mean matching its wording.
 *
 * **A 409 means something else entirely and is not an error page.** It says the case is in no state to send this
 * email — for the one shipped template, that no Master has refused the application — which a caseworker reaches
 * when the referral was withdrawn or re-decided while this journey was open. `renderRefusal` puts api's own
 * sentence on the check page with a way back to the wording and to the tab.
 *
 * **The wording is validated again here even though the check page validated it**, because the body of this
 * request is user input like any other: nothing guarantees it is the body the check page rendered, and api would
 * refuse it anyway. Local validation is the second guard and api stays the authority (decision 7).
 */
import { ConflictError, InvalidInputError, sendCaseEmail, validateEmailSlots } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { casePath } from "../../../../../case-path.js";
import { loadEmailJourney, renderCompose, submittedSlots } from "./compose.js";
import { renderContentRejection, renderRefusal } from "./preview.js";

/**
 * The field api names when it is the *header* it refused, rather than anything in the body.
 *
 * Matched case-insensitively because it is a header name and nothing guarantees the case api or a gateway between
 * us echoes it in: HTTP header names are case-insensitive, so a match that depended on the casing would fall
 * through to the refusal path this exists to avoid.
 */
const IDEMPOTENCY_KEY_FIELD = "idempotency-key";

export const POST = async (req: Request, res: Response) => {
  // Before the send, so an id that cannot be redirected to is refused rather than emailed and then refused.
  const caseHref = casePath(req.params.id);
  const journey = await loadEmailJourney(req);

  // Before the wording, because a form that reached here without one is broken in a way no correction to the
  // wording can fix: re-rendering it would hand back a check page that mints a fresh key and hides the fault.
  if (journey.key === null) {
    throw new Error(`email send for case ${req.params.id} carried no idempotency key, so this form is broken`);
  }

  const validated = validateEmailSlots(journey.compose.fields, submittedSlots(req));

  if (!validated.ok) {
    res.status(400);
    return renderCompose(res, journey, validated.errors);
  }

  try {
    // The slots in the body and the journey's key in the header: api stamps the outbox row's author from the
    // caller's own token, and `SendEmailRequest` refuses an unknown body property and names it.
    const sent = await sendCaseEmail(req.params.id, req.params.template, validated.slots, journey.key, callerFromRequest(req));

    // Back to the tab, which is where the email now appears, with the banner saying which of the two happened.
    // The row's id goes with it so the banner can link to what was sent — `../../../[id].ts` renders the link
    // only for an id that case's history actually carries.
    return res.redirect(`${caseHref}?email=${sent.enqueued ? "sent" : "already-sent"}&emailId=${encodeURIComponent(sent.id)}#emails`);
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409);
      return renderRefusal(res, journey, validated.slots, error.message);
    }
    // Decision 7, reached the other way round from the guard above: api refused the *header*, which no form has a
    // control for, so `renderContentRejection` would place it nowhere and fall through to a refusal reading "This
    // email cannot be sent for this case" — a broken app presented to the caseworker as a fact about their case,
    // and one that logs nothing on that path. Only a header lost or rewritten in transit gets here, since the guard
    // above covers every key this app can see is unusable, which is exactly why it must not be silent.
    if (error instanceof InvalidInputError && namesTheIdempotencyKey(error)) {
      throw new Error(`email send for case ${req.params.id} was refused for its idempotency key, so the header did not arrive as sent`);
    }
    if (error instanceof InvalidInputError) return renderContentRejection(res, journey, validated.slots, error, "send");
    throw error;
  }
};

/** Whether api's rejection is about the header rather than about anything the form posted. */
function namesTheIdempotencyKey(error: InvalidInputError): boolean {
  return error.errors.some((rejection) => rejection.field.toLowerCase() === IDEMPOTENCY_KEY_FIELD);
}
