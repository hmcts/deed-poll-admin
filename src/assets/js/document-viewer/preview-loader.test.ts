import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createPreviewLoader, type PreviewLoader } from "./preview-loader.js";
import { pagesSaying, testPdf } from "./test-pdfs.js";

const ASSET_PATH = fileURLToPath(new URL("../../../../node_modules/pdfjs-dist/", import.meta.url));
const LIMITS = { maxBytes: 1_000_000, maxPages: 100 };

const pdfResponse = (pages: number) => new Response(testPdf(pagesSaying(pages)), { headers: { "content-type": "application/pdf" } });

/** A fetch whose answers the test releases, one per URL, so it can finish requests in any order. */
function controllableFetch() {
  const pending = new Map<string, { resolve: (response: Response) => void; signal: AbortSignal }>();
  const fetchImpl = (url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      pending.set(String(url), { resolve, signal });
    });
  const until = async (url: string) => {
    while (!pending.has(url)) await new Promise((resolve) => setTimeout(resolve, 1));
    return pending.get(url) as { resolve: (response: Response) => void; signal: AbortSignal };
  };
  return { fetchImpl: fetchImpl as typeof fetch, until };
}

let loader: PreviewLoader | null = null;

describe("createPreviewLoader", () => {
  afterEach(async () => {
    await loader?.close();
    loader = null;
  });

  it("should open the requested preview with its real page count", async () => {
    loader = createPreviewLoader({ ...LIMITS, assetPath: ASSET_PATH, fetchImpl: (async () => pdfResponse(4)) as typeof fetch });

    const result = await loader.load("/a/preview");

    expect(result).toMatchObject({ ok: true, numPages: 4 });
  });

  it("should discard an earlier preview that arrives after a later one was asked for", async () => {
    const { fetchImpl, until } = controllableFetch();
    loader = createPreviewLoader({ ...LIMITS, assetPath: ASSET_PATH, fetchImpl });

    const first = loader.load("/first/preview");
    const firstRequest = await until("/first/preview");
    const second = loader.load("/second/preview");
    (await until("/second/preview")).resolve(pdfResponse(2));
    firstRequest.resolve(pdfResponse(5));

    expect(await first).toEqual({ ok: false, reason: "stale" });
    expect(firstRequest.signal.aborted).toBe(true);
    expect(await second).toMatchObject({ ok: true, numPages: 2 });
  });

  it("should destroy the previous document when another is loaded", async () => {
    let pages = 1;
    loader = createPreviewLoader({ ...LIMITS, assetPath: ASSET_PATH, fetchImpl: (async () => pdfResponse(pages++)) as typeof fetch });

    const first = await loader.load("/first/preview");
    const second = await loader.load("/second/preview");

    if (!first.ok || !second.ok) throw new Error("expected both previews to open");
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    await expect(async () => first.document.getPage(1)).rejects.toThrow();
    await expect(second.document.getPage(1)).resolves.toBeDefined();
  });

  it("should abort the request and destroy the document when the page goes away", async () => {
    const { fetchImpl, until } = controllableFetch();
    loader = createPreviewLoader({ ...LIMITS, assetPath: ASSET_PATH, fetchImpl });

    const pending = loader.load("/a/preview");
    const request = await until("/a/preview");
    await loader.close();

    expect(request.signal.aborted).toBe(true);
    expect(await pending).toEqual({ ok: false, reason: "stale" });
  });

  it("should answer a preview over the page limit as too large", async () => {
    loader = createPreviewLoader({ ...LIMITS, maxPages: 3, assetPath: ASSET_PATH, fetchImpl: (async () => pdfResponse(4)) as typeof fetch });

    expect(await loader.load("/a/preview")).toEqual({ ok: false, reason: "tooLarge" });
  });

  it("should answer a damaged PDF as unavailable", async () => {
    const damaged = async () => new Response("%PDF-1.7 truncated", { headers: { "content-type": "application/pdf" } });
    loader = createPreviewLoader({ ...LIMITS, assetPath: ASSET_PATH, fetchImpl: damaged as typeof fetch });

    expect(await loader.load("/a/preview")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("should pass a refused preview's message through", async () => {
    const busy = async () => new Response(JSON.stringify({ code: "PREVIEW_BUSY" }), { status: 429 });
    loader = createPreviewLoader({ ...LIMITS, assetPath: ASSET_PATH, fetchImpl: busy as typeof fetch });

    expect(await loader.load("/a/preview")).toEqual({ ok: false, reason: "busy" });
  });
});
