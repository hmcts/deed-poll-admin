import { describe, expect, it, vi } from "vitest";
import { fetchPreview } from "./fetch-preview.js";

const URL_PATH = "/deed-polls/case-1/documents/doc-1/preview";
const MAX_BYTES = 1024;

const pdf = (bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
  new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", ...headers } });
const refusal = (status: number, code?: string) =>
  new Response(code ? JSON.stringify({ code }) : "<html></html>", { status, headers: { "content-type": code ? "application/json" : "text/html" } });

async function preview(response: Response | (() => Promise<Response>), signal = new AbortController().signal) {
  const fetchImpl = vi.fn(typeof response === "function" ? response : async () => response);
  const result = await fetchPreview(URL_PATH, { maxBytes: MAX_BYTES, signal, fetchImpl });
  return { result, fetchImpl };
}

describe("fetchPreview", () => {
  it("should ask for a PDF from the same origin and refuse to follow a redirect", async () => {
    const { fetchImpl } = await preview(pdf(new Uint8Array([1])));

    expect(fetchImpl).toHaveBeenCalledWith(
      URL_PATH,
      expect.objectContaining({ headers: { Accept: "application/pdf" }, credentials: "same-origin", redirect: "manual" })
    );
  });

  it("should answer the whole body of a PDF", async () => {
    const { result } = await preview(pdf(new Uint8Array([37, 80, 68, 70])));

    expect(result).toEqual({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]) });
  });

  it("should accept a PDF of exactly the byte limit", async () => {
    const { result } = await preview(pdf(new Uint8Array(MAX_BYTES)));

    expect(result.ok).toBe(true);
  });

  it("should refuse a declared length over the limit without reading the body", async () => {
    const response = pdf(new Uint8Array(1), { "content-length": String(MAX_BYTES + 1) });
    const read = vi.spyOn(response.body as ReadableStream, "getReader");

    const { result } = await preview(response);

    expect(result).toEqual({ ok: false, reason: "tooLarge" });
    expect(read).not.toHaveBeenCalled();
  });

  it("should stop reading and refuse a body that runs past the limit whatever its declared length", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(512));
      }
    });

    const { result } = await preview(new Response(endless, { headers: { "content-type": "application/pdf" } }));

    expect(result).toEqual({ ok: false, reason: "tooLarge" });
    expect(pulled).toBeLessThan(10);
  });

  it("should refuse a 200 that is not a PDF as a failure", async () => {
    const { result } = await preview(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it.each([
    ["an unsupported or damaged original", 422, "PREVIEW_INVALID_DOCUMENT", "unavailable"],
    ["a converter that is not provisioned", 503, "PREVIEW_UNAVAILABLE", "unavailable"],
    ["a preview over api's limits", 422, "PREVIEW_LIMIT_EXCEEDED", "tooLarge"],
    ["busy previews", 429, "PREVIEW_BUSY", "busy"],
    ["a document that is not there", 404, "DOCUMENT_UNAVAILABLE", "unavailable"]
  ])("should map %s to its fixed message", async (_case, status, code, reason) => {
    const { result } = await preview(refusal(status, code));

    expect(result).toEqual({ ok: false, reason });
  });

  it("should not trust a published code on the wrong status", async () => {
    const { result } = await preview(refusal(500, "PREVIEW_UNAVAILABLE"));

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it.each([
    [401, "signedOut"],
    [403, "forbidden"],
    [500, "failed"],
    [504, "failed"]
  ])("should map this app's %i page to its own message", async (status, reason) => {
    const { result } = await preview(refusal(status));

    expect(result).toEqual({ ok: false, reason });
  });

  it("should treat a redirect, which can only be to sign-in, as signed out", async () => {
    const { result } = await preview(new Response(null, { status: 302, headers: { location: "/login" } }));

    expect(result).toEqual({ ok: false, reason: "signedOut" });
  });

  it("should report a network failure as failed", async () => {
    const { result } = await preview(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it("should answer aborted when the request was cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const { result } = await preview(async () => {
      throw new DOMException("aborted", "AbortError");
    }, controller.signal);

    expect(result).toEqual({ ok: false, reason: "aborted" });
  });
});
