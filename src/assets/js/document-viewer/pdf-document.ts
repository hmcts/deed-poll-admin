/**
 * Opening a preview with PDF.js, and the options that keep a hostile PDF inert.
 *
 * **Every preview is a PDF from api, whatever the original was** (Decision 1), so this is the only parser the
 * viewer has. The bytes are already in memory (`fetch-preview.ts`); PDF.js never fetches the document itself,
 * so ranges, streaming and pre-fetching are all off.
 *
 * **Nothing in the document runs.** PDF.js's core API executes no document JavaScript: scripting needs its
 * `PDFScriptingManager`, which the viewer never loads, so actions, form calculations and `OpenAction` scripts are
 * inert. XFA is off, no annotation layer is built (so a link is never clickable and a form field never editable;
 * a filled field's appearance is still drawn), and `useWasm: false` keeps the decoders on PDF.js's plain-JavaScript
 * fallbacks, because WebAssembly would need `'wasm-unsafe-eval'` in the CSP.
 *
 * **The page limit is the viewer's to enforce** (Decision 7). api counts the pages only of the previews it builds,
 * so a PDF original or a converted DOCX arrives uncounted. The count is read as soon as the document opens and
 * before any page is drawn, and a document over the limit is destroyed at once.
 */
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Where the build copies PDF.js's data files (`vite.build.ts`); `src/app.ts` serves the same paths in development. */
export const PDFJS_ASSET_PATH = "/assets/pdfjs/";

// An image over 64 megapixels (8,000 square) is never decoded, so a compressed image cannot unpack into gigabytes in
// the worker. That is well above api's own `maxFramePixels` (25 megapixels) and an A4 scan at 600 dpi (35
// megapixels), so only a PDF original carrying a larger image is affected. Such a page, the image in its content or in
// an annotation's appearance, fails to render rather than being drawn without it, and the viewer says it could not be
// shown in full. That depends on `.yarn/patches/pdfjs-dist-*.patch` (docs/pdfjs-render-error-upstream-issue.md).
// `stopAtErrors` stays off on purpose: it would also turn a broken font or ToUnicode map, which PDF.js otherwise
// draws with a substitute, into a font that draws nothing on a page that reports success.
const MAX_IMAGE_PIXELS = 64_000_000;

export async function openPreview(bytes: Uint8Array, options: OpenPreviewOptions): Promise<OpenedPreview> {
  const loadingTask = getDocument(previewParameters(bytes, options.assetPath ?? PDFJS_ASSET_PATH));
  const abort = () => void loadingTask.destroy();
  options.signal.addEventListener("abort", abort, { once: true });

  try {
    const document = await loadingTask.promise;
    if (options.signal.aborted) return closed(loadingTask.destroy(), "aborted");
    if (document.numPages > options.maxPages) return closed(loadingTask.destroy(), "tooLarge");

    return { ok: true, document, numPages: document.numPages, close: () => loadingTask.destroy() };
  } catch {
    await loadingTask.destroy();
    return { ok: false, reason: options.signal.aborted ? "aborted" : "damaged" };
  } finally {
    options.signal.removeEventListener("abort", abort);
  }
}

function previewParameters(bytes: Uint8Array, assetPath: string) {
  return {
    data: bytes,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    enableXfa: false,
    useWasm: false,
    maxImageSize: MAX_IMAGE_PIXELS,
    standardFontDataUrl: `${assetPath}standard_fonts/`,
    cMapUrl: `${assetPath}cmaps/`,
    wasmUrl: `${assetPath}wasm/`,
    verbosity: 0
  };
}

async function closed(destroyed: Promise<void>, reason: OpenFailure): Promise<OpenedPreview> {
  await destroyed;
  return { ok: false, reason };
}

/** `damaged` covers a malformed, truncated or password-protected PDF alike: none can be previewed. */
export type OpenFailure = "aborted" | "tooLarge" | "damaged";

export type OpenedPreview = { ok: true; document: PDFDocumentProxy; numPages: number; close: () => Promise<void> } | { ok: false; reason: OpenFailure };

export interface OpenPreviewOptions {
  maxPages: number;
  signal: AbortSignal;
  /** `PDFJS_ASSET_PATH` in the browser; a test passes the package directory. */
  assetPath?: string;
}
