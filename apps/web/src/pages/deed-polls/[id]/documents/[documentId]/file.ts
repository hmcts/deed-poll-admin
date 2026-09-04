/**
 * Serve a document's stored file to the browser.
 *
 * **Not in the prototype's twelve handlers.** Its detail template linked to
 * `/api/deed-polls/.../file`, which worked because one Nest app served both the API and the pages.
 * `apps/api` and `apps/web` are now separate apps on separate ports, so that link would need an API
 * base URL in config, would cross an origin, and would leave the browser's session behind. Both apps
 * depend on the same domain library, so serving the stream here is simpler and same-origin — which
 * is the point of the `libs/` split.
 *
 * A deliberate near-duplicate of `apps/api/src/routes/deed-polls/[id]/documents/[documentId]/file.ts`.
 * The two differ only in that the API's is reached by an API client and this by a link on a page;
 * everything substantive — the scoping, the sanitised filename, the stream error forwarding — is the
 * same, and the reasoning is recorded there.
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

  // Without this a mid-stream failure leaves the request hanging until it times out.
  stream.on("error", next);
  stream.pipe(res);
};

/**
 * Reduce a filename to characters safe in a quoted header value. `originalName` is whatever the
 * uploading client called the file, so it reaches here as attacker-controlled text on a response
 * header: a quote would break out of the quoted value, and a newline would make the header invalid,
 * which Node rejects by throwing mid-response — a 500 on a working download.
 */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "").trim();
  return cleaned.length > 0 ? cleaned : FALLBACK_FILENAME;
}
