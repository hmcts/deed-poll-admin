/**
 * Serve a document's stored file to the browser.
 *
 * **Not in the prototype's twelve handlers.** Its detail template linked to
 * `/api/deed-polls/.../file`, which worked because one Nest app served both the API and the pages. The
 * link is same-origin here for the same reason: an api base URL on a page would cross an origin and
 * leave the browser's session behind, so this route asks `deed-poll-api` and forwards what comes back.
 *
 * The headers it forwards, and the containment it applies to them, are `src/document-response.ts`'s — shared
 * with the judicial download route, because api serves both with the same policy.
 */
import { downloadDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { sendDocument } from "../../../../../document-response.js";

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const download = await downloadDocument(req.params.id, req.params.documentId, callerFromRequest(req));

  sendDocument(download, res, next);
};
