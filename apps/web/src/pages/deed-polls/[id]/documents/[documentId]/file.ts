/**
 * Serve a document's stored file to the browser.
 *
 * **Not in the prototype's twelve handlers.** Its detail template linked to
 * `/api/deed-polls/.../file`, which worked because one Nest app served both the API and the pages. The
 * link is same-origin here for the same reason: an api base URL on a page would cross an origin and
 * leave the browser's session behind, so this route asks `deed-poll-api` and forwards what comes back.
 *
 * **The filename is api's to compose and this route's to relay, not to sanitise.** api reduces the
 * uploader's original name to `[A-Za-z0-9._ -]` before building the header — a quote would break out of
 * the quoted value and a newline would make the header invalid, which Node rejects by throwing
 * mid-response. That check now runs at the only place holding the untrusted text, so repeating it here
 * would be a second opinion about a value that arrives already safe.
 *
 * **Four headers are forwarded, and the last two are the reason the first two are safe.** api serves
 * PDFs, JPEGs and PNGs `inline` rather than as attachments, and a PDF viewer executes script embedded in
 * the document — so api pairs that disposition with `Content-Security-Policy: default-src 'none';
 * sandbox` and `X-Content-Type-Options: nosniff`. Forwarding `Content-Disposition` alone would render a
 * member of the public's upload in this origin under the app's own `default-src 'self'`, which is
 * strictly worse than either honouring api's whole answer or overriding it to `attachment`.
 */
import { downloadDocument } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";

/**
 * What is sent when api names no disposition.
 *
 * The contract does not describe the header — `openapi.json` types the response as opaque binary — so an
 * api that stops sending one must not silently turn every case document into an inline render. Downloading
 * is the safe reading of an absent instruction.
 */
const FALLBACK_DISPOSITION = 'attachment; filename="document"';

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const download = await downloadDocument(req.params.id, req.params.documentId, callerFromRequest(req));

  res.setHeader("Content-Type", download.contentType);
  res.setHeader("Content-Disposition", download.contentDisposition ?? FALLBACK_DISPOSITION);
  if (download.contentSecurityPolicy) res.setHeader("Content-Security-Policy", download.contentSecurityPolicy);
  if (download.contentTypeOptions) res.setHeader("X-Content-Type-Options", download.contentTypeOptions);
  // Documents are case data; a shared cache must not keep a copy.
  res.setHeader("Cache-Control", "no-store");

  // Without this a mid-stream failure leaves the request hanging until it times out.
  download.body.on("error", next);
  download.body.pipe(res);
};
