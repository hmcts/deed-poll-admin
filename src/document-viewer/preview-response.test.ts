import { PassThrough } from "node:stream";
import { DocumentPreviewRefusedError, ForbiddenError, NotFoundError, UnauthorizedError } from "@hmcts/deed-poll";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { relayPreview } from "./preview-response.js";

function apiPreview(overrides: Record<string, unknown> = {}) {
  return {
    body: new PassThrough(),
    contentType: "application/pdf" as const,
    contentDisposition: 'inline; filename="x.pdf"',
    contentSecurityPolicy: "default-src *",
    contentTypeOptions: null,
    contentLength: 9,
    ...overrides
  };
}

type StreamResponse = Response & { headers: Record<string, string>; statusCode: number; sent: unknown };

function streamResponse(): StreamResponse {
  const res = new PassThrough() as unknown as StreamResponse;
  res.headers = {};
  res.setHeader = ((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  }) as Response["setHeader"];
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response["status"];
  res.json = ((body: unknown) => {
    res.sent = body;
    return res;
  }) as Response["json"];

  return res;
}

describe("relayPreview", () => {
  it("should answer with its own fixed containment, whatever disposition and policy api sent", async () => {
    const res = streamResponse();

    await relayPreview(res, vi.fn(), async () => apiPreview());

    expect(res.headers).toEqual({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="preview.pdf"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Length": "9"
    });
  });

  it("should leave the length to the stream when api declared none", async () => {
    const res = streamResponse();

    await relayPreview(res, vi.fn(), async () => apiPreview({ contentLength: null }));

    expect(res.headers["Content-Length"]).toBeUndefined();
  });

  it("should pipe api's preview bytes to the response", async () => {
    const preview = apiPreview();
    const res = streamResponse();

    await relayPreview(res, vi.fn(), async () => preview);
    preview.body.end("%PDF-1.7");

    await new Promise((resolve) => res.on("finish", resolve));
    expect(res.read()?.toString()).toBe("%PDF-1.7");
  });

  it("should forward a mid-stream failure to next", async () => {
    const preview = apiPreview();
    const next = vi.fn();

    await relayPreview(streamResponse(), next, async () => preview);
    const failure = new Error("preview body exceeded its limit");
    preview.body.emit("error", failure);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(failure);
  });

  it.each([
    ["PREVIEW_INVALID_DOCUMENT", 422],
    ["PREVIEW_LIMIT_EXCEEDED", 422],
    ["PREVIEW_UNAVAILABLE", 503],
    ["PREVIEW_BUSY", 429]
  ] as const)("should answer api's %s refusal with status %i and the code alone", async (code, status) => {
    const res = streamResponse();

    await relayPreview(res, vi.fn(), async () => {
      throw new DocumentPreviewRefusedError(code, status, null);
    });

    expect(res.statusCode).toBe(status);
    expect(res.sent).toEqual({ code });
    expect(res.headers).toEqual({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  });

  it("should pass on how long a busy converter asked the reader to wait", async () => {
    const res = streamResponse();

    await relayPreview(res, vi.fn(), async () => {
      throw new DocumentPreviewRefusedError("PREVIEW_BUSY", 429, 7);
    });

    expect(res.headers["Retry-After"]).toBe("7");
  });

  it("should answer a 404 as this document being unavailable, never as the case or referral being gone", async () => {
    const res = streamResponse();

    await relayPreview(res, vi.fn(), async () => {
      throw new NotFoundError("Referral ref-1 not found");
    });

    expect(res.statusCode).toBe(404);
    expect(res.sent).toEqual({ code: "DOCUMENT_UNAVAILABLE" });
  });

  it.each([new UnauthorizedError("token refused"), new ForbiddenError("refused"), new Error("deed-poll-api call failed (timeout)")])(
    "should leave %s to the app's error handler, so it keeps its meaning",
    async (error) => {
      const res = streamResponse();

      await expect(
        relayPreview(res, vi.fn(), async () => {
          throw error;
        })
      ).rejects.toBe(error);
      expect(res.headers).toEqual({});
    }
  );

  it("should cancel api's read when the browser goes away, and not report the cancelled read as a failure", async () => {
    const res = streamResponse();
    const next = vi.fn();
    let signal: AbortSignal | undefined;

    const relay = relayPreview(res, next, (given) => {
      signal = given;
      return new Promise((_resolve, reject) =>
        given.addEventListener("abort", () => reject(new Error("deed-poll-api call failed (timeout): document preview failed (timeout)")))
      );
    });
    res.destroy();

    await expect(relay).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(res.headers).toEqual({});
    expect(res.sent).toBeUndefined();
  });

  it("should not cancel anything once the preview has been sent in full", async () => {
    const preview = apiPreview();
    const res = streamResponse();
    let signal: AbortSignal | undefined;

    await relayPreview(res, vi.fn(), async (given) => {
      signal = given;
      return preview;
    });
    preview.body.end("%PDF-1.7");
    res.resume();
    await new Promise((resolve) => res.on("close", resolve));

    expect(signal?.aborted).toBe(false);
  });
});
