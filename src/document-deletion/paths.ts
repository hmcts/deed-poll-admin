/**
 * The document deletion journey's addresses, each id encoded once through `casePath` or `pathSegment` (see "Redirect
 * paths" in CLAUDE.md). Every one is under its case, because api addresses a document and its deletion request under
 * the case, and the way back is always the case's own Documents tab, built here and never received.
 */
import { casePath } from "../case-path.js";
import { pathSegment } from "../path-segment.js";

const DOCUMENTS_SECTION = "#documents";

export function documentDeletionConfirmationPath(caseId: string, documentId: string): string {
  return `${casePath(caseId)}/documents/${pathSegment(documentId, "Document id")}/delete`;
}

export function documentDeletionStatusPath(caseId: string, requestId: string): string {
  return `${casePath(caseId)}/document-deletions/${pathSegment(requestId, "Document deletion request id")}`;
}

export function caseDocumentsPath(caseId: string): string {
  return `${casePath(caseId)}${DOCUMENTS_SECTION}`;
}

/** Where a completed deletion lands: the Documents tab, with the case page's "Document deleted" banner. */
export function documentDeletedPath(caseId: string): string {
  return `${casePath(caseId)}?document=deleted${DOCUMENTS_SECTION}`;
}
