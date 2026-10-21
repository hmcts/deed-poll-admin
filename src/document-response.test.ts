/**
 * The relay's inline rule (review finding R09), tested at the one function both download routes share.
 *
 * The routes' own tests pin that they forward api's answer; these pin when `inline` is allowed to survive it.
 */

import { PassThrough } from "node:stream";
import type { DocumentDownload } from "@hmcts/deed-poll";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { sendDocument } from "./document-response.js";

const INERT_POLICY = "default-src 'none'; sandbox";

describe("sendDocument", () => {
  it.each(["application/pdf", "image/jpeg", "image/png", "application/pdf; charset=binary", "APPLICATION/PDF", "Image/PNG"])(
    "should keep api's inline disposition for %s under default-src 'none' and a bare sandbox",
    (contentType) => {
      const res = streamResponse();

      sendDocument(download({ contentType }), res, vi.fn());

      expect(res.headers["Content-Disposition"]).toBe('inline; filename="deed poll.pdf"');
    }
  );

  it.each(["text/html", "image/svg+xml", "application/x-unknown"])(
    "should download %s rather than render it in place, even under the inert policy",
    (contentType) => {
      const res = streamResponse();

      sendDocument(download({ contentType }), res, vi.fn());

      expect(res.headers["Content-Disposition"]).toBe('attachment; filename="deed poll.pdf"');
    }
  );

  it("should download a type that merely starts with an allowlisted one", () => {
    const res = streamResponse();

    sendDocument(download({ contentType: "application/pdfx" }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="deed poll.pdf"');
  });

  it.each([
    ["the sandbox allows same-origin", "default-src 'none'; sandbox allow-same-origin"],
    ["the sandbox allows forms, popups and top navigation", "default-src 'none'; sandbox allow-forms allow-popups allow-top-navigation"],
    ["the policy has a bare sandbox but no default-src", "sandbox"],
    ["default-src is not 'none'", "default-src 'self'; sandbox"],
    ["default-src lists a source beside 'none'", "default-src 'none' https:; sandbox"],
    ["a later bare sandbox follows one with an allowance", "default-src 'none'; sandbox allow-same-origin; sandbox"],
    ["there is no sandbox", "default-src 'none'"]
  ])("should download a PDF rather than render it in place when %s", (_, contentSecurityPolicy) => {
    const res = streamResponse();

    sendDocument(download({ contentSecurityPolicy }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="deed poll.pdf"');
  });

  it("should accept the inert policy written in any case and order", () => {
    const res = streamResponse();

    sendDocument(download({ contentSecurityPolicy: "SANDBOX ;  Default-Src  'NONE' " }), res, vi.fn());

    expect(res.headers["Content-Disposition"]).toBe('inline; filename="deed poll.pdf"');
  });

  it("should keep api's filename on every downgrade, including one for the content type", () => {
    const res = streamResponse();

    sendDocument(
      download({ contentType: "text/html", contentDisposition: 'inline; filename="statement 2.html"', contentSecurityPolicy: "sandbox allow-same-origin" }),
      res,
      vi.fn()
    );

    expect(res.headers["Content-Disposition"]).toBe('attachment; filename="statement 2.html"');
  });

  it("should still forward the policy and nosniff when it downgrades the disposition", () => {
    const res = streamResponse();

    sendDocument(download({ contentType: "text/html", contentSecurityPolicy: "sandbox allow-same-origin" }), res, vi.fn());

    expect(res.headers["Content-Security-Policy"]).toBe("sandbox allow-same-origin");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});

/** api's answer for a PDF today: rendered in place, under a policy that lets it reach nothing. */
function download(overrides: Partial<DocumentDownload> = {}): DocumentDownload {
  return {
    body: new PassThrough(),
    contentType: "application/pdf",
    contentDisposition: 'inline; filename="deed poll.pdf"',
    contentSecurityPolicy: INERT_POLICY,
    ...overrides
  } as DocumentDownload;
}

/** A writable double that records headers, so `pipeline` has somewhere real to go. */
function streamResponse(): Response & { headers: Record<string, string> } {
  const res = new PassThrough() as unknown as Response & { headers: Record<string, string> };
  res.headers = {};
  res.setHeader = ((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  }) as Response["setHeader"];

  return res;
}
