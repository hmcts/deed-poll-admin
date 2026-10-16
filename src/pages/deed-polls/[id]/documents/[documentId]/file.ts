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
 * **Content headers travel with their containment policy; nosniff is enforced here too.** api serves
 * PDFs, JPEGs and PNGs `inline` rather than as attachments, and a PDF viewer executes script embedded in
 * the document — so api pairs that disposition with `Content-Security-Policy: default-src 'none';
 * sandbox` and `X-Content-Type-Options: nosniff`. Forwarding `Content-Disposition` alone would render a
 * member of the public's upload in this origin under the app's own `default-src 'self'`, which is
 * strictly worse than either honouring api's whole answer or overriding it to `attachment`.
 */
import { pipeline } from "node:stream";
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
  res.setHeader("Content-Disposition", containedDisposition(download.contentDisposition, download.contentSecurityPolicy));
  if (download.contentSecurityPolicy) res.setHeader("Content-Security-Policy", download.contentSecurityPolicy);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Documents are case data; a shared cache must not keep a copy.
  res.setHeader("Cache-Control", "no-store");

  // `pipeline` rather than `pipe`: a caseworker cancelling a large scan closes the response, and `pipe`
  // leaves api's body unread and uncancelled, so undici holds that connection out of its pool. It also
  // forwards a mid-stream failure, without which the request hangs until it times out.
  pipeline(download.body, res, (error) => {
    if (error) next(error);
  });
};

/**
 * api's disposition, but never `inline` without the policy that makes an inline render safe.
 *
 * The two headers are one decision — see the note at the top of this file. api pairs them today, so this
 * only bites if that stops being true: a proxy stripping or replacing response headers, or an api build
 * that serves `inline` under a policy that no longer contains anything. Downgrading to a download is the
 * containment that survives either, and the filename is kept because that part of api's answer was never
 * the hazard.
 */
function containedDisposition(disposition: string | null, contentSecurityPolicy: string | null): string {
  if (!disposition) return FALLBACK_DISPOSITION;

  const [type, ...params] = disposition.split(";");
  if (type.trim().toLowerCase() === "attachment" || isInertPolicy(contentSecurityPolicy)) return disposition;

  return ["attachment", ...params].join(";");
}

/**
 * Whether the forwarded policy actually neuters an inline render, rather than merely being present.
 *
 * The presence of *a* `Content-Security-Policy` is not the same fact as the presence of an inert one, and
 * line 41 forwards whatever arrives as this origin's policy for the response — so a header a proxy or a
 * loosened api build supplied would otherwise both satisfy the check and replace helmet's own
 * `default-src 'self'` with something weaker. `sandbox` is the directive doing the work: it drops the
 * response into a unique origin with scripting off, which is what makes rendering a member of the public's
 * PDF in place defensible. `allow-scripts` gives that back, so a sandbox carrying it is not one.
 *
 * **Every `sandbox` in the policy has to be inert, not merely one of them.** A browser resolves a repeated
 * directive to its FIRST occurrence and ignores the rest, so `sandbox allow-scripts; sandbox` renders with
 * scripting ON — while a check asking whether *some* sandbox is inert finds the trailing bare one and
 * passes. Line 41 then forwards that same policy as this response's own, so such a header would defeat the
 * guard and replace helmet's `default-src 'self'` in one move. Requiring all of them closes that gap
 * without this function having to reimplement the precedence rule it would otherwise depend on.
 */
function isInertPolicy(contentSecurityPolicy: string | null): boolean {
  if (!contentSecurityPolicy) return false;

  const sandboxes = contentSecurityPolicy
    .split(";")
    .map((directive) => directive.trim().toLowerCase().split(/\s+/))
    .filter(([name]) => name === "sandbox");

  return sandboxes.length > 0 && sandboxes.every(([, ...tokens]) => !tokens.includes("allow-scripts"));
}
