/**
 * Stream a document's stored file back as an attachment, ported from `@Get(':id/file')`.
 *
 * The only route in the service that does not answer JSON, so it is the only one that sets its own
 * headers and writes the body itself.
 *
 * **The filename is no longer built here, and the sanitising went with it.** It used to reduce
 * `originalName` to a safe character set, because that name was whatever the uploading client called
 * the file and reached this line as attacker-controlled text on a response header — a newline in it
 * produced an invalid header, which Node rejects by throwing mid-response. `deed-poll-api` composes the
 * `Content-Disposition` now, so what is forwarded is a header a server produced rather than a name a
 * client chose, and re-deriving one would be a second opinion about what the file is called.
 *
 * The body is api's response stream, piped rather than buffered: a scanned deed poll is megabytes and
 * this route's job is to forward them. The adapter has already turned it into a Node stream, so this
 * file does not know that `fetch` produces a different flavour.
 *
 * Errors after the first byte cannot become a status code: `errorHandler` checks `res.headersSent` and
 * hands back to Express, which destroys the connection. That is the correct outcome — a truncated
 * download is visible to the client, whereas a 200 with half a file is not — and it is why the stream's
 * own `error` event is forwarded to `next` rather than ignored.
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

  // Without this a mid-stream failure (api restarted under us, a connection reset) leaves the request
  // hanging until it times out, because nothing else is listening for it.
  download.body.on("error", next);
  download.body.pipe(res);
};
