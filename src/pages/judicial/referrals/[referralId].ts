/**
 * One referral as the judge who may see it reads it: the referral, the narrow application view, and the
 * application's timeline.
 *
 * **One call, and no second one is available even in principle.** api answers all three panels in one payload
 * (`JudicialReferralDetail` carries `application` and `caseNotes`), so re-reading either would be a round trip
 * for an answer already held — and there is no judicial route to read them from. There is also no case id to
 * read one with: api keys the whole judicial surface on the referral (`referrals-api-3` decision 2), so this
 * page cannot fetch the case even if a future field made it look worth doing.
 *
 * **It renders exactly what api sent.** The application is `JudicialCaseView` — a reference, a type and both
 * names — and the disclosure boundary that keeps a fee or an audit trail off this screen is api's own, not a
 * filter here (`referrals-admin-3` decision 4, and api-3 flag 1 as Steve confirmed it on 2026-09-17). Nothing
 * is added, nothing is enriched, and the notes are read-only: a judge's writes are exactly claim and direct.
 *
 * **A 404 is "no longer available" and never "somebody else has it."** api's visibility answers 404
 * identically for a referral that was withdrawn, closed, claimed by another judge, or never existed
 * (decision 10) — so this page renders one sentence for all four, on a 404 of its own rather than the shared
 * "Page not found": a stale link from a pool that has moved on is the commonest way to arrive here, and it is
 * not a mistyped URL. Naming the cause would enumerate exactly what api's shared 404 exists to hide.
 */
import { buildJudicialReferral, getReferral, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

const POOL_PATH = "/judicial/referrals";

const en = {
  title: "Referral to the judiciary",
  heading: "Referral to the judiciary",
  applicationHeading: "Application",
  referenceLabel: "Reference",
  typeLabel: "Application type",
  oldNameLabel: "Current name",
  newNameLabel: "New name",
  // Shown when api sent no application on the referral. A shape its DTO permits rather than a state anyone
  // expects, so it says what is true — the details were not sent — instead of showing four placeholders,
  // which would read as an application whose applicant has no name.
  applicationMissing: "The application details were not returned with this referral.",
  referralHeading: "Referral",
  stateLabel: "Status",
  reasonsLabel: "Reasons for referral",
  notesLabel: "Notes from the court",
  urgencyLabel: "Urgency",
  urgencyReasonLabel: "Reason for urgency",
  waitingLabel: "Waiting since",
  claimedLabel: "Claimed",
  noneRecorded: "None recorded.",
  directionHeading: "Direction recorded",
  decisionLabel: "Decision",
  directionsLabel: "Directions",
  gazetteLabel: "Published in the Gazette",
  decidedLabel: "Recorded",
  yes: "Yes",
  no: "No",
  timelineHeading: "Case notes",
  // The timeline is the office's record of the application, read-only here. Said rather than left blank,
  // because an application with no notes and a notes panel that failed to arrive must not look alike.
  timelineEmpty: "There are no notes on this application.",
  claim: "Claim this referral",
  // States what claiming commits the judge to, because it takes the referral out of a shared pool: the next
  // judge to look will not see it.
  claimHint: "Claiming takes this referral out of the shared list so you can record a direction on it.",
  direct: "Record a direction",
  backToPool: "Back to referrals"
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
  // why it says nothing about who holds the referral or whether it ever existed.
  body: "It may have been withdrawn, or it may already be with another judge. Choose another referral from the list.",
  backToPool: "Back to referrals"
};

const unavailableCy = { ...unavailableEn };

export const GET = async (req: Request, res: Response) => {
  const { referralId } = req.params;

  let referral: Awaited<ReturnType<typeof getReferral>>;
  try {
    referral = await getReferral(referralId, callerFromRequest(req));
  } catch (error) {
    // Only the 404 is this page's to render: every other failure is a fault and belongs on the 500 page,
    // and a `ForbiddenError` here would mean the role gate let someone through that api then refused.
    if (!(error instanceof NotFoundError)) throw error;

    // 404 with the status as well as the wording. A judge following a link from a pool that has moved on is
    // not looking at a page that never existed, but the resource is genuinely gone and a 200 would say the
    // page rendered what was asked for.
    return res.status(404).render("judicial/referrals/unavailable", { poolPath: POOL_PATH, en: unavailableEn, cy: unavailableCy });
  }

  res.render("judicial/referrals/referral", {
    referral: buildJudicialReferral(referral),
    // Both built here rather than in the template, so the one path shape lives in one place — and so the
    // direction page's URL is stated by the page that offers it rather than assembled from fragments.
    claimHref: `${POOL_PATH}/${encodeURIComponent(referralId)}/claim`,
    directionHref: `${POOL_PATH}/${encodeURIComponent(referralId)}/direction`,
    poolPath: POOL_PATH,
    en,
    cy
  });
};
