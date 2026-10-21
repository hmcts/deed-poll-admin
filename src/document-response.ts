/**
 * Relay a document api has streamed back — the caseworker's and the judge's download routes both end here,
 * because api serves the two with the same headers and the same policy, and a containment rule kept in two
 * places is one that drifts.
 *
 * **The filename is api's to compose and this module's to relay, not to sanitise.** api reduces the
 * uploader's original name to `[A-Za-z0-9._ -]` before building the header — a quote would break out of
 * the quoted value and a newline would make the header invalid, which Node rejects by throwing
 * mid-response. That check runs at the only place holding the untrusted text, so repeating it here
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
import type { DocumentDownload } from "@hmcts/deed-poll";
import type { NextFunction, Response } from "express";

/**
 * What is sent when api names no disposition.
 *
 * The contract does not describe the header — `openapi.json` types the response as opaque binary — so an
 * api that stops sending one must not silently turn every case document into an inline render. Downloading
 * is the safe reading of an absent instruction.
 */
/**
 * A browser parses a policy by ASCII whitespace only (U+0009, U+000A, U+000C, U+000D, U+0020), so a no-break space
 * or any other non-ASCII character makes the directive it touches a malformed name the browser drops. JavaScript's
 * `trim()` and `\s` accept such characters, which would read `"\u00a0sandbox"` as the sandbox the browser ignores.
 * So a policy holding anything but printable ASCII and those separators is not inert at all, and it is split by
 * ASCII whitespace alone.
 */
const CSP_CHARACTERS = /^[\t\n\f\r\x20-\x7e]*$/;
const CSP_WHITESPACE = /[\t\n\f\r ]+/;
const FALLBACK_DISPOSITION = 'attachment; filename="document"';

/**
 * The only types an `inline` disposition may survive for — api's own inline allowlist
 * (`DocumentFileResponses.INLINE_MIME_TYPES`). A type a browser renders as a document of this origin's
 * (HTML, SVG) must never be shown in place, whatever policy arrives with it.
 */
const INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function sendDocument(download: DocumentDownload, res: Response, next: NextFunction): void {
  res.setHeader("Content-Type", download.contentType);
  res.setHeader("Content-Disposition", containedDisposition(download));
  if (download.contentSecurityPolicy) res.setHeader("Content-Security-Policy", download.contentSecurityPolicy);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Documents are case data; a shared cache must not keep a copy.
  res.setHeader("Cache-Control", "no-store");

  // `pipeline` rather than `pipe`: a user cancelling a large scan closes the response, and `pipe` leaves
  // api's body unread and uncancelled, so undici holds that connection out of its pool. It also forwards a
  // mid-stream failure, without which the request hangs until it times out.
  pipeline(download.body, res, (error) => {
    if (error) next(error);
  });
}

/**
 * api's disposition, but never `inline` unless both the content and the policy make an inline render safe.
 *
 * The two headers are one decision — see the note at the top of this file. api pairs them today, so this
 * only bites if that stops being true: a proxy stripping or replacing response headers, or an api build
 * that serves `inline` for another type or under a looser policy. Downgrading to a download is the
 * containment that survives either, and the filename is kept because that part of api's answer was never
 * the hazard.
 */
function containedDisposition(download: DocumentDownload): string {
  const { contentDisposition, contentSecurityPolicy, contentType } = download;
  if (!contentDisposition) return FALLBACK_DISPOSITION;

  const [type, ...params] = contentDisposition.split(";");
  if (type.trim().toLowerCase() === "attachment") return contentDisposition;
  if (INLINE_MEDIA_TYPES.has(mediaType(contentType)) && isInertPolicy(contentSecurityPolicy)) return contentDisposition;

  return ["attachment", ...params].join(";");
}

/** The type and subtype alone: `application/pdf; charset=binary` and `APPLICATION/PDF` are both a PDF. */
function mediaType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * Whether the forwarded policy actually neuters an inline render, rather than merely being present.
 *
 * `sendDocument` forwards whatever arrives as this origin's policy for the response, replacing helmet's
 * own, so a header a proxy or a loosened api build supplied would otherwise both satisfy the check and
 * leave the document with less than the app's defaults. Two directives do the work, and both are required
 * in exactly api's form (review finding R09):
 *
 * - **`sandbox` with no `allow-*` token at all**, not merely without `allow-scripts`. A bare sandbox puts the
 *   response in a unique opaque origin with scripts, forms, popups and navigation off. `allow-same-origin`
 *   gives the origin back, so a form in the document would post with `Sec-Fetch-Site: same-origin`, which
 *   `requireSameOrigin` admits; the other allowances each reopen something the bare directive closed.
 * - **`default-src 'none'`**, because the forwarded policy is the response's only one: without it nothing
 *   restricts what the document fetches or where its forms post.
 *
 * **Every occurrence of each has to be inert, not merely one of them.** A browser resolves a repeated
 * directive to its FIRST occurrence and ignores the rest, so `sandbox allow-scripts; sandbox` renders with
 * scripting ON — while a check asking whether *some* sandbox is inert finds the trailing bare one and
 * passes. Requiring all of them closes that gap without this function having to reimplement the
 * precedence rule it would otherwise depend on.
 */
function isInertPolicy(contentSecurityPolicy: string | null): boolean {
  if (!contentSecurityPolicy || !CSP_CHARACTERS.test(contentSecurityPolicy)) return false;

  const directives = contentSecurityPolicy.split(";").map((directive) => directive.toLowerCase().split(CSP_WHITESPACE).filter(Boolean));
  const sandboxes = directives.filter(([name]) => name === "sandbox");
  const defaultSources = directives.filter(([name]) => name === "default-src");

  return (
    sandboxes.length > 0 &&
    sandboxes.every(([, ...tokens]) => tokens.length === 0) &&
    defaultSources.length > 0 &&
    defaultSources.every(([, ...sources]) => sources.length === 1 && sources[0] === "'none'")
  );
}
