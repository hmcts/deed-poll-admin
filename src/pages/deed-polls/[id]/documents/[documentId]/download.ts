/**
 * The viewer's **Download original** for a case document: api's original bytes and filename, always as an
 * attachment. `file.ts` beside it keeps api's inline rendering for the links that already use it.
 */
import { downloadDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { sendDownload } from "../../../../../document-response.js";
import { caseViewerScope, documentPaths } from "../../../../../document-viewer/context.js";

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const { id, documentId } = req.params;
  documentPaths(caseViewerScope(id), documentId);

  sendDownload(await downloadDocument(id, documentId, callerFromRequest(req)), res, next);
};
