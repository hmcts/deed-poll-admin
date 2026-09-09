/**
 * The download route's tests, which are about the response HEADERS as much as the bytes.
 *
 * Each of the five it sets is load-bearing, and each was covered by the deleted API's wiring tests before
 * the cutover moved the route's source of truth from local disk to api. What is new and worth pinning
 * hardest is the pair below `Content-Disposition`: api serves PDFs, JPEGs and PNGs `inline`, and the policy
 * that makes rendering a member of the public's upload defensible travels with that disposition rather than
 * being implied by it.
 */

import { PassThrough } from "node:stream";
import { downloadDocument } from "@hmcts/deed-poll";
import type { NextFunction, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest } from "../../../../../express-doubles.js";
import { GET } from "./file.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  downloadDocument: vi.fn()
}));

const PARAMS = { id: "case-1", documentId: "doc-9" };

/** The session's access token, which is the whole of what this route passes to the domain. */
const CALLER = { accessToken: "session-token" };

/** api's answer for a PDF: rendered in place, under a policy that lets it reach nothing. */
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

/** A writable double that records headers, so `pipe` has somewhere real to go. */
function streamResponse(): Response & { headers: Record<string, string> } {
  const res = new PassThrough() as unknown as Response & { headers: Record<string, string> };
  res.headers = {};
  res.setHeader = ((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  }) as Response["setHeader"];

  return res;
}

describe("document download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should ask api for the document under the case in the path, with the caller's token", async () => {
    vi.mocked(downloadDocument).mockResolvedValue(apiDownload() as never);

    await GET(pageRequest({ params: PARAMS, accessToken: "session-token" }), streamResponse(), vi.fn());

    expect(downloadDocument).toHaveBeenCalledWith("case-1", "doc-9", CALLER);
  });

  it("should forward api's content type rather than deriving one", async () => {
    vi.mocked(downloadDocument).mockResolvedValue(apiDownload({ contentType: "image/tiff" }) as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());

    expect(res.headers["Content-Type"]).toBe("image/tiff");
  });

  it("should forward api's disposition, including the filename it composed", async () => {
    vi.mocked(downloadDocument).mockResolvedValue(apiDownload() as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('inline; filename="deed poll.pdf"');
  });

  it("should forward the policy that makes an inline render safe, not just the disposition", async () => {
    // The one this route is easiest to get wrong: a PDF viewer executes script embedded in the document,
    // so honouring `inline` while dropping the policy renders an applicant's upload in this origin under
    // the app's own `default-src 'self'`.
    vi.mocked(downloadDocument).mockResolvedValue(apiDownload() as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());

    expect(res.headers["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("should tell caches not to keep a copy, because a document is case data", async () => {
    vi.mocked(downloadDocument).mockResolvedValue(apiDownload() as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());

    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("should download rather than render in place when api names no disposition", async () => {
    // An absent header renders inline by default, which is the wrong way for a missing instruction about
    // user-uploaded bytes to fail.
    vi.mocked(downloadDocument).mockResolvedValue(apiDownload({ contentDisposition: null }) as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="document"');
  });

  it("should invent no policy of its own when api sends none, and download rather than render in place", async () => {
    vi.mocked(downloadDocument).mockResolvedValue(apiDownload({ contentSecurityPolicy: null, contentTypeOptions: null }) as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());

    expect(res.headers["Content-Security-Policy"]).toBeUndefined();
    expect(res.headers["X-Content-Type-Options"]).toBeUndefined();
    // An `inline` PDF under this app's own `default-src 'self'` is the one combination the route must not
    // produce, so the disposition is downgraded — with api's filename kept, which was never the hazard.
    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="deed poll.pdf"');
  });

  it("should relay an attachment disposition unchanged even when api names no policy", async () => {
    // Nothing renders an attachment, so there is nothing for a policy to contain.
    vi.mocked(downloadDocument).mockResolvedValue(
      apiDownload({ contentDisposition: 'attachment; filename="scan.tiff"', contentSecurityPolicy: null }) as never
    );
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="scan.tiff"');
  });

  it("should pipe api's bytes to the response", async () => {
    const download = apiDownload();
    vi.mocked(downloadDocument).mockResolvedValue(download as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());
    download.body.end("the bytes");

    await new Promise((resolve) => res.on("finish", resolve));
    expect(res.read()?.toString()).toBe("the bytes");
  });

  it("should forward a mid-stream failure to next, so the request does not hang until it times out", async () => {
    const download = apiDownload();
    vi.mocked(downloadDocument).mockResolvedValue(download as never);
    const next = vi.fn() as unknown as NextFunction;

    await GET(pageRequest({ params: PARAMS }), streamResponse(), next);
    const failure = new Error("connection reset");
    download.body.emit("error", failure);
    // `pipeline` calls back after it has destroyed both streams, which is a tick later than the emit.
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(failure);
  });

  it("should destroy api's body when the response closes, so a cancelled download frees the upstream connection", async () => {
    // `pipe` leaves the body unread and uncancelled, and undici then holds that connection out of its
    // pool — steady socket accumulation against api for every caseworker who cancels a large scan.
    const download = apiDownload();
    vi.mocked(downloadDocument).mockResolvedValue(download as never);
    const res = streamResponse();

    await GET(pageRequest({ params: PARAMS }), res, vi.fn());
    res.destroy();
    await new Promise((resolve) => setImmediate(resolve));

    expect(download.body.destroyed).toBe(true);
  });
});
