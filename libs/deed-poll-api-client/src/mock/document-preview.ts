/**
 * The mock's document previews: a real, complete PDF for each of the five types api previews, or the refusal api
 * would answer, following api's `README.md` preview section on PR #129 (`19bb0c2`).
 *
 * **Fixture provenance.** Every PDF this builds except a PDF original's is synthetic, written by `syntheticPdf`
 * below with one line of fixed text per page and no image content: the mock converts nothing. What it keeps from
 * api is what a viewer can observe — one page for a JPEG or a PNG, one page per TIFF frame in order, a paginated
 * DOCX, the stored bytes for a PDF, and the same refusals for the same inputs. A DOCX always becomes
 * `DOCX_PREVIEW_PAGES` pages, standing in for Docmosis's pagination, which nothing here can reproduce. The page
 * text never repeats the file's name, because api's preview filename is fixed for the same reason.
 *
 * The checks are api's, much reduced: the magic bytes per type, a PDF's `%%EOF`, a TIFF's frame chain, its
 * compression and its page limit. They are enough to reach each refusal from a test, not a security boundary.
 */
import { DOCUMENT_PREVIEW_LIMITS, type PreviewRefusalCode } from "../api/client.js";

/** What api says when it refuses, from `DocumentPreviewError`'s published sentences. */
export const PREVIEW_REFUSALS: Readonly<Record<PreviewRefusalCode, { status: number; error: string }>> = {
  PREVIEW_INVALID_DOCUMENT: { status: 422, error: "This document cannot be previewed. Download the original instead." },
  PREVIEW_LIMIT_EXCEEDED: { status: 422, error: "This document is too large to preview. Download the original instead." },
  PREVIEW_UNAVAILABLE: { status: 503, error: "A preview of this document is not available at the moment. Download the original instead." },
  PREVIEW_BUSY: { status: 429, error: "Too many previews are being prepared. Try again in a few seconds, or download the original." }
};

/** api's configured `busyRetryAfterSeconds`. */
export const PREVIEW_BUSY_RETRY_AFTER_SECONDS = 5;

/** How many pages a converted DOCX has here: more than one, so the viewer's page controls have work to do. */
export const DOCX_PREVIEW_PAGES = 3;

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Portrait A4 for a converted document, landscape for an image, so a viewer meets two intrinsic page sizes.
const A4_PORTRAIT = [595, 842] as const;
const A4_LANDSCAPE = [842, 595] as const;

/** A TIFF's Compression tag, and the two values api deliberately does not preview (old- and new-style JPEG). */
const TIFF_COMPRESSION_TAG = 259;
const TIFF_JPEG_COMPRESSION = new Set([6, 7]);

export function buildDocumentPreview(mimeType: string, bytes: Buffer, mode: DocumentPreviewMode): PreviewOutcome {
  if (mode === "busy") return refused("PREVIEW_BUSY");

  if (mimeType === "application/pdf") return isCompletePdf(bytes) ? { ok: true, pdf: bytes } : refused("PREVIEW_INVALID_DOCUMENT");
  if (mimeType === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]) ? built(1, "JPEG", A4_LANDSCAPE) : refused("PREVIEW_INVALID_DOCUMENT");
  if (mimeType === "image/png") {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? built(1, "PNG", A4_LANDSCAPE) : refused("PREVIEW_INVALID_DOCUMENT");
  }
  if (mimeType === "image/tiff") return previewTiff(bytes);
  if (mimeType === DOCX_MIME_TYPE) return previewDocx(bytes, mode);

  // A stored type with no preview, such as a legacy `.doc`.
  return refused("PREVIEW_INVALID_DOCUMENT");
}

/**
 * A minimal, valid PDF 1.4: one Helvetica line per page and a correct cross-reference table, so a real parser
 * (PDF.js, in the viewer's tests) reads exactly `pages` pages of the given size.
 */
export function syntheticPdf(pages: number, label: string, size: readonly [number, number] = A4_PORTRAIT): Buffer {
  const pageIds = Array.from({ length: pages }, (_, index) => 4 + index * 2);
  const pageReferences = pageIds.map((id) => `${id} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...pageIds.flatMap((id, index) => {
      const text = `BT /F1 24 Tf 72 ${size[1] - 96} Td (Mock preview: ${label} ${index + 1} of ${pages}) Tj ET`;
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
        `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`
      ];
    })
  ];

  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body, "latin1");
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

function previewTiff(bytes: Buffer): PreviewOutcome {
  const frames = tiffFrames(bytes);
  if (frames === "invalid") return refused("PREVIEW_INVALID_DOCUMENT");
  if (frames > DOCUMENT_PREVIEW_LIMITS.maxPages) return refused("PREVIEW_LIMIT_EXCEEDED");
  return built(frames, "TIFF frame", A4_LANDSCAPE);
}

function previewDocx(bytes: Buffer, mode: DocumentPreviewMode): PreviewOutcome {
  // The package check comes first, as api's does: a malformed DOCX is never sent to the converter.
  if (!hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) return refused("PREVIEW_INVALID_DOCUMENT");
  if (mode === "converter-unavailable") return refused("PREVIEW_UNAVAILABLE");
  return built(DOCX_PREVIEW_PAGES, "DOCX page", A4_PORTRAIT);
}

function refused(code: PreviewRefusalCode): PreviewOutcome {
  return { ok: false, code, ...PREVIEW_REFUSALS[code] };
}

function built(pages: number, label: string, size: readonly [number, number]): PreviewOutcome {
  return { ok: true, pdf: syntheticPdf(pages, label, size) };
}

function hasPrefix(bytes: Buffer, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

/** api's PDF check: `%PDF-` at the start and `%%EOF` within the last 1,024 bytes. The pages are never counted. */
function isCompletePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-" && bytes.subarray(-1024).includes("%%EOF", 0, "latin1");
}

/**
 * The number of frames in a TIFF's directory chain, or `invalid` for a broken chain or a JPEG-compressed frame.
 * Stops counting one past the page limit, so a chain cannot make the mock walk further than api would.
 */
function tiffFrames(bytes: Buffer): number | "invalid" {
  if (bytes.length < 8) return "invalid";
  const order = bytes.subarray(0, 2).toString("latin1");
  if (order !== "II" && order !== "MM") return "invalid";
  const little = order === "II";
  const short = (at: number) => (little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
  const long = (at: number) => (little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));
  if (short(2) !== 42) return "invalid";

  const seen = new Set<number>();
  let offset = long(4);
  while (offset !== 0 && seen.size <= DOCUMENT_PREVIEW_LIMITS.maxPages) {
    if (seen.has(offset) || offset + 2 > bytes.length) return "invalid";
    seen.add(offset);
    const entries = short(offset);
    const next = offset + 2 + entries * 12;
    if (entries === 0 || next + 4 > bytes.length) return "invalid";
    if (hasJpegCompression(offset, entries, short)) return "invalid";
    offset = long(next);
  }

  return seen.size === 0 ? "invalid" : seen.size;
}

function hasJpegCompression(offset: number, entries: number, short: (at: number) => number): boolean {
  for (let entry = 0; entry < entries; entry++) {
    const at = offset + 2 + entry * 12;
    if (short(at) === TIFF_COMPRESSION_TAG && TIFF_JPEG_COMPRESSION.has(short(at + 8))) return true;
  }
  return false;
}

export type DocumentPreviewMode = "convert" | "converter-unavailable" | "busy";

export type PreviewOutcome = { ok: true; pdf: Buffer } | { ok: false; code: PreviewRefusalCode; status: number; error: string };
