/**
 * The page thumbnails: one entry per page of the open preview, each drawn from that page itself, at low resolution
 * and only once it scrolls into view.
 *
 * At most one thumbnail is being drawn at a time, after the selected page has had its turn, so a hundred-page
 * document costs one small draw after another rather than a hundred at once. `destroy` cancels the draw in
 * progress, forgets the queue and frees every canvas, which is what a document switch or a page leaving needs.
 */
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { THUMBNAIL_MAX_PIXELS, THUMBNAIL_WIDTH } from "./page-geometry.js";
import { type RenderedPage, renderPage } from "./render-page.js";

export function createThumbnails(container: HTMLElement, document: PDFDocumentProxy, options: ThumbnailOptions): Thumbnails {
  const list = window.document.createElement("ol");
  list.className = "app-document-viewer__thumbnail-list";
  const entries = Array.from({ length: options.numPages }, (_, index) => thumbnailEntry(index + 1, options.pageLabel(index + 1)));
  list.append(...entries);
  container.replaceChildren(list);

  const queue: number[] = [];
  const rendered: RenderedPage[] = [];
  let active: RenderedPage | null = null;
  let destroyed = false;

  const observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue;
        observer.unobserve(record.target);
        queue.push(Number((record.target as HTMLElement).dataset.page));
      }
      void drawNext();
    },
    { root: container, rootMargin: "200px 0px" }
  );
  for (const entry of entries) observer.observe(entry);

  async function drawNext(): Promise<void> {
    if (destroyed || active || queue.length === 0) return;
    const pageNumber = queue.shift() as number;
    const drawing = renderPage(document, {
      pageNumber,
      rotation: 0,
      scale: (width) => THUMBNAIL_WIDTH / width,
      maxPixels: THUMBNAIL_MAX_PIXELS,
      withText: false,
      className: "app-document-viewer__thumbnail-page"
    });
    active = drawing;
    entries[pageNumber - 1].prepend(drawing.element);
    const outcome = await drawing.done;
    active = null;
    if (destroyed) return;
    if (outcome === "rendered") rendered.push(drawing);
    else drawing.release();
    void drawNext();
  }

  return {
    destroy() {
      destroyed = true;
      observer.disconnect();
      queue.length = 0;
      active?.release();
      for (const page of rendered) page.release();
      container.replaceChildren();
    }
  };
}

function thumbnailEntry(pageNumber: number, label: string): HTMLLIElement {
  const entry = window.document.createElement("li");
  entry.className = "app-document-viewer__thumbnail";
  entry.dataset.page = String(pageNumber);
  const caption = window.document.createElement("span");
  caption.className = "govuk-body-s app-document-viewer__thumbnail-label";
  caption.textContent = label;
  entry.append(caption);
  return entry;
}

export interface ThumbnailOptions {
  numPages: number;
  pageLabel: (pageNumber: number) => string;
}

export interface Thumbnails {
  destroy(): void;
}
