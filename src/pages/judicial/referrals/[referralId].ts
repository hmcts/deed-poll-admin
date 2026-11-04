/**
 * One referral as the Master who may see it reads it: the referral and the narrow application view, with no case
 * notes (Master Sullivan's feedback, 2026-10-27).
 *
 * **One call, and no second one is available even in principle.** api answers the page in one payload
 * (`JudicialReferralDetail` carries `application`), so re-reading it would be a round trip
 * for an answer already held — and there is no judicial route to read them from. There is also no case id to
 * read one with: api keys the whole judicial surface on the referral (`referrals-api-3` decision 2), so this
 * page cannot fetch the case even if a future field made it look worth doing.
 *
 * **It renders exactly what api sent.** The application is `JudicialApplicationView` — the names, type, nationality, a
 * minor's parents and the documents — and the disclosure boundary is api's own, not a filter here (narrowed in api
 * on 2026-10-27). Nothing is added, nothing is enriched, and the application is read-only.
 *
 * **A 404 is "no longer available" and never "somebody else has it."** api's visibility answers 404
 * identically for a referral that was withdrawn, closed, assigned to another Master, or never existed
 * (decision 10) — so this page renders one sentence for all four, on a 404 of its own rather than the shared
 * "Page not found": a stale link to a referral since reassigned or closed is the commonest way to arrive here, and
 * it is not a mistyped URL. Naming the cause would enumerate exactly what api's shared 404 exists to hide.
 *
 * **The way back is always My referrals, and there is no `returnTo`.** Since api D2 there is no pool and no claim: a
 * referral a Master can see is on My referrals, so there is one list to go back to and no query parameter to
 * validate as an open redirect.
 */
import { buildJudicialReferral, getReferral, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";
import { documentPaths, referralViewerScope } from "../../../document-viewer/context.js";
import { referralPath } from "../../../judicial-referral-path.js";

/** The Master's own list, and the only judicial one. */
const MINE_PATH = "/judicial/referrals/mine";

/** What `[referralId]/direction.ts` redirects back with: the direction was recorded, or the referral is not this judge's to direct. */
const DIRECTION_RECORDED = "recorded";
const DIRECTION_NOT_HELD = "notheld";

/**
 * What a change (`[referralId]/direction.ts?change=1`) or a withdrawal (`[referralId]/withdraw.ts`) redirects back
 * with: it happened, or api 409'd it because the referral is visible but not this judge's direction.
 */
const DIRECTION_CHANGED = "changed";
const DIRECTION_WITHDRAWN = "withdrawn";
const DIRECTION_NOT_CHANGEABLE = "notchangeable";

const en = {
  title: "Referral to a Master",
  heading: "Referral to a Master",
  applicationHeading: "Application",
  // Shown when api sent no application on the referral. A shape its DTO permits rather than a state anyone
  // expects, so it says what is true — the details were not sent — instead of showing a column of
  // placeholders, which would read as an application whose applicant has no name.
  applicationMissing: "The application details were not returned with this referral.",
  documentsHeading: "Supporting documents",
  documentNameColumn: "Document",
  documentTypeColumn: "Type",
  documentUploadedColumn: "Uploaded",
  documentSizeColumn: "Size",
  // Said rather than an empty table: a table with a header row and no body reads as documents that failed to load.
  documentsEmpty: "No documents have been added to this application.",
  // The caseworker Referrals panel's heading for the same populated-only snapshot.
  referralHeading: "Referral",
  stateLabel: "Status",
  reasonsLabel: "Reasons for referral",
  notesLabel: "Notes from the court",
  urgencyLabel: "Urgency",
  urgencyReasonLabel: "Reason for urgency",
  assignedLabel: "Assigned to you",
  dueByLabel: "Direction due by",
  noneRecorded: "None recorded.",
  directionHeading: "Direction recorded",
  decisionLabel: "Decision",
  directionsLabel: "Directions/Reasons",
  gazetteLabel: "Changes to the standard publications in the Gazette",
  decidedLabel: "Recorded",
  yes: "Yes",
  no: "No",
  // The third state of api's nullish `changesToStandardPublication`, said rather than collapsed into "No": a direction it
  // recorded no answer for must not read as one directed against publication.
  gazetteNotRecorded: "Not recorded",
  direct: "Record a direction",
  backToMine: "Back to My referrals",
  errorSummaryTitle: "There is a problem",
  successTitle: "Success",
  // The direction has just been recorded. Said on the referral rather than on a confirmation page of its own,
  // because the recorded direction is on this page: the banner explains why the state has changed and the
  // summary list below is the direction itself.
  //
  // Named apart from the `directionRecorded` the model carries: the content is the sentence, the model is whether
  // it applies. They are one key in the
  // template, and a content key of the same name would answer "did it happen?" with "here are the words".
  directionRecordedMessage: "Your direction has been recorded.",
  directionChangedMessage: "Your direction has been changed.",
  // Withdrawing leaves the referral with this judge with the direction form offered again, so the banner says
  // what is now owed.
  directionWithdrawnMessage: "Your direction has been withdrawn. Record a new direction.",
  // Decision 5 and 6's two controls, offered only on a referral this judge has directed. Links, because each opens
  // a page that asks before anything is written.
  changeDirection: "Change your direction",
  withdrawDirection: "Withdraw your direction",
  // api's 409: the referral is still visible to this judge but is not waiting for their direction — they have
  // already directed it. It names no other judge: a referral reassigned to someone else is a 404, which reads as
  // "no longer available" instead.
  directionNotHeldMessage: "This referral is not waiting for a direction from you. Check its status below.",
  // api's 409 on a change or a withdrawal: the referral is visible but is not a direction this judge gave — it is
  // still waiting for one, or the direction was already withdrawn. A closed referral is a 404 and never gets here,
  // so the sentence names the state and no judge.
  directionNotChangeableMessage: "This referral does not have a direction from you to change or withdraw. Check its status below."
};

// English content in the cy shape — see the note in ../../deed-polls/index.ts.
const cy = { ...en };

/**
 * The "no longer available" page's own words.
 *
 * A second content pair in this file rather than a page of its own, because it is this read's other outcome:
 * the two are rendered by one handler and a judge reaches the second only by asking for the first.
 */
const unavailableEn = {
  title: "This referral is no longer available",
  heading: "This referral is no longer available",
  // The whole of decision 10 in one sentence. It must stay true of all four causes api refuses for, which is
  // why it says nothing about who holds the referral or whether it ever existed — and why it does not
  // enumerate the causes either: naming "another judge" as one of them is the implication decision 10
  // forbids, however hedged.
  body: "Your referrals are listed on My referrals.",
  backToMine: "Back to My referrals"
};

const unavailableCy = { ...unavailableEn };

export const GET = async (req: Request, res: Response) => {
  const { referralId } = req.params;
  // Before the read, so a dot-only id is refused rather than looked up and then linked to as a parent path.
  const href = referralPath(referralId);

  let referral: Awaited<ReturnType<typeof getReferral>>;
  try {
    referral = await getReferral(referralId, callerFromRequest(req));
  } catch (error) {
    // Only the 404 is this page's to render: every other failure is a fault and belongs on the 500 page,
    // and a `ForbiddenError` here would mean the role gate let someone through that api then refused.
    if (!(error instanceof NotFoundError)) throw error;

    // 404 with the status as well as the wording. A judge following a stale link is
    // not looking at a page that never existed, but the resource is genuinely gone and a 200 would say the
    // page rendered what was asked for.
    return res.status(404).render("judicial/referrals/unavailable", { myReferralsPath: MINE_PATH, en: unavailableEn, cy: unavailableCy });
  }

  const content = res.locals.locale === "cy" ? cy : en;
  const view = buildJudicialReferral(referral);

  res.render("judicial/referrals/referral", {
    referral: view,
    // The boolean as this page's words, resolved here because `buildDirectionView` deliberately leaves it a
    // boolean for the page's own `en`/`cy` to name — and because the three states are one decision worth
    // making somewhere testable rather than in a template ternary.
    gazetteAnswer: gazetteAnswer(view.direction?.changesToStandardPublication, content),
    // Each document opens the full-page viewer, built with the viewer's own helpers rather than in the template.
    documents: (view.application?.documents ?? []).map((document) => ({
      ...document,
      href: documentPaths(referralViewerScope(referralId), document.id).viewPath
    })),
    // Built here rather than in the template, so the one path shape lives in one place.
    directionHref: `${href}/direction`,
    changeHref: `${href}/direction?change=1`,
    withdrawHref: `${href}/withdraw`,
    backHref: MINE_PATH,
    // What a redirect sent the judge back with, if anything. Two shapes rather than two sources: a success is a
    // banner, a refusal is an error summary. An unrecognised value says nothing at all, since a hand-typed
    // `?direction=` pins no state.
    //
    // The success banner is checked against what api sent as well as against the query, because it asserts a
    // *write*: `?direction=recorded` on a referral api holds no direction for would announce one that does not
    // exist. A refusal needs no such check — one
    // that no longer applies is only over-cautious. See `directionBanner`.
    directionBanner: directionBanner(req.query, view, content),
    refused: refusal(req.query, content),
    en,
    cy
  });
};

/**
 * The success a redirect arrived with, or nothing — and only when the state api sent bears it out.
 *
 * Recorded and changed both leave a direction on the referral; withdrawn leaves it waiting for one from this judge.
 */
function directionBanner(query: Request["query"], view: ReturnType<typeof buildJudicialReferral>, content: typeof en): string {
  if (query.direction === DIRECTION_RECORDED && view.direction !== null) return content.directionRecordedMessage;
  if (query.direction === DIRECTION_CHANGED && view.direction !== null) return content.directionChangedMessage;
  if (query.direction === DIRECTION_WITHDRAWN && view.directable) return content.directionWithdrawnMessage;

  return "";
}

/**
 * The refusal a redirect arrived with, or nothing.
 *
 * Every sentence names a state and none names a judge — api does not say who holds a referral, and the one it
 * refuses *for* a holder is a 404 that never reaches this page.
 */
function refusal(query: Request["query"], content: typeof en): string {
  if (query.direction === DIRECTION_NOT_HELD) return content.directionNotHeldMessage;
  if (query.direction === DIRECTION_NOT_CHANGEABLE) return content.directionNotChangeableMessage;

  return "";
}

/**
 * The Gazette direction in words — three answers, because api's `changesToStandardPublication` is nullish.
 *
 * A direction with no recorded answer says so. Collapsing `null` onto "No" would assert the judge directed
 * against publication, which is both a claim api never made and the one answer on this screen that cannot be
 * taken back.
 */
function gazetteAnswer(changesToStandardPublication: boolean | null | undefined, content: typeof en): string {
  if (changesToStandardPublication === true) return content.yes;
  if (changesToStandardPublication === false) return content.no;

  return content.gazetteNotRecorded;
}
