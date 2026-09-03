/**
 * Wired-router tests for the documents routes.
 *
 * Its own file because these two need a real request in a way the others do not:
 *
 *  - **upload** is the only multipart route, exported as an array so the parser runs first. Whether
 *    that array is honoured, and whether `req.file` reaches the handler mapped onto the four fields
 *    the domain wants, cannot be shown by calling the handler with a request double — the double
 *    would simply supply whatever `req.file` the test invented.
 *  - **download** writes headers and a stream rather than JSON, so what a caller receives is the
 *    whole behaviour.
 *
 * Route ordering matters here too: `/documents/upload` and `/documents/:documentId` both match
 * `POST .../documents/upload`, and only `sortRoutes` ordering by parameter count keeps the static
 * one in front.
 */
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { DEEDPOLL_ADMIN, downloadDocument, findDocument, NotFoundError, uploadDocument } from "@hmcts/deed-poll";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../../../errors.js";
import { attachUserDouble } from "../../../../express-doubles.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDocuments: vi.fn(),
  createDocument: vi.fn(),
  findDocument: vi.fn(),
  updateDocument: vi.fn(),
  removeDocument: vi.fn(),
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn()
}));

const routesDir = fileURLToPath(new URL(".", import.meta.url));
const TYPE_ID = "07f3f0e0-0000-4000-8000-000000000000";

async function appWithDocumentRoutes(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(attachUserDouble(DEEDPOLL_ADMIN));
  app.use(await createSimpleRouter({ path: routesDir, prefix: "/deed-polls/:id/documents" }));
  app.use(errorHandler());
  return app;
}

describe("documents routes wired through simple-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  describe("upload", () => {
    it("should resolve /documents/upload as the static route, not as a document id", async () => {
      vi.mocked(uploadDocument).mockResolvedValue({ id: "doc-1" } as never);

      const response = await request(await appWithDocumentRoutes())
        .post("/deed-polls/case-1/documents/upload")
        .field("documentTypeId", TYPE_ID)
        .attach("file", Buffer.from("%PDF-1.4"), { filename: "birth.pdf", contentType: "application/pdf" });

      expect(response.status).toBe(201);
      expect(findDocument).not.toHaveBeenCalled();
    });

    it("should map req.file onto the four fields the domain takes, and nothing more", async () => {
      vi.mocked(uploadDocument).mockResolvedValue({ id: "doc-1" } as never);

      await request(await appWithDocumentRoutes())
        .post("/deed-polls/case-1/documents/upload")
        .field("documentTypeId", TYPE_ID)
        .field("name", "Birth certificate")
        .field("direction", "Outgoing")
        .attach("file", Buffer.from("%PDF-1.4"), { filename: "birth.pdf", contentType: "application/pdf" });

      expect(uploadDocument).toHaveBeenCalledWith(
        "case-1",
        TYPE_ID,
        expect.objectContaining({
          buffer: expect.any(Buffer),
          originalname: "birth.pdf",
          mimetype: "application/pdf",
          size: 8
        }),
        { name: "Birth certificate", direction: "Outgoing" }
      );
    });

    it("should pass the case id from the path, not from a form field", async () => {
      vi.mocked(uploadDocument).mockResolvedValue({ id: "doc-1" } as never);

      await request(await appWithDocumentRoutes())
        .post("/deed-polls/case-1/documents/upload")
        .field("documentTypeId", TYPE_ID)
        .field("deedPollId", "attacker-supplied")
        .attach("file", Buffer.from("x"), { filename: "a.pdf", contentType: "application/pdf" });

      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, expect.anything(), expect.anything());
    });

    it("should answer 400 when the document type is missing from the form", async () => {
      const response = await request(await appWithDocumentRoutes())
        .post("/deed-polls/case-1/documents/upload")
        .attach("file", Buffer.from("x"), { filename: "a.pdf", contentType: "application/pdf" });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([expect.objectContaining({ field: "documentTypeId" })]);
      expect(uploadDocument).not.toHaveBeenCalled();
    });

    it("should answer 400 for a file over the limit, not 500", async () => {
      const response = await request(await appWithDocumentRoutes())
        .post("/deed-polls/case-1/documents/upload")
        .field("documentTypeId", TYPE_ID)
        .attach("file", Buffer.alloc(25 * 1024 * 1024 + 1), { filename: "big.pdf", contentType: "application/pdf" });

      expect(response.status).toBe(400);
      expect(uploadDocument).not.toHaveBeenCalled();
    });

    it("should let the domain own the missing-file message rather than pre-empting it", async () => {
      const { InvalidInputError } = await import("@hmcts/deed-poll");
      vi.mocked(uploadDocument).mockRejectedValue(new InvalidInputError("Select a file to upload"));

      const response = await request(await appWithDocumentRoutes())
        .post("/deed-polls/case-1/documents/upload")
        .field("documentTypeId", TYPE_ID);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Select a file to upload");
      // Reached the domain with no file, rather than being rejected by the parser.
      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, undefined, expect.anything());
    });
  });

  describe("download", () => {
    const streaming = (body: string, doc: Record<string, unknown>) => {
      vi.mocked(downloadDocument).mockResolvedValue({ doc, stream: Readable.from([body]) } as never);
    };

    it("should stream the bytes back with the stored MIME type", async () => {
      streaming("file contents", { mimeType: "application/pdf", originalName: "birth.pdf", name: "birth.pdf" });

      // .buffer() because supertest parses an application/pdf response into a Buffer on
      // response.body rather than onto response.text.
      const response = await request(await appWithDocumentRoutes())
        .get("/deed-polls/case-1/documents/doc-1/file")
        .buffer();

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/pdf");
      expect(response.body.toString()).toBe("file contents");
    });

    it("should send it as an attachment named after the original file", async () => {
      streaming("x", { mimeType: "application/pdf", originalName: "birth certificate.pdf", name: "doc" });

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.headers["content-disposition"]).toBe('attachment; filename="birth certificate.pdf"');
    });

    it("should not let an uploaded filename inject into the header", async () => {
      // originalName is whatever the uploading client called the file. A quote would break out of
      // the quoted value; a newline would make the header invalid and Node would throw mid-response,
      // turning a working download into a 500.
      streaming("x", { mimeType: "application/pdf", originalName: 'evil".pdf\r\nX-Injected: yes', name: "doc" });

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.status).toBe(200);
      expect(response.headers["content-disposition"]).toBe('attachment; filename="evil.pdfX-Injected yes"');
      expect(response.headers["x-injected"]).toBeUndefined();
    });

    it("should fall back to a generic name when sanitising leaves nothing", async () => {
      streaming("x", { mimeType: "application/pdf", originalName: "日本語", name: "日本語" });

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.headers["content-disposition"]).toBe('attachment; filename="document"');
    });

    it("should default the content type when the row has none recorded", async () => {
      streaming("x", { mimeType: null, originalName: "a.pdf", name: "a.pdf" });

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.headers["content-type"]).toContain("application/octet-stream");
    });

    it("should tell caches not to keep case data", async () => {
      streaming("x", { mimeType: "application/pdf", originalName: "a.pdf", name: "a.pdf" });

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("should answer 404 when the row has no attached file", async () => {
      vi.mocked(downloadDocument).mockRejectedValue(new NotFoundError("This document has no attached file"));

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "This document has no attached file" });
    });

    it("should scope the download to both ids, so another case's document is not readable", async () => {
      vi.mocked(downloadDocument).mockRejectedValue(new NotFoundError("Document doc-1 not found"));

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/other-case/documents/doc-1/file");

      expect(response.status).toBe(404);
      expect(downloadDocument).toHaveBeenCalledWith("other-case", "doc-1");
    });
  });
});
