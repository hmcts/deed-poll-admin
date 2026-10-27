/**
 * The two preview operations: against the in-memory mock for scope, ownership and api's refusals, and against
 * servers of their own for what the mock never does wrong (a body that is not a PDF, an oversized one, a stall).
 */
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCX_PREVIEW_PAGES, syntheticPdf } from "../mock/document-preview.js";
import { DOCX_BYTES, JPEG_BYTES, PNG_BYTES, pdfPages, tiff } from "../mock/preview-sources.js";
import { type RunningMockApi, startMockApi } from "../mock/server.js";
import {
  type ApiConfig,
  claimJudicialReferral,
  closeReferral,
  createCase,
  createReferral,
  DEFAULT_TIMEOUT_MS,
  DOCUMENT_PREVIEW_LIMITS,
  directJudicialReferral,
  downloadDocument,
  downloadJudicialDocument,
  previewDocument,
  previewJudicialDocument,
  uploadDocument
} from "./client.js";

const DATE_RECEIVED = new Date("2026-03-10T00:00:00Z");
const DOCUMENT_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const JUDGE = "judge.a@example.com";
const ANOTHER_JUDGE = "judge.b@example.com";
const PREVIEW_TIMEOUT_MS = 27_000;
const CLOCK_SCALE = 1_000;

let mock: RunningMockApi;
let config: ApiConfig;

beforeAll(async () => {
  mock = await startMockApi();
  config = { baseUrl: mock.url, timeoutMs: 2000, accessToken: "a-caseworker-token" };
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.setScenario("happy-path");
  mock.reset();
});

describe("previewDocument against the mock", () => {
  it.each([
    ["a PDF", "application/pdf", syntheticPdf(2, "Original"), 2],
    ["a JPEG", "image/jpeg", JPEG_BYTES, 1],
    ["a PNG", "image/png", PNG_BYTES, 1],
    ["a multi-page TIFF", "image/tiff", tiff(4), 4],
    ["a DOCX", DOCX, DOCX_BYTES, DOCX_PREVIEW_PAGES]
  ])("should stream %s's preview as one complete PDF of its own pages", async (_label, mimeType, bytes, pages) => {
    const { caseId, documentId } = await caseWithDocument(mimeType, bytes);

    const result = await previewDocument(caseId, documentId, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pdf = await buffered(result.data.body);
    expect(result.data.contentLength).toBe(pdf.length);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdfPages(pdf)).toBe(pages);
  });

  it("should leave the original download a TIFF or DOCX's own bytes and type, not the preview", async () => {
    const tiffOriginal = tiff(3);
    const tiffCase = await caseWithDocument("image/tiff", tiffOriginal, "scan.tif");
    const docxCase = await caseWithDocument(DOCX, DOCX_BYTES, "letter.docx");

    const tiffFile = await downloadDocument(tiffCase.caseId, tiffCase.documentId, config);
    const docxFile = await downloadDocument(docxCase.caseId, docxCase.documentId, config);

    expect(tiffFile.ok && tiffFile.data.contentType).toBe("image/tiff");
    expect(tiffFile.ok && tiffFile.data.contentDisposition).toMatch(/^attachment;.*scan\.tif/);
    expect(tiffFile.ok && (await buffered(tiffFile.data.body))).toEqual(tiffOriginal);
    expect(docxFile.ok && docxFile.data.contentType).toBe(DOCX);
    expect(docxFile.ok && (await buffered(docxFile.data.body))).toEqual(DOCX_BYTES);
  });

  it("should report not-found for another case's document and for an unknown one", async () => {
    const { documentId } = await caseWithDocument("application/pdf", syntheticPdf(1, "Original"));
    const otherCase = await newCase();

    const wrongCase = await previewDocument(otherCase, documentId, config);
    const unknown = await previewDocument(otherCase, "00000000-0000-4000-8000-000000000000", config);

    expect(wrongCase).toMatchObject({ ok: false, error: { kind: "not-found" } });
    expect(unknown).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });

  it("should report not-found for a document with no stored file", async () => {
    const { caseId, documentId } = await caseWithDocument("application/pdf", Buffer.alloc(0));

    const result = await previewDocument(caseId, documentId, config);

    expect(result).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });

  it("should report a damaged original as api's invalid-document refusal, with no wait", async () => {
    const { caseId, documentId } = await caseWithDocument("application/pdf", Buffer.from("%PDF-1.7 cut short"));

    const result = await previewDocument(caseId, documentId, config);

    expect(result).toEqual({ ok: false, error: { kind: "preview-refused", code: "PREVIEW_INVALID_DOCUMENT", status: 422, retryAfterSeconds: null } });
  });

  it("should report a JPEG-compressed TIFF as invalid and a TIFF over the page limit as too large", async () => {
    const jpegTiff = await caseWithDocument("image/tiff", tiff(1, { compression: 7 }));
    const longTiff = await caseWithDocument("image/tiff", tiff(DOCUMENT_PREVIEW_LIMITS.maxPages + 1));

    const invalid = await previewDocument(jpegTiff.caseId, jpegTiff.documentId, config);
    const tooLarge = await previewDocument(longTiff.caseId, longTiff.documentId, config);

    expect(invalid).toMatchObject({ ok: false, error: { kind: "preview-refused", code: "PREVIEW_INVALID_DOCUMENT" } });
    expect(tooLarge).toMatchObject({ ok: false, error: { kind: "preview-refused", code: "PREVIEW_LIMIT_EXCEEDED" } });
  });

  it("should report a DOCX the converter cannot take as unavailable, while its original still downloads", async () => {
    const { caseId, documentId } = await caseWithDocument(DOCX, DOCX_BYTES);
    mock.setScenario("preview-converter-unavailable");

    const preview = await previewDocument(caseId, documentId, config);
    const original = await downloadDocument(caseId, documentId, config);

    // Never an empty PDF standing in for a conversion that did not happen.
    expect(preview).toEqual({ ok: false, error: { kind: "preview-refused", code: "PREVIEW_UNAVAILABLE", status: 503, retryAfterSeconds: null } });
    expect(original.ok && (await buffered(original.data.body))).toEqual(DOCX_BYTES);
  });

  it("should report a busy pod with api's Retry-After", async () => {
    const { caseId, documentId } = await caseWithDocument("image/png", PNG_BYTES);
    mock.setScenario("preview-busy");

    const result = await previewDocument(caseId, documentId, config);

    expect(result).toEqual({ ok: false, error: { kind: "preview-refused", code: "PREVIEW_BUSY", status: 429, retryAfterSeconds: 5 } });
  });

  it("should report api being unreachable as unavailable, not as a preview refusal", async () => {
    const { caseId, documentId } = await caseWithDocument("image/png", PNG_BYTES);
    mock.setScenario("api-unavailable");

    const result = await previewDocument(caseId, documentId, config);

    expect(result).toMatchObject({ ok: false, error: { kind: "unavailable", status: 503 } });
  });
});

describe("previewJudicialDocument against the mock", () => {
  it("should preview a document on an Open referral for any judge", async () => {
    const { caseId, documentId } = await caseWithDocument("image/tiff", tiff(2));
    const referralId = await referralOn(caseId);

    const result = await previewJudicialDocument(referralId, documentId, judge(ANOTHER_JUDGE));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pdfPages(await buffered(result.data.body))).toBe(2);
  });

  it("should follow the referral's holder: the claimant may preview, another judge may not", async () => {
    const { caseId, documentId } = await caseWithDocument("image/jpeg", JPEG_BYTES);
    const referralId = await referralOn(caseId);
    await claimJudicialReferral(referralId, judge(JUDGE));

    const holder = await previewJudicialDocument(referralId, documentId, judge(JUDGE));
    const other = await previewJudicialDocument(referralId, documentId, judge(ANOTHER_JUDGE));

    expect(holder.ok).toBe(true);
    if (holder.ok) await buffered(holder.data.body);
    expect(other).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });

  it("should refuse every judge once the office closes the referral", async () => {
    const { caseId, documentId } = await caseWithDocument("image/jpeg", JPEG_BYTES);
    const referralId = await referralOn(caseId);
    await claimJudicialReferral(referralId, judge(JUDGE));
    await directJudicialReferral(referralId, { decision: "Approved", changesToStandardPublication: false }, judge(JUDGE));
    await closeReferral(caseId, referralId, config);

    const result = await previewJudicialDocument(referralId, documentId, judge(JUDGE));

    expect(result).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });

  it("should report not-found for a document that is not on the referral's application", async () => {
    const { documentId } = await caseWithDocument("image/png", PNG_BYTES);
    const referralId = await referralOn(await newCase());

    const result = await previewJudicialDocument(referralId, documentId, judge(JUDGE));

    expect(result).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });

  it("should carry the converter's refusal on the judicial surface too, with the original still downloadable", async () => {
    const { caseId, documentId } = await caseWithDocument(DOCX, DOCX_BYTES);
    const referralId = await referralOn(caseId);
    mock.setScenario("preview-converter-unavailable");

    const preview = await previewJudicialDocument(referralId, documentId, judge(JUDGE));
    const original = await downloadJudicialDocument(referralId, documentId, judge(JUDGE));

    expect(preview).toMatchObject({ ok: false, error: { kind: "preview-refused", code: "PREVIEW_UNAVAILABLE" } });
    expect(original.ok && (await buffered(original.data.body))).toEqual(DOCX_BYTES);
  });
});

describe("the preview request", () => {
  it("should ask for a PDF with the caller's token, at the scoped path with each id encoded", async () => {
    const seen: { url?: string; headers?: IncomingHttpHeaders } = {};
    const server = await listen(
      createServer((req, res) => {
        seen.url = req.url;
        seen.headers = req.headers;
        sendPdf(res, syntheticPdf(1, "Page"));
      })
    );

    try {
      const caseworker = await previewDocument("case/1?x", "doc#2", { baseUrl: server.url, accessToken: "caseworker-token" });
      if (caseworker.ok) await buffered(caseworker.data.body);
      expect(seen.url).toBe("/caseworker/cases/case%2F1%3Fx/documents/doc%232/preview");
      expect(seen.headers?.accept).toBe("application/pdf");
      expect(seen.headers?.authorization).toBe("Bearer caseworker-token");

      const judicial = await previewJudicialDocument("ref/1", "doc 2", { baseUrl: server.url, accessToken: "judge-token" });
      if (judicial.ok) await buffered(judicial.data.body);
      expect(seen.url).toBe("/judicial/referrals/ref%2F1/documents/doc%202/preview");
      expect(seen.headers?.authorization).toBe("Bearer judge-token");
    } finally {
      await server.close();
    }
  });

  it("should send nothing for an id that would move the path", async () => {
    const result = await previewDocument("..", "doc-1", { baseUrl: "http://localhost:1" });

    expect(result).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });
});

describe("the preview response's contract", () => {
  it.each([
    ["not a PDF", { "content-type": "text/html" }, "is not a PDF"],
    ["missing its type", {}, "is not a PDF"],
    ["not a PDF and larger than the limit", { "content-type": "text/html", "x-declared": String(DOCUMENT_PREVIEW_LIMITS.maxOutputBytes + 1) }, "is not a PDF"],
    [
      "larger than the limit",
      { "content-type": "application/pdf", "x-declared": String(DOCUMENT_PREVIEW_LIMITS.maxOutputBytes + 1) },
      "larger than the published limit"
    ]
  ])("should refuse a 200 that is %s as an invalid response", async (_label, headers, message) => {
    const server = await listen(
      createServer((_req, res) => {
        const { "x-declared": declared, ...rest } = headers as Record<string, string>;
        res.writeHead(200, declared === undefined ? rest : { ...rest, "content-length": declared });
        res.flushHeaders();
        if (declared === undefined) res.end("<html></html>");
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: server.url });

      expect(result).toMatchObject({ ok: false, error: { kind: "invalid-response", message: expect.stringContaining(message) } });
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it("should report a missing body before checking its type or declared size", async () => {
    const server = await listen(
      createServer((_req, res) => {
        res.writeHead(204, { "content-type": "text/html", "content-length": String(DOCUMENT_PREVIEW_LIMITS.maxOutputBytes + 1) });
        res.end();
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: server.url });

      expect(result).toEqual({
        ok: false,
        error: { kind: "invalid-response", status: 204, message: "GET /caseworker/cases/case-1/documents/doc-1/preview returned no body" }
      });
    } finally {
      await server.close();
    }
  });

  it("should accept a PDF type with parameters and in any case", async () => {
    const server = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "Application/PDF; charset=binary" });
        res.end(syntheticPdf(1, "Page"));
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: server.url });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.contentLength).toBeNull();
      expect(pdfPages(await buffered(result.data.body))).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("should error the body, not end it short, when api sends more than the limit", async () => {
    const chunk = Buffer.alloc(1024 * 1024);
    const server = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf" });
        let sent = 0;
        const more = () => {
          while (sent <= DOCUMENT_PREVIEW_LIMITS.maxOutputBytes) {
            sent += chunk.length;
            if (!res.write(chunk)) return res.once("drain", more);
          }
          res.end();
        };
        more();
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: server.url, timeoutMs: 5_000 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await expect(buffered(result.data.body)).rejects.toThrow("larger than the published limit");
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });
});

describe("the preview's failures", () => {
  it.each([
    [401, { error: "Authentication required" }, "unauthorized"],
    [403, { error: "Forbidden" }, "forbidden"],
    [404, { error: "Document not found" }, "not-found"],
    [502, { error: "The document store would not return the original" }, "unavailable"],
    // api's code on a status api never publishes it with is not taken at its word.
    [422, { error: "This document is busy", code: "PREVIEW_BUSY" }, "validation"],
    [503, { error: "Too large", code: "PREVIEW_LIMIT_EXCEEDED" }, "unavailable"],
    // The abuse limiter's 429 carries no preview code.
    [429, { error: "Too many requests" }, "rate-limited"]
  ])("should classify a %i as %s when its body is %j", async (status, body, kind) => {
    const server = await listen(
      createServer((_req, res) => {
        res.writeHead(status, { "content-type": "application/json", "retry-after": "7" });
        res.end(JSON.stringify(body));
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: server.url });

      expect(result).toMatchObject({ ok: false, error: { kind } });
    } finally {
      await server.close();
    }
  });

  it("should read a busy refusal's wait as not known when Retry-After is not whole seconds", async () => {
    const server = await listen(
      createServer((_req, res) => {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "soon" });
        res.end(JSON.stringify({ error: "Busy", code: "PREVIEW_BUSY" }));
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: server.url });

      expect(result).toEqual({ ok: false, error: { kind: "preview-refused", code: "PREVIEW_BUSY", status: 429, retryAfterSeconds: null } });
    } finally {
      await server.close();
    }
  });
});

describe("the preview's timeout and cancellation", () => {
  let armed: number[];

  beforeEach(() => {
    armed = [];
    const realTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms !== undefined && ms >= DEFAULT_TIMEOUT_MS) armed.push(ms);
      return realTimeout(handler, ms !== undefined && ms >= DEFAULT_TIMEOUT_MS ? ms / CLOCK_SCALE : ms, ...rest);
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should wait longer than the JSON default for api to finish a conversion", async () => {
    vi.restoreAllMocks();
    // Advance the deadline only after real HTTP reaches api, rather than racing socket I/O against 27 ms.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const received = Promise.withResolvers<ServerResponse>();
    const slow = await listen(createServer((_req, res) => received.resolve(res)));

    try {
      let settled = false;
      const pending = previewDocument("case-1", "doc-1", { baseUrl: slow.url }).then((result) => {
        settled = true;
        return result;
      });
      const response = await received.promise;

      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);

      expect(settled).toBe(false);
      expect(timeout).toHaveBeenCalledWith(expect.any(Function), PREVIEW_TIMEOUT_MS);
      sendPdf(response, syntheticPdf(1, "Page"));
      const result = await pending;

      expect(result.ok).toBe(true);
      if (result.ok) await buffered(result.data.body);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
      slow.closeAllConnections();
      await slow.close();
    }
  });

  it("should time out a preview api never answers, and cap a longer configured timeout at its own", async () => {
    const silent = await listen(createServer(() => {}));

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: silent.url, timeoutMs: 60_000 });

      expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
      expect(armed).toContain(PREVIEW_TIMEOUT_MS);
      expect(armed).not.toContain(60_000);
    } finally {
      silent.closeAllConnections();
      await silent.close();
    }
  });

  it("should let a shorter configured timeout win", async () => {
    const silent = await listen(createServer(() => {}));

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: silent.url, timeoutMs: 15_000 });

      expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
      expect(armed).toContain(15_000);
      expect(armed).not.toContain(PREVIEW_TIMEOUT_MS);
    } finally {
      silent.closeAllConnections();
      await silent.close();
    }
  });

  it("should error a body that keeps trickling past the timeout, counted from the request rather than per read", async () => {
    let trickle: NodeJS.Timeout | undefined;
    const steady = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.write("%PDF-1.4\n");
        trickle = setInterval(() => res.write("%\n"), 20);
        res.once("close", () => clearInterval(trickle));
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: steady.url, timeoutMs: 300 });

      expect(result.ok).toBe(true);
      if (result.ok) await expect(buffered(result.data.body)).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      clearInterval(trickle);
      steady.closeAllConnections();
      await steady.close();
    }
  });

  it("should release api's connection at the timeout even while nobody is reading the body", async () => {
    const closed = Promise.withResolvers<void>();
    let trickle: NodeJS.Timeout | undefined;
    const steady = await listen(
      createServer((req, res) => {
        req.socket.once("close", () => closed.resolve());
        res.writeHead(200, { "content-type": "application/pdf" });
        res.write("%PDF-1.4\n");
        trickle = setInterval(() => res.write("%\n"), 20);
        res.once("close", () => clearInterval(trickle));
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: steady.url, timeoutMs: 300 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const failed = new Promise((resolve) => result.data.body.once("error", resolve));

      await closed.promise;

      result.data.body.resume();
      await expect(failed).resolves.toMatchObject({ name: "TimeoutError" });
    } finally {
      clearInterval(trickle);
      steady.closeAllConnections();
      await steady.close();
    }
  });
});

describe("cancelling a preview", () => {
  it("should stop waiting, and close api's connection, when the caller gives up before the answer", async () => {
    const closed = Promise.withResolvers<void>();
    const silent = await listen(
      createServer((req) => {
        req.socket.once("close", () => closed.resolve());
      })
    );
    const caller = new AbortController();

    try {
      const pending = previewDocument("case-1", "doc-1", { baseUrl: silent.url, signal: caller.signal });
      setTimeout(() => caller.abort(), 20);

      await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "timeout" } });
      await closed.promise;
    } finally {
      await silent.close();
    }
  });

  it("should release api's connection when the relayed body is destroyed mid-transfer", async () => {
    const closed = Promise.withResolvers<void>();
    const server = await listen(
      createServer((req, res) => {
        req.socket.once("close", () => closed.resolve());
        res.writeHead(200, { "content-type": "application/pdf" });
        res.write("%PDF-1.4\n");
      })
    );

    try {
      const result = await previewDocument("case-1", "doc-1", { baseUrl: server.url });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      result.data.body.once("error", () => {});
      result.data.body.destroy();

      await closed.promise;
    } finally {
      await server.close();
    }
  });
});

async function newCase(): Promise<string> {
  const created = await createCase({ dateReceived: DATE_RECEIVED }, config);
  if (!created.ok) throw new Error(`case was not created: ${created.error.message}`);

  return created.data.id;
}

async function caseWithDocument(mimeType: string, bytes: Buffer, name = "document"): Promise<{ caseId: string; documentId: string }> {
  const caseId = await newCase();
  const uploaded = await uploadDocument(caseId, { documentTypeId: DOCUMENT_TYPE_ID, name, mimeType, bytes: new Uint8Array(bytes) }, config);
  if (!uploaded.ok) throw new Error(`document was not uploaded: ${uploaded.error.message}`);

  return { caseId, documentId: uploaded.data.id };
}

async function referralOn(caseId: string): Promise<string> {
  const created = await createReferral(caseId, { reasons: ["Minor"] }, config);
  if (!created.ok) throw new Error(`referral was not created: ${created.error.message}`);

  return created.data.id;
}

function judge(subject: string): ApiConfig {
  return { ...config, accessToken: `x.${Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url")}.signature` };
}

function sendPdf(res: ServerResponse, pdf: Buffer): void {
  res.writeHead(200, { "content-type": "application/pdf", "content-length": String(pdf.length) });
  res.end(pdf);
}

async function buffered(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));

  return Buffer.concat(chunks);
}

async function listen(server: Server): Promise<{ url: string; close: () => Promise<void>; closeAllConnections: () => void }> {
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address();

  return {
    url: `http://localhost:${address && typeof address === "object" ? address.port : 0}`,
    closeAllConnections: () => server.closeAllConnections(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
