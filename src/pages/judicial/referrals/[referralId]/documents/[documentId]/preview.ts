/**
 * A referral document's preview, keyed on the referral and relayed under the viewer's own containment.
 *
 * api applies the download's visibility to it. A 404 is the document being unavailable, not the referral being gone,
 * so it never renders the "no longer available" page: see `src/document-viewer/preview-response.ts`.
 */
import { previewReferralDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../../auth/current-user.js";
import { documentPaths, referralViewerScope } from "../../../../../../document-viewer/context.js";
import { relayPreview } from "../../../../../../document-viewer/preview-response.js";

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const { referralId, documentId } = req.params;
  documentPaths(referralViewerScope(referralId), documentId);
  const caller = callerFromRequest(req);

  await relayPreview(res, next, (signal) => previewReferralDocument(referralId, documentId, caller, signal));
};
