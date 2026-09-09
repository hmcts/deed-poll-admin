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
 * everything substantive — the scoping, the forwarded headers, the stream error forwarding — is the
 * same, and the reasoning is recorded there, including why the filename is `deed-poll-api`'s to compose
 * rather than this route's to sanitise.
 */
import { downloadDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const download = await downloadDocument(req.params.id, req.params.documentId, callerFromRequest(req));

  res.setHeader("Content-Type", download.contentType);
  if (download.contentDisposition) res.setHeader("Content-Disposition", download.contentDisposition);
  // Documents are case data; a shared cache must not keep a copy.
  res.setHeader("Cache-Control", "no-store");

  // Without this a mid-stream failure leaves the request hanging until it times out.
  download.body.on("error", next);
  download.body.pipe(res);
};
