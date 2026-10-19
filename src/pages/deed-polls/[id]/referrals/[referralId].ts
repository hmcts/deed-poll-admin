/**
 * One referral, read-only.
 *
 * **It does not restate the application.** api's `ReferralResponse` carries no case data, and the case detail
 * page is one click away — a referral view that repeated the applicant's details would be a second round trip
 * to show what the page the caseworker came from already showed.
 *
 * **The referral is read scoped to its case.** `findReferral` puts both ids in the path, so a referral
 * belonging to another case 404s rather than rendering under this case's reference; there is no scoping
 * pre-read, because api's routes are nested and it answers that question itself.
 *
 * **Two controls, two capabilities, and api still decides.** `canWithdraw` (`Open`/`Claimed`) and `canClose`
 * (`Decided`) come from `referrals-view.ts` and govern visibility only: the refusal itself is api's 409. A
 * referral somebody else finished with between this render and the click therefore lands on that 409, which is
 * what `withdrawRefused` is for — and why the withdraw route sends the caseworker back here rather than to an
 * error page. Neither control is offered on a terminal referral, and **neither on a state this app cannot
 * read**: see `buildReferralDetail` for why an unknown state no longer inherits the withdraw.
 *
 * **The whole returned direction is on this page** (decision 4), because this is where a caseworker is told to
 * carry it out. `decidedBy` and never `modifiedBy` — closing the referral changes the modifier to the
 * caseworker who actioned it, and reading the author off that field would credit the direction to them.
 *
 * **The applicant's confirmation is a fourth section and a third control, and it is independent of the other
 * two** (`notify-3b` decision 6). api clears neither confirmation column when a referral is closed or withdrawn,
 * so a terminal referral can still be waiting for an answer — which is exactly what keeps its case on the
 * awaiting-confirmation worklist. So "Record applicant response" is its own block rather than a third branch of
 * the withdraw/close chain, and it is offered on `confirmation.awaiting` alone. Presentation again, not
 * enforcement: api answers 409 for an unasked or an already-answered recording.
 */
import { buildReferralDetail, findDeedPoll, findReferral, type ReferralConfirmationView } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { casePath } from "../../../../case-path.js";
import { pathSegment } from "../../../../path-segment.js";

/** What `withdraw.ts` redirects back with when api refused the withdrawal. */
const WITHDRAW_CONFLICT = "conflict";

/** What `close.ts` redirects back with once api has closed the referral. */
const CLOSE_ACTIONED = "actioned";

/** And when api refused the closure, because somebody or something got to the referral first. */
const CLOSE_CONFLICT = "conflict";

/** What `confirmation.ts` redirects back with once api has recorded the applicant's answer. */
const CONFIRMATION_RECORDED = "recorded";

/** And when api refused it — a second answer, or a referral nobody asked. */
const CONFIRMATION_CONFLICT = "conflict";

const en = {
  title: "Referral to the judiciary",
  heading: "Referral to the judiciary",
  referralHeading: "Referral",
  // Decision 3: "Referral status" and not "Status". The case header carries a `DeedPollState` of its own and a
  // direction does not decide it, so an unqualified "Status" on a referral invites reading one as the other.
  stateLabel: "Referral status",
  reasonsLabel: "Reasons",
  notesLabel: "Notes",
  urgencyLabel: "Urgency",
  urgencyReasonLabel: "Reason for urgency",
  progressHeading: "Progress",
  createdLabel: "Raised",
  claimedLabel: "Claimed by the judiciary",
  modifiedLabel: "Last updated",
  // Decision 9: a migrated referral carries no reasons because the previous system recorded none. Saying so
  // is the difference between an explained gap and one that reads as a fault.
  migratedReasons: "Migrated from the previous system",
  // api requires at least one reason on a create, so this is only reachable for a row corrected behind its
  // back. It states what is true of the data rather than claiming the referral was migrated.
  noneRecorded: "None recorded.",
  directionHeading: "Direction from the judiciary",
  decisionLabel: "Decision",
  directionsLabel: "Directions",
  gazetteLabel: "Published in the Gazette",
  decidedByLabel: "Decided by",
  decidedLabel: "Decision date",
  yes: "Yes",
  no: "No",
  // The third state of api's nullish `publishToGazette`, said rather than collapsed into "No": a direction it
  // recorded no answer for must not read as one directed against publication.
  gazetteNotRecorded: "Not recorded",
  withdraw: "Withdraw this referral",
  withdrawHint: "Withdrawing takes the case back from the judiciary. You can refer it again afterwards.",
  markActioned: "Mark direction as actioned",
  // Decision 3: the referral is actioned by the caseworker, not by the state machine. The direction does not
  // move the application on — they make the updates it calls for and then say they have.
  markActionedHint: "Carry out the direction and make any updates the application needs, then mark this referral as actioned.",
  backToCase: "Back to case",
  errorSummaryTitle: "There is a problem",
  // api's refusal of a withdrawal, in the caseworker's terms — and **two sentences, because api has two**
  // (api-4). Reached by a redirect from the withdraw route, so the page that owns this wording is the page
  // that shows it, and the state beside it is the fresh one api has just published.
  withdrawRefusedTerminal: "This referral has already been closed or withdrawn.",
  // The one that must not borrow the sentence above: a caseworker looking at a returned direction would read
  // "already withdrawn" as their own doing. It points at the control that does apply instead.
  withdrawRefusedDecided: "A direction has been recorded on this referral, so it can no longer be withdrawn. Carry out the direction and mark it as actioned.",
  successTitle: "Success",
  // The closure landed, said here rather than on a page of its own: the referral is where the closed state and
  // the preserved direction are, and a confirmation page showing neither would be a screen to click past.
  directionActioned: "The direction has been marked as actioned.",
  // api's refusal of a closure, in the two forms a caseworker can reach. The likely one by far: two caseworkers
  // on the same returned direction, one a moment behind.
  closeRefusedClosed: "This referral has already been marked as actioned.",
  // Everything else api refuses a closure for — withdrawn, back with the judiciary, or a state this app cannot
  // read. It claims nothing about which, because the fresh status beside it says.
  closeRefusedChanged: "This referral is no longer waiting for a direction to be actioned, so it could not be marked as actioned.",
  confirmationHeading: "Applicant's confirmation",
  confirmationRequestedLabel: "Confirmation requested",
  confirmationResponseLabel: "Applicant's response",
  // While api holds a request and no answer. Not "None" and not a blank cell: the applicant may well have
  // replied, and what this page knows is only that nobody has recorded it yet.
  awaitingResponse: "Not yet recorded",
  // api stamps `confirmationReceivedAt` from its own clock when a caseworker records the answer, so the label
  // must not read as the date the applicant replied — which nothing in this service holds.
  confirmationRecordedLabel: "Response recorded",
  confirmationRecordedByLabel: "Recorded by",
  recordResponse: "Record applicant response",
  // Says where the answer comes from, because it comes from a mailbox rather than from this service. Decision 8:
  // it says nothing about what happens to the case next, which is still an open business question.
  recordResponseHint: "Record what the applicant said in reply to the email asking whether they still want their deed poll enrolled.",
  // The recording landed, said on the referral the answer is now on rather than on a confirmation page of its
  // own — the same call `close.ts` makes, and for the same reason: this is where the recorded answer is.
  confirmationRecorded: "The applicant's response has been recorded.",
  // api's likely refusal by far: two caseworkers working the same worklist row. It names no colleague, as api's
  // own refusal deliberately does not — the recorder is on the referral below, where it is a fact rather than an
  // accusation.
  confirmationRefusedRecorded: "The applicant's response has already been recorded.",
  // api's other refusal. The fresh read says which this is — see `confirmationRefusal`.
  confirmationRefusedUnasked: "The applicant has not been asked whether they still want to proceed, so there is no response to record."
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  // Before the reads, so an id that cannot be linked back to is the 404 a missing referral is, not a page of bad links.
  const href = referralHref(req);
  const caller = callerFromRequest(req);
  const [found, referral] = await Promise.all([findDeedPoll(req.params.id, caller), findReferral(req.params.id, req.params.referralId, caller)]);

  const content = res.locals.locale === "cy" ? cy : en;
  const view = buildReferralDetail(referral);

  res.render("deed-polls/referral-detail", {
    case: found,
    referral: view,
    // The boolean as this page's words, resolved here because `buildDirectionView` deliberately leaves it a
    // boolean for the page's own `en`/`cy` to name — and because the three states are one decision worth
    // making somewhere testable rather than in a template ternary. Same shape as the judicial referral page.
    gazetteAnswer: gazetteAnswer(view.direction?.publishToGazette, content),
    // A refused withdrawal, rendered as a message on the referral it was refused for. Which message depends on
    // the state api has just published, so the sentence and the page agree — and so a `Decided` referral is not
    // described as one the caseworker has already withdrawn.
    withdrawRefused: req.query.withdraw === WITHDRAW_CONFLICT ? withdrawRefusal(view.canClose, content) : "",
    // A closure that landed, as a success banner above the state it produced.
    directionActioned: req.query.close === CLOSE_ACTIONED ? content.directionActioned : "",
    // And one api refused, keyed on the state it published instead — see `closeRefusal`.
    closeRefused: req.query.close === CLOSE_CONFLICT ? closeRefusal(referral.state, content) : "",
    // The applicant's answer, the same three shapes as the closure above: recorded, refused, or neither. The
    // outcome itself is in the section below and comes off the fresh read, so the banner announces and the
    // summary states — nothing here retransmits what was submitted.
    confirmationAnswer: confirmationAnswer(view.confirmation, content),
    confirmationRecorded: req.query.confirmation === CONFIRMATION_RECORDED ? content.confirmationRecorded : "",
    confirmationRefused: req.query.confirmation === CONFIRMATION_CONFLICT ? confirmationRefusal(view.confirmation, content) : "",
    // Stated by the page that offers the control, rather than assembled from fragments in the template.
    closeHref: `${href}/close`,
    confirmationHref: `${href}/confirmation`,
    en,
    cy
  });
};

/**
 * Which of api's two withdrawal refusals this is.
 *
 * Keyed on `canClose` rather than on the wire state, because the two answers are the same question: `canClose`
 * is exactly `Decided`, and it is also what puts "Mark direction as actioned" on the page below. So the
 * message names the control the caseworker can see, and the pair cannot drift apart.
 */
function withdrawRefusal(canClose: boolean, content: typeof en): string {
  return canClose ? content.withdrawRefusedDecided : content.withdrawRefusedTerminal;
}

/**
 * Which of api's closure refusals this is.
 *
 * **Keyed on the state api has just published, unlike `withdrawRefusal`.** That one keys on a capability because
 * its two answers name the two controls this page offers; a refused closure offers nothing — `Closed` and
 * `Withdrawn` both end the referral — so there is no capability that tells them apart. The distinction worth
 * making is the likely race from the rest: a caseworker whose colleague marked the same direction actioned a
 * moment earlier should be told that, not that the status "changed".
 */
function closeRefusal(state: string | null | undefined, content: typeof en): string {
  return state === "Closed" ? content.closeRefusedClosed : content.closeRefusedChanged;
}

/**
 * The Gazette direction in words — three answers, because api's `publishToGazette` is nullish.
 *
 * A direction with no recorded answer says so (decision 4). Collapsing `null` onto "No" would assert the judge
 * directed against publication, which is a claim api never made.
 */
function gazetteAnswer(publishToGazette: boolean | null | undefined, content: typeof en): string {
  if (publishToGazette === true) return content.yes;
  if (publishToGazette === false) return content.no;

  return content.gazetteNotRecorded;
}

/**
 * What the applicant said, or that nobody has recorded it yet.
 *
 * `confirmation.outcome` is the domain's label — one map for the radios and the recorded answer, so a caseworker
 * reads back the sentence they ticked (`CONFIRMATION_OUTCOME_LABEL`). Resolved here rather than in the template
 * only because the waiting case needs this page's words; an empty string is unreachable in the render, since the
 * whole section is absent on a referral that was never asked.
 */
function confirmationAnswer(confirmation: ReferralConfirmationView | null, content: typeof en): string {
  if (!confirmation) return "";

  return confirmation.outcome ?? content.awaitingResponse;
}

/**
 * Which of api's two confirmation refusals this is, keyed on the referral as api has just published it.
 *
 * api checks already-recorded **before** never-asked, and both refusals are distinguishable only by their prose
 * — which this app must not parse. So the fresh read decides, and it can say more than the message could: an
 * outcome on the referral is the race worth naming (a colleague on the same worklist row), and its absence means
 * nobody asked the applicant at all.
 *
 * **There is no third branch for a referral still waiting**, because a 409 cannot mean that: api refuses only a
 * recorded answer or an unasked referral, and nothing clears a recorded one. A sentence for that state would
 * describe something api does not do.
 */
function confirmationRefusal(confirmation: ReferralConfirmationView | null, content: typeof en): string {
  return confirmation?.outcome ? content.confirmationRefusedRecorded : content.confirmationRefusedUnasked;
}

function referralHref(req: Request): string {
  return `${casePath(req.params.id)}/referrals/${pathSegment(req.params.referralId, "Referral id")}`;
}
