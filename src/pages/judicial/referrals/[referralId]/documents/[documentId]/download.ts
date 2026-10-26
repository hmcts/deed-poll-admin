/**
 * The viewer's **Download original** for a referral's document, always as an attachment. A 404 is the shared
 * "Page not found": the document is unavailable, which does not say the referral is.
 */
import { downloadReferralDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../../auth/current-user.js";
import { sendDownload } from "../../../../../../document-response.js";
import { documentPaths, referralViewerScope } from "../../../../../../document-viewer/context.js";

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const { referralId, documentId } = req.params;
  documentPaths(referralViewerScope(referralId), documentId);

  sendDownload(await downloadReferralDocument(referralId, documentId, callerFromRequest(req)), res, next);
};
