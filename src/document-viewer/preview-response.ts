/**
 * Relay a document's preview to the viewer's renderer, or say in one fixed code why there is none.
 *
 * **A preview is never a document of this origin.** It is a PDF built from a member of the public's upload, and a
 * browser PDF viewer runs script embedded in one, so whatever api sent, the relay answers with its own fixed
 * containment: an attachment (the renderer fetches the bytes, so the disposition only matters to someone who opens
 * the URL directly), `default-src 'none'; sandbox`, `nosniff` and `no-store`. Nothing of api's disposition or policy
 * is forwarded, so neither can loosen it.
 *
 * **A failure here is the document's, not the case's or the referral's.** The renderer reads the status and the
 * code and shows its own sentence beside a working **Download original**:
 *
 * - api's four preview refusals keep api's status and code (`PREVIEW_BUSY` with its `Retry-After`).
 * - A 404 is `DOCUMENT_UNAVAILABLE` on both scopes. On the judicial one in particular it is not the "referral no
 *   longer available" page: api answers one 404 for a missing file as for a lost referral, and the viewer must not
 *   tell a judge their referral is gone because one file is.
 * - Anything else (401, 403, a timeout, api down) goes to the app's error handler, so it keeps the meaning it has
 *   everywhere else: a 401 signs the session out and a 403 is logged as a refusal.
 *
 * **The browser going away cancels the read.** The route's signal aborts when the response closes unfinished, so a
 * reader switching documents mid-fetch stops api's conversion rather than leaving it to run out its budget.
 */
import { pipeline } from "node:stream";
import { type DocumentPreview, DocumentPreviewRefusedError, NotFoundError, type PreviewRefusalCode } from "@hmcts/deed-poll";
import type { NextFunction, Response } from "express";

const PREVIEW_DISPOSITION = 'attachment; filename="preview.pdf"';
const PREVIEW_POLICY = "default-src 'none'; sandbox";
const DOCUMENT_UNAVAILABLE = "DOCUMENT_UNAVAILABLE";

const STATUS_BY_CODE: Readonly<Record<PreviewRefusalCode, number>> = {
  PREVIEW_INVALID_DOCUMENT: 422,
  PREVIEW_LIMIT_EXCEEDED: 422,
  PREVIEW_UNAVAILABLE: 503,
  PREVIEW_BUSY: 429
};

export async function relayPreview(res: Response, next: NextFunction, read: (signal: AbortSignal) => Promise<DocumentPreview>): Promise<void> {
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  let preview: DocumentPreview;
  try {
    preview = await read(controller.signal);
  } catch (error) {
    if (error instanceof DocumentPreviewRefusedError) return refuse(res, STATUS_BY_CODE[error.code], error.code, error.retryAfterSeconds);
    if (error instanceof NotFoundError) return refuse(res, 404, DOCUMENT_UNAVAILABLE, null);

    throw error;
  }

  sendPreview(preview, res, next);
}

function refuse(res: Response, status: number, code: string, retryAfterSeconds: number | null): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (retryAfterSeconds !== null) res.setHeader("Retry-After", String(retryAfterSeconds));

  res.status(status).json({ code });
}

function sendPreview(preview: DocumentPreview, res: Response, next: NextFunction): void {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", PREVIEW_DISPOSITION);
  res.setHeader("Content-Security-Policy", PREVIEW_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (preview.contentLength !== null) res.setHeader("Content-Length", String(preview.contentLength));

  // `pipeline` for `sendDocument`'s reason: a closed response destroys api's body rather than leaving it unread.
  pipeline(preview.body, res, (error) => {
    if (error) next(error);
  });
}
