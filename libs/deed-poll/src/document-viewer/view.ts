/**
 * The document viewer's context: which documents its selector offers, which one is open, and its neighbours.
 *
 * Built from the one read the page already makes, `GET /caseworker/cases/{id}` or `GET /judicial/referrals/{id}`,
 * and never from a per-document read: the selector is navigation, not authorisation. Every preview and download is
 * api's own check against the caller's token, so a document listed here can still answer 404 when its bytes are
 * fetched, and the viewer says so for that document rather than trusting this list
 * (`docs/plans/completed/20261023-full-page-document-viewer.md`, Development Approach 4).
 *
 * **api's order and api's membership.** The caseworker list is the case's documents with a file attached
 * (`hasFile`, the same fact the subgrid links on); the judicial list is `application.documents`, which api already
 * limits to readable ones. Nothing is sorted, filtered further or merged across scopes.
 *
 * **An unknown selection is refused, never substituted.** Opening the first document instead would show a judge or
 * caseworker a different file under the URL they followed. The refusal's message is fixed and names no id.
 *
 * **No case reference for a judge** (Decision 4, 2026-10-23). The judicial context has no `caseReference` to set,
 * whatever the referral carries, so the viewer cannot show one.
 *
 * Paths are not built here: a URL is the app's concern and `pathSegment` is the app's helper
 * (`src/document-viewer/context.ts`).
 */
import type { CaseDetail, Document, JudicialDocument, JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import { NOT_PROVIDED } from "../deed-poll/detail-view.js";
import { NotFoundError } from "../errors.js";

// The renderer refuses a preview over these, so the page hands it api's published numbers rather than a copy.
export { DOCUMENT_PREVIEW_LIMITS } from "@hmcts/deed-poll-api-client";

const FORMAT_BY_MIME_TYPE: ReadonlyMap<string, DocumentFormat> = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/tiff", "tiff"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"]
]);

const NOT_IN_CONTEXT = "The selected document is not one of this context's documents";

export function buildCaseViewerContext(found: CaseDetail, documentId: string): DocumentViewerContext {
  const documents = found.documents.filter((document) => document.hasFile).map(viewerDocument);

  return withSelection({ scope: "caseworker", caseReference: found.displayReference ?? null }, documents, documentId);
}

export function buildReferralViewerContext(detail: JudicialReferralDetail, documentId: string): DocumentViewerContext {
  const documents = (detail.application?.documents ?? []).map(viewerDocument);

  return withSelection({ scope: "judicial", caseReference: null }, documents, documentId);
}

/** The one document of `context` named `documentId`, or the same fixed refusal as an unknown selection. */
export function documentInContext(context: Pick<DocumentViewerContext, "documents">, documentId: string): ViewerDocument {
  const selected = context.documents.find((document) => document.id === documentId);
  if (!selected) throw new NotFoundError(NOT_IN_CONTEXT);

  return selected;
}

function viewerDocument(document: Document | JudicialDocument): ViewerDocument {
  return { id: document.id, name: document.name ?? NOT_PROVIDED, format: formatOf(document.mimeType) };
}

/** `null` for a type outside the upload allowlist, which a legacy record may carry: the viewer names no format. */
function formatOf(mimeType: string | null | undefined): DocumentFormat | null {
  return FORMAT_BY_MIME_TYPE.get(mimeType?.toLowerCase() ?? "") ?? null;
}

function withSelection(owner: Pick<DocumentViewerContext, "scope" | "caseReference">, documents: ViewerDocument[], documentId: string): DocumentViewerContext {
  const index = documents.indexOf(documentInContext({ documents }, documentId));

  return {
    ...owner,
    documents,
    current: documents[index],
    position: index + 1,
    total: documents.length,
    previous: documents[index - 1] ?? null,
    next: documents[index + 1] ?? null
  };
}

/** The five uploadable types, as keys the page names in its own `en`/`cy` copy. */
export type DocumentFormat = "pdf" | "jpeg" | "png" | "tiff" | "docx";

export interface ViewerDocument {
  id: string;
  /** api's name as stored, unescaped: the template escapes it, and it never enters a URL. */
  name: string;
  format: DocumentFormat | null;
}

export interface DocumentViewerContext {
  scope: "caseworker" | "judicial";
  /** The case's display reference for a caseworker; always `null` for a judge. */
  caseReference: string | null;
  documents: ViewerDocument[];
  current: ViewerDocument;
  /** One-based, for "Document N of M". */
  position: number;
  total: number;
  previous: ViewerDocument | null;
  next: ViewerDocument | null;
}
