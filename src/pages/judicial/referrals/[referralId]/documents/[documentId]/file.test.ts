/**
 * The judicial download route. The header rules are the caseworker route's, through the one shared module, so
 * these pin that this route reaches it — the full set of containment cases lives beside that route's own test —
 * and what is this route's alone: the referral-keyed read and the "no longer available" 404.
 */

import { PassThrough } from "node:stream";
import { downloadReferralDocument, NotFoundError } from "@hmcts/deed-poll";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../../express-doubles.js";
import { GET } from "./file.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  downloadReferralDocument: vi.fn()
}));

const PARAMS = { referralId: "ref-1", documentId: "doc-9" };

function apiDownload(overrides: Record<string, unknown> = {}) {
  return {
    body: new PassThrough(),
    contentType: "application/pdf",
    contentDisposition: 'inline; filename="deed poll.pdf"',
    contentSecurityPolicy: "default-src 'none'; sandbox",
    contentTypeOptions: "nosniff",
    ...overrides
  };
}

function streamResponse(): Response & { headers: Record<string, string> } {
  const res = new PassThrough() as unknown as Response & { headers: Record<string, string> };
  res.headers = {};
  res.setHeader = ((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  }) as Response["setHeader"];

  return res;
}

describe("judicial document download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should ask api for the document under the referral in the path, with the judge's token", async () => {
    vi.mocked(downloadReferralDocument).mockResolvedValue(apiDownload() as never);

    await GET(pageRequest({ params: PARAMS, judicial: true, accessToken: "judge-token" }), streamResponse(), vi.fn());

    expect(downloadReferralDocument).toHaveBeenCalledWith("ref-1", "doc-9", { accessToken: "judge-token" });
  });

  it("should forward api's content type, disposition and policy, with nosniff and no-store, as the caseworker route does", async () => {
    vi.mocked(downloadReferralDocument).mockResolvedValue(apiDownload() as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS, judicial: true }), res, vi.fn());

    expect(res.headers).toEqual({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="deed poll.pdf"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    });
  });

  it("should download rather than render in place when api names no inert policy, through the shared containment", async () => {
    vi.mocked(downloadReferralDocument).mockResolvedValue(apiDownload({ contentSecurityPolicy: null }) as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS, judicial: true }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="deed poll.pdf"');
    expect(res.headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("should pipe api's bytes to the response", async () => {
    const download = apiDownload();
    vi.mocked(downloadReferralDocument).mockResolvedValue(download as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS, judicial: true }), res, vi.fn());
    download.body.end("the bytes");

    await new Promise((resolve) => res.on("finish", resolve));
    expect(res.read()?.toString()).toBe("the bytes");
  });

  it("should forward a mid-stream failure to next", async () => {
    const download = apiDownload();
    vi.mocked(downloadReferralDocument).mockResolvedValue(download as never);
    const next = vi.fn();

    await GET(pageRequest({ params: PARAMS, judicial: true }), streamResponse(), next);
    const failure = new Error("connection reset");
    download.body.emit("error", failure);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(failure);
  });

  it("should render the no-longer-available page with a 404 when api will not show the document", async () => {
    // One 404 for a referral withdrawn, closed, another judge's or never there, and for a document not on it.
    vi.mocked(downloadReferralDocument).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await GET(pageRequest({ params: PARAMS, judicial: true }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render.mock.calls[0][0]).toBe("judicial/referrals/unavailable");
    expect(res.render.mock.calls[0][1]).toMatchObject({
      poolPath: "/judicial/referrals",
      en: { heading: "This referral is no longer available" }
    });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it("should leave any other failure to the error page", async () => {
    vi.mocked(downloadReferralDocument).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(pageRequest({ params: PARAMS, judicial: true }), pageResponse(), vi.fn())).rejects.toThrow("unavailable");
  });

  it("should refuse a dot-only document id before asking api", async () => {
    await expect(GET(pageRequest({ params: { ...PARAMS, documentId: ".." }, judicial: true }), pageResponse(), vi.fn())).rejects.toBeInstanceOf(NotFoundError);
    expect(downloadReferralDocument).not.toHaveBeenCalled();
  });
});
