import { PassThrough } from "node:stream";
import { NotFoundError, previewDocument } from "@hmcts/deed-poll";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest } from "../../../../../express-doubles.js";
import { GET } from "./preview.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  previewDocument: vi.fn(),
  downloadDocument: vi.fn()
}));

function streamResponse(): Response & { headers: Record<string, string> } {
  const res = new PassThrough() as unknown as Response & { headers: Record<string, string> };
  res.headers = {};
  res.setHeader = ((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  }) as Response["setHeader"];

  return res;
}

describe("caseworker document preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(previewDocument).mockResolvedValue({ body: new PassThrough(), contentType: "application/pdf", contentLength: null } as never);
  });

  it("should ask api for the preview, never the download, with the caseworker's token and a cancelling signal", async () => {
    const { downloadDocument } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { id: "case/1", documentId: "doc-a" }, accessToken: "caseworker-token" }), streamResponse(), vi.fn());

    expect(previewDocument).toHaveBeenCalledWith("case/1", "doc-a", { accessToken: "caseworker-token" }, expect.any(AbortSignal));
    expect(downloadDocument).not.toHaveBeenCalled();
  });

  it("should relay it under the viewer's containment", async () => {
    const res = streamResponse();

    await GET(pageRequest({ params: { id: "case-1", documentId: "doc-a" } }), res, vi.fn());

    expect(res.headers["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="preview.pdf"');
  });

  it("should refuse a dot-only document id before asking api", async () => {
    await expect(GET(pageRequest({ params: { id: "case-1", documentId: ".." } }), streamResponse(), vi.fn())).rejects.toBeInstanceOf(NotFoundError);
    expect(previewDocument).not.toHaveBeenCalled();
  });
});
