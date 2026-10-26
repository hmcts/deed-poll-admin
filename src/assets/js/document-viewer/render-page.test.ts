import { fileURLToPath } from "node:url";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type OpenedPreview, openPreview } from "./pdf-document.js";
import { renderPage } from "./render-page.js";
import { testPdf } from "./test-pdfs.js";

/**
 * `renderPage` against real PDF.js and real bytes. The unit suite has no browser, so `window.document` is a stand-in
 * just large enough for the renderer, whose canvas draws onto PDF.js's own Node canvas. The text layer needs a real
 * DOM, so these draws leave it out; the browser journeys cover it.
 */
const ASSET_PATH = fileURLToPath(new URL("../../../../node_modules/pdfjs-dist/", import.meta.url));
// A function, because PDF.js transfers the bytes to its worker and leaves the caller's buffer detached.
const oversized = () => testPdf([{ text: "Oversized scan", image: [9_000, 9_000] }, { text: "Page 2 of 2" }]);

let opened: OpenedPreview | null = null;

async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  opened = await openPreview(bytes, { maxPages: 100, signal: new AbortController().signal, assetPath: ASSET_PATH });
  if (!opened.ok) throw new Error(`expected an opened preview, got ${opened.reason}`);
  // Only once the document is open: PDF.js reads `window` to tell a browser from Node, and draws a page frame by
  // frame through it.
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    requestAnimationFrame: (callback: () => void) => setImmediate(callback),
    cancelAnimationFrame: (handle: NodeJS.Immediate) => clearImmediate(handle),
    document: { createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : fakeElement()) }
  });
  return opened.document;
}

function draw(preview: PDFDocumentProxy, pageNumber: number) {
  return renderPage(preview, { pageNumber, rotation: 0, scale: () => 0.5, maxPixels: 4_000_000, withText: false, className: "sheet" });
}

describe("renderPage", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    if (opened?.ok) await opened.close();
    opened = null;
  });

  it("should draw an ordinary page onto its canvas", async () => {
    const preview = await open(oversized());

    const page = draw(preview, 2);

    expect(await page.done).toBe("rendered");
    expect(canvasOf(page.element).width).toBeGreaterThan(0);
  });

  it("should report a page whose image is over the size limit as incomplete, with nothing of it left on show", async () => {
    const preview = await open(oversized());

    const page = draw(preview, 1);
    const canvas = canvasOf(page.element);

    expect(await page.done).toBe("incomplete");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect((page.element as unknown as FakeElement).children).toEqual([]);
  });

  it("should report a page whose stamp paints an image over the size limit as incomplete too", async () => {
    const preview = await open(testPdf([{ text: "Stamped", stamp: [9_000, 9_000] }]));

    expect(await draw(preview, 1).done).toBe("incomplete");
  });

  it("should report a page whose font is broken as rendered, not incomplete, because only an oversized image fails a page", async () => {
    const preview = await open(testPdf([{ text: "Still readable", font: "emptyFontFile" }]));

    expect(await draw(preview, 1).done).toBe("rendered");
  });

  it("should still draw the next page of a document with an incomplete page", async () => {
    const preview = await open(oversized());

    const first = draw(preview, 1);
    await first.done;
    first.release();
    const second = draw(preview, 2);

    expect(await second.done).toBe("rendered");
  });

  it("should report the same page incomplete when it is drawn again, as a zoom or a return to it does", async () => {
    const preview = await open(oversized());

    const first = draw(preview, 1);
    await first.done;
    first.release();

    expect(await draw(preview, 1).done).toBe("incomplete");
  });

  // PDF.js resets an annotation's streams only after a successful read, so unpatched the second draw read an emptied
  // appearance and drew the page without its stamp as if complete.
  it("should report a page whose stamp is over the size limit incomplete when it is drawn again too", async () => {
    const preview = await open(testPdf([{ text: "Stamped", stamp: [9_000, 9_000] }]));

    const first = draw(preview, 1);
    await first.done;
    first.release();

    expect(await draw(preview, 1).done).toBe("incomplete");
  });

  it("should report a draw released before it finishes as cancelled, never as incomplete", async () => {
    const preview = await open(oversized());

    const ordinary = draw(preview, 2);
    const failing = draw(preview, 1);
    ordinary.release();
    failing.release();

    expect([await ordinary.done, await failing.done]).toEqual(["cancelled", "cancelled"]);
  });

  it("should report a page the document does not have as failed, which is the document's state", async () => {
    const preview = await open(oversized());

    expect(await draw(preview, 3).done).toBe("failed");
  });
});

function canvasOf(sheet: HTMLElement): FakeCanvas {
  return (sheet as unknown as FakeElement).created[0] as FakeCanvas;
}

function fakeElement(): FakeElement {
  const element: FakeElement = {
    children: [],
    created: [],
    className: "",
    style: { setProperty: () => {} },
    setAttribute: () => {},
    append: (...nodes) => {
      element.children.push(...nodes);
      element.created.push(...nodes);
    },
    replaceChildren: () => {
      element.children = [];
    },
    remove: () => {}
  };
  return element;
}

/** A canvas that sizes and draws a real one from the open document's own Node canvas factory. */
function fakeCanvas(): FakeCanvas {
  if (!opened?.ok) throw new Error("a canvas is only created for an open document");
  const real = opened.document.canvasFactory.create(1, 1).canvas as RealCanvas;
  return Object.assign(fakeElement(), {
    get width() {
      return real.width;
    },
    set width(value: number) {
      real.width = value;
    },
    get height() {
      return real.height;
    },
    set height(value: number) {
      real.height = value;
    },
    getContext: (kind: string, options?: unknown) => real.getContext(kind, options)
  });
}

interface FakeElement {
  children: unknown[];
  created: unknown[];
  className: string;
  style: { setProperty: (name: string, value: string) => void };
  setAttribute: (name: string, value: string) => void;
  append: (...nodes: unknown[]) => void;
  replaceChildren: () => void;
  remove: () => void;
}

interface FakeCanvas extends FakeElement {
  width: number;
  height: number;
}

interface RealCanvas {
  width: number;
  height: number;
  getContext(kind: string, options?: unknown): unknown;
}
