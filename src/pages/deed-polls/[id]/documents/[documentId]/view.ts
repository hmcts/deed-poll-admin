/**
 * A case document in the full-page viewer, inside the case's own context.
 *
 * The case read supplies the selector, the title and the way back, and nothing else: it is not a permission check
 * for the preview, which api makes again against the token when the renderer asks for it. Paths are built before the
 * read, so an empty or dot-only id is refused with nothing sent. A case api will not show is the shared 404, as on
 * the case page.
 */
import { buildCaseViewerContext, findDeedPoll } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { caseViewerScope, documentPaths } from "../../../../../document-viewer/context.js";
import { showViewer } from "../../../../../document-viewer/page.js";

export const GET = async (req: Request, res: Response) => {
  const { id, documentId } = req.params;
  const scope = caseViewerScope(id);
  documentPaths(scope, documentId);

  const found = await findDeedPoll(id, callerFromRequest(req));

  showViewer(req, res, scope, buildCaseViewerContext(found, documentId));
};
