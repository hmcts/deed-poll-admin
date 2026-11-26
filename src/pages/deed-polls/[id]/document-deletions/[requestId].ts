/**
 * A document deletion request's progress (plan `20261125-permanent-document-deletion.md`, journey step 6), reached
 * only when api answered 202 or the confirmation's recovery found the request still in api's hands. Any staff user
 * reaches it, as they reach the confirmation; api answers the read under the case.
 *
 * **It reads only the request** (`findDocumentDeletion`), so it still answers once the document is gone, and it never
 * reads the case or the document. A 404 is the not-found page, a 401 or 403 the existing flows and a 429 the shared
 * 429 page; any other failure is a page that says progress could not be checked, which is not a claim about the
 * request. Only `Completed` is headed as a deletion. Refresh is a link back to this read; there is no control to delete
 * again, resend or restore.
 */
import { ForbiddenError, findDocumentDeletion, formatTimestamp, NotFoundError, TooManyRequestsError, UnauthorizedError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { caseDocumentsPath, documentDeletionStatusPath } from "../../../../document-deletion/paths.js";
import { forLog } from "../../../../for-log.js";

const VIEW = "deed-polls/document-deletion-status";

const en = {
  InProgressHeading: "Document deletion in progress",
  NeedsAttentionHeading: "Document deletion has not completed",
  CompletedHeading: "Document deleted",
  unavailableHeading: "We could not check this document deletion",
  InProgress: "The document is being deleted. The service will finish this without you doing anything. Refresh the page to check.",
  NeedsAttention:
    "The deletion has not completed and needs investigation. Do not ask for this document to be deleted again. Contact the service support team and give them the request reference below.",
  Completed: "The document has been permanently deleted. The reason has been recorded in the audit trail and as a case note.",
  unavailable: "The progress of this deletion request could not be checked. This does not change the request. Refresh the page to try again.",
  requestLabel: "Request reference",
  requestedLabel: "Requested",
  completedLabel: "Deleted",
  refresh: "Refresh",
  back: "Return to the application’s documents"
};

// English content in the cy shape: awaiting translation, so `yarn welsh:check` and the translation request list it.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const { id, requestId } = req.params;
  // Built before any read, so an unusable id is the 404 it would be anyway.
  const statusPath = documentDeletionStatusPath(id, requestId);
  const content = res.locals.locale === "cy" ? cy : en;
  const shared = { en, cy, statusPath, documentsPath: caseDocumentsPath(id) };

  let request: Awaited<ReturnType<typeof findDocumentDeletion>>;
  try {
    request = await findDocumentDeletion(id, requestId, callerFromRequest(req));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof UnauthorizedError || error instanceof TooManyRequestsError)
      throw error;
    console.error(`document deletion status unavailable: ${forLog(error instanceof Error ? error.message : String(error))}`);
    return res.status(503).render(VIEW, { ...shared, progress: "unavailable", heading: content.unavailableHeading, title: content.unavailableHeading });
  }

  const heading = content[`${request.status}Heading`];
  return res.render(VIEW, {
    ...shared,
    progress: request.status,
    heading,
    title: heading,
    sentence: content[request.status],
    rows: [
      { key: content.requestLabel, value: request.requestId },
      { key: content.requestedLabel, value: formatTimestamp(request.requestedAt) },
      ...(request.status === "Completed" && request.completedAt ? [{ key: content.completedLabel, value: formatTimestamp(request.completedAt) }] : [])
    ]
  });
};
