/**
 * The read-only case detail page, ported from the prototype's `@Get(':id')`.
 *
 * Every part of the view model comes from the domain — `buildDetailTabs`, `buildCaseHeader`,
 * `buildNotesView`, `buildDocumentsView`, `build` for presentation — so this handler assembles
 * rather than decides. That matters more here than anywhere: the tabs, sections and rows are derived
 * from `FORM_TABS`, the same metadata the edit forms use, which is what stops the read-only page
 * falling behind the form the way it once did. A new field belongs in `form-fields.ts` and then
 * appears on both.
 *
 * `findDeedPoll` includes the children, so notes, witnesses and documents come from the one query.
 *
 * Referrals and emails are the exceptions and cost a call each: `GET /caseworker/cases/{id}` carries neither,
 * so those two tabs have to ask — the reason `libs/deed-poll/src/referrals/service.ts` and
 * `libs/deed-poll/src/emails/service.ts` read them dedicated rather than off the case. Each goes to the
 * template twice over: merged into the record handed to `buildDetailTabs`, which counts it under its own name
 * like the other three subgrids, and as the view model the panel actually renders from.
 *
 * **Two of the four calls are fatal, and neither referrals nor emails is one of them.** The distinction is
 * load-bearing versus additive: `findDeedPoll` is the case, and `getCaseFieldRules` decides which fields exist
 * on the page at all, so neither has a page without it. Referrals and emails are one panel each out of
 * several, and the cost of making them fatal was out of proportion to it — `deed-poll-api-client`'s `classify`
 * maps by status, so a referrals 404 became `NotFoundError` and rendered "Page not found" for a case that
 * exists, a 5xx or a timeout became the 500 page, and a 403 rendered the 404 template. Three disguises, none
 * of which mentions the panel, for a failure `client.ts` itself classifies as "try again shortly".
 *
 * So each degrades to its own `unavailable…View()` and is logged, the same trade
 * `deed-polls/index.ts`'s `savedQueryEntries` makes for the saved-query nav. What they must **not** do is
 * degrade silently to an empty tab: "never referred" and "could not find out" are opposite claims, and so are
 * "nothing has been sent to this applicant" and "we could not find out", which is why both view models carry
 * `unavailable` rather than an empty list.
 *
 * **One referral tab, not two.** The retired "Referral to Master" tab is out of `FORM_TABS`, so the Referrals
 * panel is the whole of the case's referral surface: the live history from api, and above it the populated
 * retired fields as a read-only snapshot (`buildLegacyReferralView`). That snapshot comes off the case, so it
 * survives a failed referrals read — the two are different records and one failing says nothing about the other.
 *
 * **The emails read is additive on this page and load-bearing on the journey behind it.** api answers the tab,
 * the compose form and the per-email content out of the one payload (decision 8 of
 * `docs/plans/notify-2-caseworker-email-tab.md`), so a failure here costs the panel its table and its Send
 * button — `unavailableEmailsView()` offers neither, because the compose page reads the same endpoint and
 * would not load either.
 *
 * **The emails panel has no equivalent of the legacy snapshot**, and the asymmetry is api's rather than an
 * omission: there were no emails in the previous system to keep, so a failed emails read leaves the panel with
 * nothing at all to show, where a failed referrals read still has the retired fields.
 */
import {
  awaitingConfirmationRequestedOn,
  buildCaseHeader,
  buildDetailTabs,
  buildDocumentsView,
  buildEmailsView,
  buildLegacyReferralView,
  buildNotesView,
  build as buildPresentation,
  buildReferralsView,
  DOCUMENT_COLUMNS,
  findCaseEmails,
  findDeedPoll,
  findReferrals,
  getCaseFieldRules,
  unavailableEmailsView,
  unavailableReferralsView,
  witnessCountText
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../../auth/current-user.js";

const en = {
  title: "Case",
  privateTag: "Private",
  declarantTag: "Declarant",
  bannerTitle: "Important",
  // Beside the case state and never instead of it — `notify-3b` decision 2. There is no ninth case state, so
  // `Returned` is still what the header's State row reads and this sentence is the only thing that says the case
  // is waiting. It states the fact and the date and stops: what a confirmed case is then ready for, and which
  // date a caseworker should set next, is the open business question of `notify-3b` flag 1, so no wording here
  // may imply one (decision 8). "was asked on" rather than "since" because the date is when the email was sent,
  // and it is the EARLIEST outstanding request where a case holds two — see `awaitingConfirmationRequestedOn`.
  awaitingConfirmationFor: (requestedOn: string) =>
    `The applicant was asked on ${requestedOn} whether they want to proceed, and has not replied yet. Their reply is recorded against the referral it was requested for — see the Referrals tab.`,
  noneRecorded: "None recorded.",
  notEdited: "Not edited",
  addNote: "Add a note",
  addWitness: "Add a witness",
  uploadDocument: "Upload a document",
  changeLink: "Change",
  backToCases: "Back to cases",
  unknownType: "Unknown",
  noteColumns: ["NoteID", "Note", "Created", "Modified"],
  amendNoteHint: "amend this note",
  // Decision 3: "Referral status" and not "Status". This table sits on a case whose own header carries a
  // `DeedPollState`, and a referral decision does not determine that — so the column says which status it is.
  referralColumns: ["Raised", "Referral status", "Reasons", "Urgency"],
  // Which row the inset notice above is about. Without it the notice sends a caseworker to a tab that lists
  // dates, statuses and reasons and says nothing about a confirmation, so a case with more than one referral in
  // its history has to be opened row by row to find the one that was asked.
  //
  // Beside the status rather than instead of it, and not a tag: a referral's state and its confirmation are two
  // different facts about the same row — `Closed` clears neither confirmation column, so "Direction actioned"
  // and "waiting for the applicant" are a pair that can both be true. It says nothing about what to do next,
  // for the reason the notice says nothing (decision 8).
  referralAwaitingConfirmation: "Awaiting the applicant's response",
  raiseReferral: "Refer this case to the judiciary",
  viewReferralHint: "view this referral",
  // Decision 9: the previous system recorded no reasons, so a migrated referral has none and says which it is.
  migratedReferral: "Migrated from the previous system",
  // Shown instead of the raise button while a referral is live: a case holds one at a time, and api answers
  // 409 for the second. Saying so beats a button that only fails.
  //
  // **Keyed by the live referral's state, because one sentence cannot cover three.** The single message this
  // replaced told every caseworker to withdraw the open referral — including the one looking at a direction
  // the judiciary had already returned, which is exactly the work they were being asked to do and a thing api
  // refuses to withdraw (`referrals-admin-4` decision 5). `stateUnknown` is not the failed-read message:
  // `referralsUnavailable` says nothing was read, while this says a referral was read and could not be
  // understood.
  liveReferralMessages: {
    withJudiciary: "This case is with the judiciary. Withdraw the open referral before raising another.",
    directionReceived:
      "The judiciary has returned a direction on this case. Carry out the direction, make any case updates it requires, and mark the referral as actioned before raising another.",
    stateUnknown: "This case has a referral whose status could not be read, so no further referral can be raised yet. Try again shortly."
  },
  // The retired "Refer to Master" record, above the live history on the same panel. Its own heading and a
  // sentence saying where the values came from, because without one a caseworker reads ten fields with judicial
  // wording as something this service is still keeping up to date — and the point of the snapshot is that
  // nothing writes to it any more (`referrals-admin-4` decision 2).
  legacyReferralHeading: "Previous system referral information",
  legacyReferralIntro:
    "This referral record was recorded in the previous system. It is kept for reference, is not updated, and is separate from the referrals listed above.",
  // The referrals read failed. Worded so it cannot be read as "this case has no referrals" — the whole point
  // of the degraded state is that the panel is not making a claim about the case. See the docblock.
  referralsUnavailable:
    "Referral information could not be loaded, so this tab cannot say whether the case is with the judiciary. The rest of the case is shown as normal. Try again shortly.",
  // GOV.UK's own fallback for the warning icon, which is decorative and needs a text equivalent.
  warningIcon: "Warning",
  emailColumns: ["Email", "Created", "Status"],
  // "Created" and not "Sent" for the timestamp column, because a `Pending` row has a timestamp and has not
  // gone: api's field is the outbox row's `createdOn`, and a column headed "Sent" beside a state of "Waiting
  // to send" would contradict itself.
  viewEmailHint: "view what was sent",
  // Carries the template name, so a second sendable template arriving from notify-3 needs no new label — and
  // so the button still says what it does when read out of context by a screen reader.
  sendEmail: "Send an email",
  // Decision 10. The state column's words are the domain's (`NOTIFY_STATE_LABEL`), and this is the sentence
  // that makes "Accepted by Notify" unmistakable: there are no delivery callbacks in this estate, so the
  // service cannot know the applicant received or read anything, and a caseworker who assumed otherwise on a
  // bounced email is the failure the tab exists to prevent.
  emailsStateHint:
    "“Accepted by Notify” means GOV.UK Notify took the email to send. It is not confirmation that the applicant received or read it. Ring the applicant about anything that failed.",
  // The banner a completed send comes back to. "Accepted by GOV.UK Notify" rather than "sent to the applicant"
  // for the reason the state column is worded that way: api knows Notify took the email and nothing more.
  successTitle: "Success",
  emailSent: "The email has been accepted by GOV.UK Notify for sending to the applicant.",
  // api's insert is `ON CONFLICT DO NOTHING` on one email per referral, so a double-click or a browser resubmit
  // writes nothing and answers with the first row. Told as a success, because reporting a failure would invite a
  // third attempt — `emails/[template]/send.ts` has the reasoning.
  emailAlreadySent: "This email had already been sent for this case, so it was not sent again.",
  viewSentEmail: "View the email",
  // The emails read failed. Worded, like the referrals one, so it cannot be read as "nothing has been sent".
  emailsUnavailable:
    "Email information could not be loaded, so this tab cannot say what has been sent to the applicant, and no email can be sent from here at the moment. The rest of the case is shown as normal. Try again shortly.",
  documentColumns: DOCUMENT_COLUMNS,
  amendWitnessHint: "amend this witness",
  witnessAddress: "Address",
  witnessOccupation: "Occupation",
  witnessDeclarant: "Declarant",
  // A witness name is nullable on the wire and the schema sets no minimum, so it can be absent — and the
  // name is the link into the amend page, which an empty anchor would leave nothing to click.
  unnamedWitness: "Unnamed witness",
  yes: "Yes",
  no: "No"
};

// English content in the cy shape — see the note in index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const caller = callerFromRequest(req);
  // Together, because no answer depends on another and the referrals and emails tabs are rendered on every
  // case: the same shape `referrals/[referralId].ts` uses. `allSettled` rather than `all` so the failures can
  // be told apart — under `all` any one of them rejects the handler, and only the case read is the page.
  const [caseRead, referralsRead, emailsRead] = await Promise.allSettled([
    findDeedPoll(req.params.id, caller),
    findReferrals(req.params.id, caller),
    findCaseEmails(req.params.id, caller)
  ]);

  // The case is what the page is for, so its failure is still the page's: `NotFoundError` reaches the 404
  // page through `src/errors.ts` exactly as it did before.
  if (caseRead.status === "rejected") throw caseRead.reason;
  const found = caseRead.value;

  // Logged only now the case is known to exist. A mistyped id 404s *both* calls — `findReferrals` answers
  // api's 404 rather than an empty list — so logging any earlier would file a referrals fault for every
  // wrong URL and bury the real ones. No caller and no case id, per `client.ts`'s no-PII rule: what a search
  // of the logs needs to answer is whether the panel is degrading, not whose case it was.
  if (referralsRead.status === "rejected") {
    console.error(`referrals unavailable: ${referralsRead.reason instanceof Error ? referralsRead.reason.message : String(referralsRead.reason)}`);
  }
  // Same rule and the same reasons — and one of its own: api answers this read 400 for a case whose refusal
  // carries no directions text (flag 7 of the plan), so the message is worth having in the logs to tell that
  // apart from an outage.
  if (emailsRead.status === "rejected") {
    console.error(`emails unavailable: ${emailsRead.reason instanceof Error ? emailsRead.reason.message : String(emailsRead.reason)}`);
  }

  const referrals = referralsRead.status === "fulfilled" ? referralsRead.value : null;
  const emails = emailsRead.status === "fulfilled" ? emailsRead.value : null;
  const { isAdmin } = userFromRequest(req);

  // No `referToMasterChoice`: it used to decide whether the retired referral tab was shown, and that tab is
  // gone from `FORM_TABS` — see `form-presentation.ts`. The record's own values now decide whether the
  // read-only snapshot renders, which is the right test for history.
  const presentation = buildPresentation({ type: found.type, privacy: found.privacy, state: found.state }, { isAdmin, isNew: false });

  // A second call rather than a value carried on the case: the rules depend on the type, the migrated
  // flag and the Gazette choice, and api answers that question rather than being asked for a case.
  const rules = await getCaseFieldRules(
    { type: found.type, migrated: found.migratedRecord === true, publishToGazette: found.publishToLondonGazette !== false },
    caller
  );

  // Resolved here as well as by the render interceptor, because the waiting sentence interpolates a date the
  // template does not have — the pattern `.claude/rules/frontend.md` gives for an `en` entry that is a function.
  const content = res.locals.locale === "cy" ? cy : en;
  // Off the case, like the legacy referral snapshot: `awaitingConfirmationSince` is api's own denormalisation, so
  // the sentence survives a failed referrals read and is never derived from the referrals or the email history
  // (decision 2). Empty rather than null, so the template asks "is there something to say".
  const requestedOn = awaitingConfirmationRequestedOn(found);

  res.render("deed-polls/detail", {
    // The page title is the reference, so it is passed rather than sitting in `en`: it is data.
    pageHeading: found.displayReference,
    case: found,
    awaitingConfirmation: requestedOn === null ? "" : content.awaitingConfirmationFor(requestedOn),
    presentation,
    // `referrals` and `emails` merged in because they are the two subgrids whose rows are not on the case —
    // see the docblock. A failed read passes `null`, which `subgridCount` counts as 0 and so marks the tab
    // `empty`. That is a claim the template never renders for a subgrid (`detail-view.ts`), and `[]` would say
    // the same thing, so it is left rather than given an `empty: unknown` no page reads. Each panel's own
    // states are what a caseworker sees. `emails` is the history rather than the whole payload, because that
    // is the list the tab's rows come from.
    tabs: buildDetailTabs({ ...found, referrals, emails: emails?.history ?? null } as unknown as Record<string, unknown>, rules, presentation),
    header: buildCaseHeader(found),
    notes: buildNotesView(found.notes),
    documents: buildDocumentsView(found.documents),
    referrals: referrals ? buildReferralsView(referrals) : unavailableReferralsView(),
    emails: emails ? buildEmailsView(emails) : unavailableEmailsView(),
    emailBanner: emailBanner(req, emails),
    // Off the case, so it is unaffected by the referrals read and renders on a degraded panel too: the two are
    // different records, and a failed call to api's referral endpoint says nothing about the retired fields the
    // case itself carries. `null` when the case holds none of them, and the panel then shows no section.
    legacyReferral: buildLegacyReferralView(found as unknown as Record<string, unknown>),
    // Data rather than a label in `en`, as every other interpolated string on this page is: it carries
    // the case's count and api's threshold. The threshold is api's — enrolment-requirement.ts.
    witnessCount: witnessCountText(found.witnesses.length),
    en,
    cy
  });
};

/**
 * What a completed send comes back to, or `null` on an ordinary visit.
 *
 * `emails/[template]/send.ts` redirects here rather than rendering its own confirmation, so this is where the two
 * outcomes are worded: an email accepted by Notify, and a redundant send that api answered with the row it had
 * already written. Both are successes — see that file for why the second is not reported as a failure.
 *
 * **The link is only built for a row this case's history actually carries.** `emailId` is a query parameter and
 * therefore user input, so an invented one must not reach an `href`; without a match the banner still says what
 * happened and simply does not offer the link. A failed emails read has no history to check against, which is the
 * same answer.
 */
function emailBanner(req: Request, emails: Awaited<ReturnType<typeof findCaseEmails>> | null): EmailBanner | null {
  const outcome = req.query.email;
  if (outcome !== "sent" && outcome !== "already-sent") return null;

  const id = typeof req.query.emailId === "string" ? req.query.emailId : "";
  const known = emails?.history.some((email) => email.id === id) === true;

  // **The query string is user input, so the banner's words are gated on the history and not only its link.**
  // Telling a caseworker an applicant has been informed their application was refused, when they have not been, is
  // the failure decision 10 exists to prevent — and `?email=sent` alone used to be enough to produce that sentence
  // for anyone who could be handed a URL. An id the history does not carry means the parameter was fabricated or
  // the send it refers to belongs to another case, and neither is something to confirm.
  //
  // **A failed history read is the exception, and it stays confirmed.** `emails` is null when that read degraded
  // (see `unavailableEmailsView`), so there is nothing to check the id against — and suppressing the banner then
  // would lose a genuine confirmation for a send that did happen, which is the worse of the two errors. The link
  // is withheld because it cannot be built, and that is the same in both cases.
  if (emails !== null && !known) return null;

  return {
    text: outcome === "sent" ? en.emailSent : en.emailAlreadySent,
    href: known ? `/deed-polls/${req.params.id}/emails/${encodeURIComponent(id)}` : null
  };
}

/** The success banner after a send: what happened, and where the email is if it can be linked to. */
interface EmailBanner {
  text: string;
  href: string | null;
}
