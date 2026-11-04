/**
 * One document open at a time, and only the latest one asked for.
 *
 * Each `load` starts a new generation: it aborts the previous request, destroys the previous document (and with
 * it that document's worker), and answers `stale` instead of a document if another `load` or a `close` came after
 * it. So a slow preview that finishes after the caseworker has moved on is destroyed rather than drawn under the
 * newer document's name, and a tab holds one parsed document at most.
 */
import { fetchPreview, type PreviewFailure } from "./fetch-preview.js";
import { type OpenedPreview, openPreview } from "./pdf-document.js";

export function createPreviewLoader(options: PreviewLoaderOptions): PreviewLoader {
  let generation = 0;
  let controller: AbortController | null = null;
  let current: Opened | null = null;

  async function release(): Promise<void> {
    controller?.abort();
    controller = null;
    const previous = current;
    current = null;
    await previous?.close();
  }

  return {
    async load(url) {
      const mine = ++generation;
      await release();
      if (mine !== generation) return STALE;

      const own = new AbortController();
      controller = own;
      const fetched = await fetchPreview(url, { maxBytes: options.maxBytes, signal: own.signal, fetchImpl: options.fetchImpl });
      if (mine !== generation) return STALE;
      if (!fetched.ok) return fetched.reason === "aborted" ? STALE : { ok: false, reason: fetched.reason };

      const opened = await openPreview(fetched.bytes, { maxPages: options.maxPages, signal: own.signal, assetPath: options.assetPath });
      if (mine !== generation) {
        if (opened.ok) await opened.close();
        return STALE;
      }
      if (!opened.ok) return opened.reason === "aborted" ? STALE : { ok: false, reason: opened.reason === "tooLarge" ? "tooLarge" : "unavailable" };

      current = opened;
      return { ok: true, document: opened.document, numPages: opened.numPages, isCurrent: () => mine === generation };
    },
    async close() {
      generation++;
      await release();
    }
  };
}

const STALE: LoadResult = { ok: false, reason: "stale" };

type Opened = Extract<OpenedPreview, { ok: true }>;

export type LoadFailure = Exclude<PreviewFailure, "aborted"> | "stale";

export type LoadResult = { ok: true; document: Opened["document"]; numPages: number; isCurrent: () => boolean } | { ok: false; reason: LoadFailure };

export interface PreviewLoader {
  load(url: string): Promise<LoadResult>;
  /** Abort and destroy whatever is open, for a page that is going away. */
  close(): Promise<void>;
}

export interface PreviewLoaderOptions {
  maxBytes: number;
  maxPages: number;
  assetPath?: string;
  fetchImpl?: typeof fetch;
}
