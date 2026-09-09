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
 *
 * The download's own headers are `deed-poll-api`'s now, forwarded rather than composed — so the four
 * filename tests that lived here, including the header-injection guard, moved with the responsibility.
 * What is left to prove at this end is that api's headers reach the client unaltered and that a failure
 * still becomes a status code.
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
  findDocument: vi.fn(),
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn()
}));

const routesDir = fileURLToPath(new URL(".", import.meta.url));
const TYPE_ID = "07f3f0e0-0000-4000-8000-000000000000";

/** The token the request arrives with, which every handler here forwards and nothing else. */
const CALLER = { accessToken: "caseworker-token" };

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
        .set("authorization", "Bearer caseworker-token")
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
        { name: "Birth certificate", direction: "Outgoing" },
        CALLER
      );
    });

    it("should pass the case id from the path, not from a form field", async () => {
      vi.mocked(uploadDocument).mockResolvedValue({ id: "doc-1" } as never);

      await request(await appWithDocumentRoutes())
        .post("/deed-polls/case-1/documents/upload")
        .field("documentTypeId", TYPE_ID)
        .field("deedPollId", "attacker-supplied")
        .attach("file", Buffer.from("x"), { filename: "a.pdf", contentType: "application/pdf" });

      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, expect.anything(), expect.anything(), expect.anything());
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
      // Rejected here rather than by api, which is the point of keeping `upload-policy.ts` local: a
      // 25MB body is not put on the wire only to be refused at the other end.
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
      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, undefined, expect.anything(), expect.anything());
    });
  });

  describe("download", () => {
    const streaming = (body: string, headers: { contentType: string; contentDisposition: string | null }) => {
      vi.mocked(downloadDocument).mockResolvedValue({ body: Readable.from([body]), ...headers } as never);
    };

    it("should stream the bytes back with the content type api sent", async () => {
      streaming("file contents", { contentType: "application/pdf", contentDisposition: 'attachment; filename="birth.pdf"' });

      // .buffer() because supertest parses an application/pdf response into a Buffer on
      // response.body rather than onto response.text.
      const response = await request(await appWithDocumentRoutes())
        .get("/deed-polls/case-1/documents/doc-1/file")
        .buffer();

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/pdf");
      expect(response.body.toString()).toBe("file contents");
    });

    it("should forward api's Content-Disposition unaltered, because api decides the filename", async () => {
      streaming("x", { contentType: "application/pdf", contentDisposition: 'attachment; filename="birth certificate.pdf"' });

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.headers["content-disposition"]).toBe('attachment; filename="birth certificate.pdf"');
    });

    it("should set no Content-Disposition at all when api sent none, rather than inventing a filename", async () => {
      streaming("x", { contentType: "application/pdf", contentDisposition: null });

      const response = await request(await appWithDocumentRoutes()).get("/deed-polls/case-1/documents/doc-1/file");

      expect(response.status).toBe(200);
      expect(response.headers["content-disposition"]).toBeUndefined();
    });

    it("should tell caches not to keep case data", async () => {
      streaming("x", { contentType: "application/pdf", contentDisposition: null });

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

      const response = await request(await appWithDocumentRoutes())
        .get("/deed-polls/other-case/documents/doc-1/file")
        .set("authorization", "Bearer caseworker-token");

      expect(response.status).toBe(404);
      expect(downloadDocument).toHaveBeenCalledWith("other-case", "doc-1", CALLER);
    });
  });
});
