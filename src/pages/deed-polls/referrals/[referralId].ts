/**
 * The check view of one queued referral (plan Fa1): what a Team leader or Delivery Manager reads before choosing a
 * Master. Read-only, with no form; sending happens from the queue.
 *
 * The case id arrives as `?case=` from the queue row (`../../../referral-queue/paths.ts`), because api addresses a
 * referral under its case. A missing one is the 404 a mistyped URL is, and api answers 404 for a referral that is not
 * under the case named, so nothing here checks that.
 *
 * **Three reads, all load-bearing**: the referral is what is being checked, and the application's General rows need the
 * case and its field rules, exactly as the case page's General section does. The rules hang off the case, so they
 * start the moment it resolves.
 */
import {
  buildDetailTabs,
  buildDocumentsView,
  build as buildPresentation,
  buildReferralDetail,
  DOCUMENT_COLUMNS,
  findDeedPoll,
  findReferral,
  getCaseFieldRules,
  NotFoundError
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../../../auth/current-user.js";
import { caseViewerScope, documentPaths } from "../../../document-viewer/context.js";
import { queueReferralPath, REFERRAL_QUEUE_PATH } from "../../../referral-queue/paths.js";

/** The case page's tab and section whose rows this page repeats. */
const APPLICATION_TAB = "application";
const GENERAL_SECTION = "General";

const en = {
  title: "Check referral",
  heading: "Check referral",
  back: "Back to referrals",
  referralHeading: "Referral",
  status: "Status",
  reasons: "Reasons",
  urgency: "Urgency",
  urgencyReason: "Reason for urgency",
  notes: "Notes",
  raisedBy: "Raised by",
  raisedOn: "Raised on",
  migrated: "Migrated from the previous system",
  applicationHeading: "Application",
  documentsHeading: "Supporting documents",
  documentColumns: DOCUMENT_COLUMNS,
  noneRecorded: "None recorded.",
  bannerTitle: "Important"
};

// The page's Welsh is pending, as the queue's is.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const caseId = typeof req.query.case === "string" ? req.query.case : "";
  // Built before any read, so an unusable id or a missing case is refused with nothing sent.
  if (caseId === "") throw new NotFoundError("Referral queue check view has no case");
  queueReferralPath(req.params.referralId, caseId);
  const scope = caseViewerScope(caseId);

  const caller = callerFromRequest(req);
  const caseRead = findDeedPoll(caseId, caller);
  const rulesRead = caseRead.then((found) =>
    getCaseFieldRules({ type: found.type, migrated: found.migratedRecord === true, publishToGazette: found.publishToLondonGazette !== false }, caller)
  );
  const [referral, found, rules] = await Promise.all([findReferral(caseId, req.params.referralId, caller), caseRead, rulesRead]);

  const presentation = buildPresentation(
    { type: found.type, privacy: found.privacy, state: found.state },
    { isAdmin: userFromRequest(req).isAdmin, isNew: false }
  );
  const general = buildDetailTabs(found as unknown as Record<string, unknown>, rules, presentation)
    .find((tab) => tab.id === APPLICATION_TAB)
    ?.sections.find((section) => section.label === GENERAL_SECTION);

  res.render("deed-polls/referrals/check", {
    en,
    cy,
    pageCaption: found.displayReference,
    backHref: REFERRAL_QUEUE_PATH,
    privacyBanner: presentation.privacy.showBanner ? presentation.privacy.bannerText : "",
    referral: buildReferralDetail(referral),
    generalRows: general?.rows ?? [],
    documents: buildDocumentsView(found.documents).map((document) => ({ ...document, viewHref: documentPaths(scope, document.id).viewPath }))
  });
};
