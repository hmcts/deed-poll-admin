/**
 * The document viewer's renderer, started by `index.ts` only on a page carrying the viewer
 * (`src/pages/document-viewer.njk`), so no other page downloads PDF.js.
 *
 * It asks for the one preview the page names, opens it, draws the selected page at the width of its frame, then
 * the thumbnails. Every outcome other than a drawn page is one of the template's fixed `data-message-*` sentences
 * in the status region, with the frame emptied, and the page's plain links (other documents, **Download
 * original**, the way back) keep working whatever happens here.
 *
 * Leaving the page aborts the request and destroys the document and its worker; a page restored from the
 * back-forward cache loads its preview again rather than showing a canvas whose document is gone.
 */
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
// The worker PDF.js was built with, emitted by vite as a hashed same-origin asset: CSP's `script-src 'self'`
// covers it, and no CDN or blob URL is involved.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { fitWidthScale, MAX_CANVAS_PIXELS } from "./page-geometry.js";
import { createPreviewLoader, type LoadFailure, type LoadResult } from "./preview-loader.js";
import { type RenderedPage, renderPage } from "./render-page.js";
import { createThumbnails, type Thumbnails } from "./thumbnails.js";

const MESSAGE_KEYS: Readonly<Record<Exclude<LoadFailure, "stale">, string>> = {
  unavailable: "messageUnavailable",
  tooLarge: "messageTooLarge",
  busy: "messageBusy",
  signedOut: "messageSignedOut",
  forbidden: "messageForbidden",
  failed: "messageFailed"
};

export function initDocumentViewer(root: HTMLElement): DocumentViewer | null {
  const frame = root.querySelector<HTMLElement>("[data-viewer-page]");
  const status = root.querySelector<HTMLElement>("[data-viewer-status]");
  const thumbnailsRegion = root.querySelector<HTMLElement>("[data-viewer-thumbnails]");
  const previewUrl = root.dataset.previewUrl;
  const maxPages = Number(root.dataset.maxPages);
  const maxBytes = Number(root.dataset.maxBytes);
  if (!frame || !status || !thumbnailsRegion || !previewUrl || !(maxPages > 0) || !(maxBytes > 0)) return null;

  GlobalWorkerOptions.workerSrc = workerUrl;
  const loader = createPreviewLoader({ maxBytes, maxPages });
  const pageLabel = root.dataset.labelPage ?? "";
  let opened: Extract<LoadResult, { ok: true }> | null = null;
  let page: RenderedPage | null = null;
  let thumbnails: Thumbnails | null = null;

  const say = (text: string) => {
    status.textContent = text;
    status.hidden = text === "";
  };

  const clear = () => {
    page?.release();
    page = null;
    thumbnails?.destroy();
    thumbnails = null;
    thumbnailsRegion.hidden = true;
  };

  const showPage = async (pageNumber: number): Promise<void> => {
    const current = opened;
    if (!current || pageNumber < 1 || pageNumber > current.numPages) return;

    page?.release();
    const drawing = renderPage(current.document, {
      pageNumber,
      rotation: 0,
      scale: (width) => fitWidthScale(width, frame.clientWidth),
      maxPixels: MAX_CANVAS_PIXELS,
      withText: true,
      className: "app-document-viewer__sheet"
    });
    page = drawing;
    frame.append(drawing.element);

    const outcome = await drawing.done;
    if (page !== drawing || !current.isCurrent()) return;
    if (outcome === "failed") {
      clear();
      say(root.dataset[MESSAGE_KEYS.unavailable] ?? "");
    }
  };

  const load = async (url: string): Promise<void> => {
    clear();
    opened = null;
    say(root.dataset.messageLoading ?? "");

    const result = await loader.load(url);
    if (!result.ok) {
      if (result.reason !== "stale") say(root.dataset[MESSAGE_KEYS[result.reason]] ?? "");
      return;
    }

    opened = result;
    say("");
    // Shown before the page is measured, so fit to width is the width the page actually gets beside them.
    thumbnailsRegion.hidden = false;
    await showPage(1);
    if (!result.isCurrent() || opened !== result) return;

    thumbnails = createThumbnails(thumbnailsRegion, result.document, { numPages: result.numPages, pageLabel: (n) => `${pageLabel} ${n}` });
  };

  const leave = () => {
    clear();
    opened = null;
    void loader.close();
  };
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void load(previewUrl);
  });

  void load(previewUrl);
  return { load, showPage, close: leave };
}

/** What the page and document controls (plan Task 5) drive. */
export interface DocumentViewer {
  load(url: string): Promise<void>;
  showPage(pageNumber: number): Promise<void>;
  close(): void;
}
