/**
 * A case document's preview, the PDF the viewer renders, relayed under the viewer's own containment.
 *
 * api's preview operation and never the download, because api audits the two differently. No case read first:
 * api checks the document is the case's. What a refusal or a 404 answers is `src/document-viewer/preview-response.ts`'s.
 */
import { previewDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { caseViewerScope, documentPaths } from "../../../../../document-viewer/context.js";
import { relayPreview } from "../../../../../document-viewer/preview-response.js";

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const { id, documentId } = req.params;
  documentPaths(caseViewerScope(id), documentId);
  const caller = callerFromRequest(req);

  await relayPreview(res, next, (signal) => previewDocument(id, documentId, caller, signal));
};
