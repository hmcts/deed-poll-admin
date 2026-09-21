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
 * **Nothing in this repo makes that case rare, and this docblock used to claim otherwise.** It said the journey's
 * idempotency token existed to make a double-click rare (decision 16 of the plan). The token was minted, carried
 * through the check page and re-validated on the way back, and **never compared against a stored value** — so it
 * had no effect on anything, and a reader who found it would reasonably conclude this route was protected twice
 * over when it is protected once. The token has been removed rather than made real, because api's index already
 * covers every send this service can currently make and a second mechanism for a solved problem is complexity
 * with nothing on the other side of it.
 *
 * **The gap that removal leaves, so it is not rediscovered as a surprise.** api's index is on
 * `("referralId", "template")`, which makes "one of these per referral" a database constraint — exactly right for
 * the one shipped template and, as api's own notify-1 decision 4 flags, a rule that *may not generalise*. notify-6
 * proposes repeatable, case-driven chases: for a template like that there is no unique row to conflict with, so a
 * double-click would send a second email to an applicant and nothing here or in api would stop it. That is the
 * point at which real idempotency has to be built, and it needs server-side state — a token in a hidden control
 * cannot do it, which is the whole lesson of the one that was removed. Build it in api, where the outbox is, so
 * every client inherits it rather than each one re-implementing a guarantee.
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
import { loadEmailJourney, renderCompose, submittedSlots } from "./compose.js";
import { renderContentRejection, renderRefusal } from "./preview.js";

export const POST = async (req: Request, res: Response) => {
  const journey = await loadEmailJourney(req);
  const validated = validateEmailSlots(journey.compose.fields, submittedSlots(req));

  if (!validated.ok) {
    res.status(400);
    return renderCompose(res, journey, validated.errors);
  }

  try {
    // The slots and nothing else: api stamps the outbox row's author from the caller's own token, and the
    // journey's UUID is deliberately not sent — `SendEmailRequest` refuses an unknown key and names it.
    const sent = await sendCaseEmail(req.params.id, req.params.template, validated.slots, callerFromRequest(req));

    // Back to the tab, which is where the email now appears, with the banner saying which of the two happened.
    // The row's id goes with it so the banner can link to what was sent — `../../../[id].ts` renders the link
    // only for an id that case's history actually carries.
    return res.redirect(`/deed-polls/${req.params.id}?email=${sent.enqueued ? "sent" : "already-sent"}&emailId=${encodeURIComponent(sent.id)}#emails`);
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409);
      return renderRefusal(res, journey, validated.slots, error.message);
    }
    if (error instanceof InvalidInputError) return renderContentRejection(res, journey, validated.slots, error, "send");
    throw error;
  }
};
