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
 * **Withdraw is offered only on a referral that is not terminal, and api still decides.** `terminal` is the
 * one state rule this repo keeps (`referrals-view.ts`) and it governs a button's visibility, nothing more: the
 * refusal itself is api's 409. A referral closed or withdrawn in another session between this render and the
 * click therefore lands on that 409, which is what the message below is for — and why the withdraw route
 * sends the caseworker back here rather than to an error page.
 */
import { buildReferralDetail, findDeedPoll, findReferral } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

/** What `withdraw.ts` redirects back with when api refused the withdrawal. */
const WITHDRAW_CONFLICT = "conflict";

const en = {
  title: "Referral to the judiciary",
  heading: "Referral to the judiciary",
  stateLabel: "Status",
  reasonsLabel: "Reasons",
  notesLabel: "Notes",
  urgencyLabel: "Urgency",
  urgencyReasonLabel: "Reason for urgency",
  createdLabel: "Raised",
  modifiedLabel: "Last updated",
  // Decision 9: a migrated referral carries no reasons because the previous system recorded none. Saying so
  // is the difference between an explained gap and one that reads as a fault.
  migratedReasons: "Migrated from the previous system",
  // api requires at least one reason on a create, so this is only reachable for a row corrected behind its
  // back. It states what is true of the data rather than claiming the referral was migrated.
  noneRecorded: "None recorded.",
  withdraw: "Withdraw this referral",
  withdrawHint: "Withdrawing takes the case back from the judiciary. You can refer it again afterwards.",
  backToCase: "Back to case",
  errorSummaryTitle: "There is a problem",
  // Decision 6: the second of api's two 409s, in the caseworker's terms. Reached by a redirect from the
  // withdraw route, so the page that owns this wording is the page that shows it.
  alreadyClosed: "This referral has already been closed or withdrawn."
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const caller = callerFromRequest(req);
  const [found, referral] = await Promise.all([findDeedPoll(req.params.id, caller), findReferral(req.params.id, req.params.referralId, caller)]);

  res.render("deed-polls/referral-detail", {
    case: found,
    referral: buildReferralDetail(referral),
    // A refused withdrawal, rendered as a message on the referral it was refused for. The state shown
    // alongside it is the fresh one api just published, so the message and the page agree.
    withdrawRefused: req.query.withdraw === WITHDRAW_CONFLICT,
    en,
    cy
  });
};
