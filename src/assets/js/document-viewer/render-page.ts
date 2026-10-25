/**
 * Drawing one page of an open preview: its canvas, and over it the page's own text as a transparent, selectable
 * layer, so a screen reader reads the words and a caseworker can copy them. A scanned page has no text and gets
 * an empty layer; nothing claims it is searchable.
 *
 * Every draw can be cancelled, and `release` frees what it held (the canvas's backing store and the page's
 * parsed resources), so moving to another page or document never leaves a full-size page behind.
 *
 * **A page that cannot be drawn in full is `incomplete`, and shows nothing.** PDF.js opens the document with
 * `stopAtErrors` (`pdf-document.ts`), so an image over its size limit or an undecodable part fails the page's render
 * rather than being left out. The canvas and text layer are emptied at once, because what was drawn before the
 * failure would pass for the whole page. A text layer that fails counts too, since `stopAtErrors` covers a page's
 * fonts and ToUnicode maps as well: a picture with no readable text is not the page in full for a screen reader. A
 * page that cannot even be read is `failed`, which is the document's.
 */
import { AnnotationMode, type PDFDocumentProxy, type PDFPageProxy, RenderingCancelledException, TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import { canvasDensity, canvasSize } from "./page-geometry.js";

export function renderPage(document: PDFDocumentProxy, request: PageRequest): RenderedPage {
  const sheet = window.document.createElement("div");
  sheet.className = request.className;
  const canvas = window.document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  sheet.append(canvas);

  let cancelled = false;
  let cancelTasks = () => {};
  let cleanup = () => {};
  let read = false;

  const done = (async (): Promise<RenderOutcome> => {
    try {
      const page = await document.getPage(request.pageNumber);
      cleanup = () => void page.cleanup();
      read = true;
      if (cancelled) return "cancelled";

      const rotation = (page.rotate + request.rotation) % 360;
      const unscaled = page.getViewport({ scale: 1, rotation });
      const scale = request.scale(unscaled.width, unscaled.height);
      const viewport = page.getViewport({ scale, rotation });
      const density = canvasDensity(viewport.width, viewport.height, window.devicePixelRatio, request.maxPixels);
      const size = canvasSize(viewport.width, viewport.height, density);
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      sheet.style.setProperty("--scale-factor", String(scale));

      const drawing = page.render({
        canvas,
        viewport,
        transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0],
        annotationMode: AnnotationMode.ENABLE
      });
      const textLayer = request.withText ? textLayerFor(page, sheet, viewport) : null;
      cancelTasks = () => {
        drawing.cancel();
        textLayer?.cancel();
      };

      await Promise.all([drawing.promise, textLayer?.render()]);
      return cancelled ? "cancelled" : "rendered";
    } catch (error) {
      if (cancelled || error instanceof RenderingCancelledException) return "cancelled";
      if (!read) return "failed";
      cancelTasks();
      emptyCanvas(canvas);
      sheet.replaceChildren();
      return "incomplete";
    }
  })();

  return {
    element: sheet,
    done,
    release() {
      cancelled = true;
      cancelTasks();
      cleanup();
      emptyCanvas(canvas);
      sheet.remove();
    }
  };
}

// A zero-sized canvas gives its backing store back at once rather than when it is collected, and shows nothing.
function emptyCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function textLayerFor(page: PDFPageProxy, sheet: HTMLElement, viewport: ReturnType<PDFPageProxy["getViewport"]>): TextLayer {
  const container = window.document.createElement("div");
  // PDF.js's class name, which the text layer's own positioning rules (`_document-viewer.scss`) are written against.
  container.className = "textLayer";
  sheet.append(container);
  return new TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
}

export type RenderOutcome = "rendered" | "cancelled" | "incomplete" | "failed";

export interface PageRequest {
  pageNumber: number;
  /** Quarter turns on top of the page's own rotation, in degrees. */
  rotation: 0 | 90 | 180 | 270;
  /** The scale for a page of this unscaled (rotated) size, so a fit can be computed from the page itself. */
  scale: (width: number, height: number) => number;
  maxPixels: number;
  withText: boolean;
  className: string;
}

export interface RenderedPage {
  element: HTMLElement;
  done: Promise<RenderOutcome>;
  release(): void;
}
