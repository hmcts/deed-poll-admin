import { fileURLToPath } from "node:url";
import { OPS, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it } from "vitest";
import { type OpenedPreview, openPreview } from "./pdf-document.js";
import { A4_LANDSCAPE, type BrokenFont, pagesSaying, testPdf } from "./test-pdfs.js";

// PDF.js reads its standard fonts from the filesystem under Node, from the same package the build copies them from.
const ASSET_PATH = fileURLToPath(new URL("../../../../node_modules/pdfjs-dist/", import.meta.url));
const MAX_PAGES = 100;

const opened: OpenedPreview[] = [];

async function open(bytes: Uint8Array, signal = new AbortController().signal): Promise<OpenedPreview> {
  const result = await openPreview(bytes, { maxPages: MAX_PAGES, signal, assetPath: ASSET_PATH });
  opened.push(result);
  return result;
}

function document(result: OpenedPreview) {
  if (!result.ok) throw new Error(`expected an opened preview, got ${result.reason}`);
  return result.document;
}

/** Draws one page onto a canvas from PDF.js's own Node factory, as the viewer draws onto a browser canvas. */
async function draw(preview: PDFDocumentProxy, pageNumber: number): Promise<void> {
  await render(preview, await preview.getPage(pageNumber));
}

function render(preview: PDFDocumentProxy, page: PDFPageProxy): Promise<void> {
  const viewport = page.getViewport({ scale: 0.5 });
  const { canvas } = preview.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height)) as { canvas: HTMLCanvasElement };
  return page.render({ canvas, viewport }).promise;
}

/** How many glyphs the page's operator list draws: an empty substitute font draws none, whatever the text says. */
async function glyphsDrawn(page: PDFPageProxy): Promise<number> {
  const { fnArray, argsArray } = await page.getOperatorList();
  return fnArray.reduce((count, fn, index) => (fn === OPS.showText ? count + (argsArray[index][0] as unknown[]).length : count), 0);
}

describe("openPreview", () => {
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((result) => (result.ok ? result.close() : undefined)));
  });

  it("should report the page count PDF.js reads from the preview itself", async () => {
    const one = await open(testPdf(pagesSaying(1)));
    const three = await open(testPdf(pagesSaying(3)));

    expect(one).toMatchObject({ ok: true, numPages: 1 });
    expect(three).toMatchObject({ ok: true, numPages: 3 });
  });

  it("should accept a preview of exactly the page limit", async () => {
    const result = await open(testPdf(pagesSaying(MAX_PAGES)));

    expect(result).toMatchObject({ ok: true, numPages: MAX_PAGES });
  });

  it("should refuse a preview over the page limit and destroy it before any page is read", async () => {
    const result = await openPreview(testPdf(pagesSaying(MAX_PAGES + 1)), { maxPages: MAX_PAGES, signal: new AbortController().signal, assetPath: ASSET_PATH });

    expect(result).toEqual({ ok: false, reason: "tooLarge" });
  });

  it("should give each page its own intrinsic size, portrait or landscape", async () => {
    const preview = document(await open(testPdf([{ text: "Portrait" }, { text: "Landscape", size: A4_LANDSCAPE }])));

    const portrait = (await preview.getPage(1)).getViewport({ scale: 1 });
    const landscape = (await preview.getPage(2)).getViewport({ scale: 1 });

    expect([portrait.width, portrait.height]).toEqual([595, 842]);
    expect([landscape.width, landscape.height]).toEqual([842, 595]);
  });

  it("should keep a page's own rotation, so a turned page is drawn the way its author set it", async () => {
    const preview = document(await open(testPdf([{ text: "Turned", rotate: 90 }])));

    const page = await preview.getPage(1);
    const viewport = page.getViewport({ scale: 1 });

    expect(page.rotate).toBe(90);
    expect([viewport.width, viewport.height]).toEqual([842, 595]);
  });

  it("should read each page's text for the text layer", async () => {
    const preview = document(await open(testPdf(pagesSaying(2))));

    const second = await (await preview.getPage(2)).getTextContent();

    expect(second.items.map((item) => ("str" in item ? item.str : ""))).toContain("Page 2 of 2");
  });

  it("should give a page with no text an empty text layer rather than invented text", async () => {
    const preview = document(await open(testPdf([{}])));

    const content = await (await preview.getPage(1)).getTextContent();

    expect(content.items).toEqual([]);
  });

  it("should open a document carrying a script, a link and a form field without running the script", async () => {
    const marker = "__documentViewerScriptRan";
    const bytes = testPdf([{ text: "Scripted" }], { openActionScript: `globalThis.${marker} = true; app.alert(1);`, link: true, formField: true });

    const preview = document(await open(bytes));
    await (await preview.getPage(1)).getOperatorList();

    expect(Reflect.get(globalThis, marker)).toBeUndefined();
  });

  // The guard for `.yarn/patches/pdfjs-dist-*.patch`: unpatched, PDF.js 6.4.299 completes this render successfully with
  // the page cut off at the image, so a Renovate bump that drops the patch fails here rather than in front of a judge.
  // See docs/pdfjs-render-error-upstream-issue.md.
  it("should fail the render of a page whose image is over the size limit, and still draw the next page", async () => {
    const preview = document(await open(testPdf([{ text: "Oversized scan", image: [9_000, 9_000] }, { text: "Page 2 of 2" }])));

    await expect(draw(preview, 1)).rejects.toThrow("Image exceeded maximum allowed size");
    await expect(draw(preview, 2)).resolves.toBeUndefined();
  });

  it("should fail every later render of that page too, whether drawn again alone or twice at once", async () => {
    const preview = document(await open(testPdf([{ text: "Oversized scan", image: [9_000, 9_000] }])));

    // Both started in one tick, so the second joins the first's pending operator list rather than starting after it.
    const page = await preview.getPage(1);
    const together = await Promise.allSettled([render(preview, page), render(preview, page)]);
    const again = await Promise.allSettled([draw(preview, 1)]);

    expect([...together, ...again].map((result) => result.status)).toEqual(["rejected", "rejected", "rejected"]);
  });

  // The same guard for an image inside an annotation's appearance, which PDF.js otherwise drops with the whole
  // annotation; the viewer draws annotations (`AnnotationMode.ENABLE`, the render's default).
  it("should fail the render of a page whose stamp paints an image over the size limit, and still draw the next page", async () => {
    const preview = document(await open(testPdf([{ text: "Stamped", stamp: [9_000, 9_000] }, { text: "Page 2 of 2" }])));

    await expect(draw(preview, 1)).rejects.toThrow("Image exceeded maximum allowed size");
    await expect(draw(preview, 2)).resolves.toBeUndefined();
  });

  it("should draw a page whose stamp paints an image within the size limit", async () => {
    const preview = document(await open(testPdf([{ text: "Stamped", stamp: [2_000, 2_000] }])));

    await expect(draw(preview, 1)).resolves.toBeUndefined();
  });

  // Only an oversized image fails a page. Every other fault keeps PDF.js's fallback, which `stopAtErrors` would turn
  // into a font that draws nothing on a page that reports success.
  it.each<BrokenFont>(["emptyFontFile", "malformedToUnicode"])(
    "should draw a page whose font has a %s through PDF.js's fallback, text included",
    async (font) => {
      const preview = document(await open(testPdf([{ text: "Still readable", font }])));
      const page = await preview.getPage(1);

      await expect(render(preview, page)).resolves.toBeUndefined();
      expect(await glyphsDrawn(page)).toBe("Still readable".length);
      expect((await page.getTextContent()).items.map((item) => ("str" in item ? item.str : ""))).toContain("Still readable");
    }
  );

  it("should draw a page whose image is within the size limit", async () => {
    const preview = document(await open(testPdf([{ text: "Ordinary scan", image: [4_960, 7_016] }])));

    await expect(draw(preview, 1)).resolves.toBeUndefined();
  });

  it("should report bytes that are not a PDF as damaged", async () => {
    const result = await open(new TextEncoder().encode("<html>not a pdf</html>"));

    expect(result).toEqual({ ok: false, reason: "damaged" });
  });

  it("should report a truncated PDF as damaged", async () => {
    const result = await open(testPdf(pagesSaying(3)).subarray(0, 40));

    expect(result).toEqual({ ok: false, reason: "damaged" });
  });

  it("should report an empty body as damaged", async () => {
    const result = await open(new Uint8Array(0));

    expect(result).toEqual({ ok: false, reason: "damaged" });
  });

  it("should answer aborted, not damaged, when the viewer moved on while the document was opening", async () => {
    const controller = new AbortController();

    const pending = open(testPdf(pagesSaying(2)), controller.signal);
    controller.abort();

    expect(await pending).toEqual({ ok: false, reason: "aborted" });
  });

  it("should leave no page readable once the preview is closed", async () => {
    const result = await openPreview(testPdf(pagesSaying(2)), { maxPages: MAX_PAGES, signal: new AbortController().signal, assetPath: ASSET_PATH });
    const preview = document(result);

    if (result.ok) await result.close();

    await expect(async () => preview.getPage(1)).rejects.toThrow();
  });
});
