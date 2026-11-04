import { PassThrough } from "node:stream";
import { downloadReferralDocument, NotFoundError } from "@hmcts/deed-poll";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest } from "../../../../../../express-doubles.js";
import { GET } from "./download.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  downloadReferralDocument: vi.fn(),
  previewReferralDocument: vi.fn()
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

describe("judicial original-download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(downloadReferralDocument).mockResolvedValue({
      body: new PassThrough(),
      contentType: "image/tiff",
      contentDisposition: 'attachment; filename="scan.tiff"',
      contentSecurityPolicy: "default-src 'none'; sandbox",
      contentTypeOptions: "nosniff"
    } as never);
  });

  it("should ask api for the referral's original, never the preview, with the judge's token", async () => {
    const { previewReferralDocument } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true, accessToken: "judge-token" }), streamResponse(), vi.fn());

    expect(downloadReferralDocument).toHaveBeenCalledWith("ref-1", "doc-a", { accessToken: "judge-token" });
    expect(previewReferralDocument).not.toHaveBeenCalled();
  });

  it("should send the original's own type and name as an attachment", async () => {
    const res = streamResponse();

    await GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true }), res, vi.fn());

    expect(res.headers["Content-Type"]).toBe("image/tiff");
    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="scan.tiff"');
  });

  it("should leave a 404 to the shared Page not found rather than say the referral has gone", async () => {
    vi.mocked(downloadReferralDocument).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

    await expect(GET(pageRequest({ params: { referralId: "ref-1", documentId: "doc-a" }, judicial: true }), streamResponse(), vi.fn())).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
