import { PassThrough } from "node:stream";
import { downloadDocument, NotFoundError } from "@hmcts/deed-poll";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest } from "../../../../../express-doubles.js";
import { GET } from "./download.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  downloadDocument: vi.fn(),
  previewDocument: vi.fn()
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

describe("caseworker original-download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(downloadDocument).mockResolvedValue({
      body: new PassThrough(),
      contentType: "application/pdf",
      contentDisposition: 'inline; filename="deed poll.pdf"',
      contentSecurityPolicy: "default-src 'none'; sandbox",
      contentTypeOptions: "nosniff"
    } as never);
  });

  it("should ask api for the original, never the preview, with the caseworker's token", async () => {
    const { previewDocument } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { id: "case-1", documentId: "doc-a" }, accessToken: "caseworker-token" }), streamResponse(), vi.fn());

    expect(downloadDocument).toHaveBeenCalledWith("case-1", "doc-a", { accessToken: "caseworker-token" });
    expect(previewDocument).not.toHaveBeenCalled();
  });

  it("should send the original as an attachment even where api would render it in place", async () => {
    const res = streamResponse();

    await GET(pageRequest({ params: { id: "case-1", documentId: "doc-a" } }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="deed poll.pdf"');
    expect(res.headers["Content-Type"]).toBe("application/pdf");
  });

  it("should refuse a dot-only case id before asking api", async () => {
    await expect(GET(pageRequest({ params: { id: ".", documentId: "doc-a" } }), streamResponse(), vi.fn())).rejects.toBeInstanceOf(NotFoundError);
    expect(downloadDocument).not.toHaveBeenCalled();
  });
});
