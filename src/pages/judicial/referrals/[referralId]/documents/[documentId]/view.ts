/**
 * A referral's document in the full-page viewer, inside the referral's own context and never a case's.
 *
 * The referral read supplies the selector from `application.documents`, the title and the way back. A referral api
 * will not show is the existing "no longer available" page, true of every cause api's one 404 covers. A document
 * that is not on a referral the judge can see is the shared 404 instead: that is a missing document, and saying the
 * referral had gone would be false.
 */
import { buildReferralViewerContext, getReferral, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../../auth/current-user.js";
import { cy, en } from "../../../../../../document-viewer/content.js";
import { documentPaths, referralViewerScope } from "../../../../../../document-viewer/context.js";
import { showViewer } from "../../../../../../document-viewer/page.js";

const POOL_PATH = "/judicial/referrals";

export const GET = async (req: Request, res: Response) => {
  const { referralId, documentId } = req.params;
  const scope = referralViewerScope(referralId);
  documentPaths(scope, documentId);

  let referral: Awaited<ReturnType<typeof getReferral>>;
  try {
    referral = await getReferral(referralId, callerFromRequest(req));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;

    return res.status(404).render("judicial/referrals/unavailable", { poolPath: POOL_PATH, en: en.referralUnavailable, cy: cy.referralUnavailable });
  }

  showViewer(req, res, scope, buildReferralViewerContext(referral, documentId));
};
