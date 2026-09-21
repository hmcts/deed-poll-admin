/**
 * One email this case has had: what it said, who it went to, what became of it, and what it carried.
 *
 * **It makes no api call of its own for the email.** api answers the whole Email tab — availability, history and
 * slot defaults — in one response, so this page reads its row out of the same `findCaseEmails` payload the table
 * was built from (decision 14 of `docs/plans/notify-2-caseworker-email-tab.md`). There is no per-notification
 * endpoint, and adding a second call for one panel's worth of content would be the round trip that rule exists to
 * refuse. `findDeedPoll` is the second call, and it is the case reference in the caption rather than anything
 * about the email — the same shape `referrals/[referralId].ts` uses for the same reason.
 *
 * **Both calls are load-bearing here, unlike on the tab.** The case detail page reads emails with
 * `Promise.allSettled` and degrades the panel, because there the emails read is one tab out of several. This page
 * *is* the email, so a failed read has nothing to render and its error goes to the page the way the case's does.
 *
 * **An id that is not this case's is a 404, and api's scoping is what makes it one.** The payload only ever
 * carries this case's history, so another case's notification is simply absent from it — there is no filter here
 * and no second read to check ownership with. A 404 is also all a caseworker learns from a guessed id, which is
 * the right amount.
 *
 * **The body is plain text and must stay in the autoescaped path.** `EmailHistoryResponse.body` is the text
 * rendering api captured from Notify's send acceptance, not the branded HTML the applicant read — decision 12 has
 * the table. The preview's sandboxed iframe is for a different field of a different shape; reaching for it here,
 * or for `| safe`, would put caseworker free text into an unescaped render for no gain.
 */
import { buildEmailDetail, findCaseEmails, findDeedPoll, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

const en = {
  title: "Email",
  heading: "Email to the applicant",
  // Decision 13: the applicant received Notify's branded HTML and this is the text rendering of the same
  // template with the same values. Labelling it as a copy of the email invites "that is not what they got" from
  // the one person who might have to defend it.
  bodyHeading: "The wording that was sent",
  bodyCaption: "This is the wording of the email, as text. The applicant received it laid out and branded by GOV.UK Notify.",
  subjectLabel: "Subject",
  recipientLabel: "Sent to",
  stateLabel: "Status",
  failureLabel: "Why it failed",
  createdLabel: "Created",
  documentsLabel: "Documents attached",
  templateLabel: "Email",
  // The one shipped template attaches nothing, so this is what every email reads today. Said rather than left
  // blank, because an empty cell beside "Documents attached" reads as a question the page failed to answer.
  noDocuments: "None",
  // Decision 10, in the sentence the tab carries too: api knows GOV.UK Notify accepted the send and nothing
  // more. There are no delivery callbacks in this estate and no download concept at all, so nothing on this page
  // may be read as proof the applicant got it.
  stateHint:
    "“Accepted by Notify” means GOV.UK Notify took the email to send. It is not confirmation that the applicant received or read it. Ring the applicant about anything that failed.",
  backToCase: "Back to case"
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const caller = callerFromRequest(req);
  // Together, because neither answer depends on the other. `all` rather than `allSettled`: both are the page.
  const [found, emails] = await Promise.all([findDeedPoll(req.params.id, caller), findCaseEmails(req.params.id, caller)]);

  const email = buildEmailDetail(emails, req.params.notificationId);
  if (!email) throw new NotFoundError(`Email ${req.params.notificationId} not found`);

  res.render("deed-polls/email-detail", { case: found, email, en, cy });
};
