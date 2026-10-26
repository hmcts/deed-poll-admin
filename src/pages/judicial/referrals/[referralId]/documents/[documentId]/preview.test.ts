import { PassThrough } from "node:stream";
import { NotFoundError, previewReferralDocument } from "@hmcts/deed-poll";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest } from "../../../../../../express-doubles.js";
import { GET } from "./preview.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  previewReferralDocument: vi.fn(),
  downloadReferralDocument: vi.fn()
}));

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
  res.render = vi.fn() as unknown as Response["render"];

  return res;
}

describe("judicial document preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(previewReferralDocument).mockResolvedValue({ body: new PassThrough(), contentType: "application/pdf", contentLength: 3 } as never);
  });

  it("should ask api for the referral's preview, never the download, with the judge's token", async () => {
    const { downloadReferralDocument } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true, accessToken: "judge-token" }), streamResponse(), vi.fn());

    expect(previewReferralDocument).toHaveBeenCalledWith("ref-1", "doc-a", { accessToken: "judge-token" }, expect.any(AbortSignal));
    expect(downloadReferralDocument).not.toHaveBeenCalled();
  });

  it("should answer a 404 as the document being unavailable, never with the referral's no-longer-available page", async () => {
    vi.mocked(previewReferralDocument).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = streamResponse();

    await GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true }), res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.sent).toEqual({ code: "DOCUMENT_UNAVAILABLE" });
    expect(res.render).not.toHaveBeenCalled();
  });

  it("should refuse a dot-only referral id before asking api", async () => {
    await expect(GET(pageRequest({ params: { referralId: ".", documentId: "doc-a" }, judicial: true }), streamResponse(), vi.fn())).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(previewReferralDocument).not.toHaveBeenCalled();
  });
});
