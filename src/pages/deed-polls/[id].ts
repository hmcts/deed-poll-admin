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
 * **The emails read is additive on this page and load-bearing on the journey behind it.** api answers the tab,
 * the compose form and the per-email content out of the one payload (decision 8 of
 * `docs/plans/notify-2-caseworker-email-tab.md`), so a failure here costs the panel its table and its Send
 * button — `unavailableEmailsView()` offers neither, because the compose page reads the same endpoint and
 * would not load either.
 */
import {
  buildCaseHeader,
  buildDetailTabs,
  buildDocumentsView,
  buildEmailsView,
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
  referralColumns: ["Raised", "Status", "Reasons", "Urgency"],
  raiseReferral: "Refer this case to the judiciary",
  viewReferralHint: "view this referral",
  // Decision 9: the previous system recorded no reasons, so a migrated referral has none and says which it is.
  migratedReferral: "Migrated from the previous system",
  // Shown instead of the raise button while a referral is still with the judiciary: a case holds one at a
  // time, and api answers 409 for the second. Saying so beats a button that only fails.
  referralAlreadyOpen: "This case is with the judiciary. Withdraw the open referral before raising another.",
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

  const presentation = buildPresentation(
    { type: found.type, privacy: found.privacy, referToMasterChoice: found.referToMasterChoice, state: found.state },
    { isAdmin, isNew: false }
  );

  // A second call rather than a value carried on the case: the rules depend on the type, the migrated
  // flag and the Gazette choice, and api answers that question rather than being asked for a case.
  const rules = await getCaseFieldRules(
    { type: found.type, migrated: found.migratedRecord === true, publishToGazette: found.publishToLondonGazette !== false },
    caller
  );

  res.render("deed-polls/detail", {
    // The page title is the reference, so it is passed rather than sitting in `en`: it is data.
    pageHeading: found.displayReference,
    case: found,
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
    // Data rather than a label in `en`, as every other interpolated string on this page is: it carries
    // the case's count and api's threshold. The threshold is api's — enrolment-requirement.ts.
    witnessCount: witnessCountText(found.witnesses.length),
    en,
    cy
  });
};
