/**
 * The document viewer's URLs: the scoped view, preview and original-download paths of each document, and the fixed
 * way back to the case or referral.
 *
 * Two scopes and no generic document URL. A case's documents live under `casePath`, a referral's under
 * `referralPath`, so a judicial URL never carries a case id and neither scope can name the other's documents. Every
 * id goes through `pathSegment` once, from the value Express or api gave, so a `/`, `?` or `#` in an id stays inside
 * its segment.
 *
 * **The return path is built, never received.** There is no `returnTo`: the way back is the scope's own page at its
 * documents section, so a forged query string cannot send a reader anywhere else.
 *
 * Call {@link caseViewerScope} or {@link referralViewerScope}, then {@link documentPaths} for the requested document,
 * **before any api read**, so an empty, `.` or `..` id is refused with nothing sent.
 */
import type { DocumentViewerContext, ViewerDocument } from "@hmcts/deed-poll";
import { casePath } from "../case-path.js";
import { referralPath } from "../judicial-referral-path.js";
import { pathSegment } from "../path-segment.js";

const DOCUMENTS_SECTION = "#documents";

export function caseViewerScope(caseId: string): ViewerScope {
  return scopeAt(casePath(caseId));
}

export function referralViewerScope(referralId: string): ViewerScope {
  return scopeAt(referralPath(referralId));
}

export function documentPaths(scope: ViewerScope, documentId: string): DocumentPaths {
  const documentPath = `${scope.basePath}/documents/${pathSegment(documentId, "Document id")}`;

  return { viewPath: `${documentPath}/view`, previewPath: `${documentPath}/preview`, downloadPath: `${documentPath}/download` };
}

/** The context with every path the page renders, built from the scope that was read. */
export function viewerLinks(scope: ViewerScope, context: DocumentViewerContext): ViewerLinks {
  return {
    returnPath: scope.returnPath,
    current: withPaths(scope, context.current),
    documents: context.documents.map((document) => ({ ...withPaths(scope, document), isCurrent: document.id === context.current.id })),
    previousPath: context.previous ? documentPaths(scope, context.previous.id).viewPath : null,
    nextPath: context.next ? documentPaths(scope, context.next.id).viewPath : null
  };
}

function scopeAt(basePath: string): ViewerScope {
  return { basePath, returnPath: `${basePath}${DOCUMENTS_SECTION}` };
}

function withPaths(scope: ViewerScope, document: ViewerDocument): LinkedDocument {
  return { ...document, ...documentPaths(scope, document.id) };
}

export interface ViewerScope {
  /** The case or referral page, already encoded. */
  basePath: string;
  returnPath: string;
}

export interface DocumentPaths {
  viewPath: string;
  previewPath: string;
  downloadPath: string;
}

export interface LinkedDocument extends ViewerDocument, DocumentPaths {}

export interface ViewerLinks {
  returnPath: string;
  current: LinkedDocument;
  documents: (LinkedDocument & { isCurrent: boolean })[];
  previousPath: string | null;
  nextPath: string | null;
}
