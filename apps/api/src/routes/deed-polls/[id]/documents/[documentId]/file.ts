/**
 * Stream a document's stored file back as an attachment, ported from `@Get(':id/file')`.
 *
 * The only route in the service that does not answer JSON, so it is the only one that sets its own
 * headers and writes the body itself.
 *
 * **The filename is sanitised, not just de-quoted.** `originalName` is whatever the uploading
 * client called the file, so it reaches here as attacker-controlled text on a response header. The
 * prototype stripped `"` and nothing else; a name containing a newline would have produced an
 * invalid header, which Node rejects by throwing mid-response — a 500 on a working download. Only
 * a conservative character set is kept, and a name left empty by that is replaced.
 *
 * Errors after the first byte cannot become a status code: `errorHandler` checks `res.headersSent`
 * and hands back to Express, which destroys the connection. That is the correct outcome — a
 * truncated download is visible to the client, whereas a 200 with half a file is not — and it is
 * why the stream's own `error` event is forwarded to `next` rather than ignored.
 */
import { downloadDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";

const FALLBACK_FILENAME = "document";

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const { doc, stream } = await downloadDocument(req.params.id, req.params.documentId);

  res.setHeader("Content-Type", doc.mimeType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(doc.originalName ?? doc.name)}"`);
  // Documents are case data; a shared cache must not keep a copy.
  res.setHeader("Cache-Control", "no-store");

  // Without this a mid-stream failure (the blob removed under us, a disk error) leaves the request
  // hanging until it times out, because nothing else is listening for it.
  stream.on("error", next);
  stream.pipe(res);
};

/**
 * Reduce a filename to characters that are safe in a quoted header value: letters, digits, and a
 * few separators. Anything else — quotes, backslashes, control characters, non-ASCII — is dropped
 * rather than escaped, because the name is a convenience for the browser's save dialog and is not
 * load-bearing. `Content-Disposition` supports RFC 5987 `filename*` for full Unicode; that is
 * worth adding when a real filename is shown to be mangled, not before.
 */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "").trim();
  return cleaned.length > 0 ? cleaned : FALLBACK_FILENAME;
}
