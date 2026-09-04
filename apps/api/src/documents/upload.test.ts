/**
 * Driven through a real Express app with real multipart bodies, because that is the only way to
 * exercise Multer: its limits and filter are enforced inside its own stream handling, so calling
 * the middleware with a request double proves nothing.
 */
import { InvalidInputError, MAX_UPLOAD_BYTES } from "@hmcts/deed-poll";
import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../errors.js";
import { uploadSingleFile } from "./upload.js";

// Sizes are derived from the policy rather than restated: this file already had to be edited when the
// limit moved from 10MB to 25MB, and a test that hardcodes the threshold it is checking stops testing
// the threshold the moment the two disagree.

function appWithUpload(): Express {
  const app = express();
  app.post("/upload", [
    uploadSingleFile(),
    (req: express.Request, res: express.Response) => {
      res.json({
        received: req.file ? { name: req.file.originalname, type: req.file.mimetype, size: req.file.size } : null,
        fields: req.body
      });
    }
  ]);
  app.use(errorHandler());
  return app;
}

describe("uploadSingleFile", () => {
  it("should put the file on req.file with the four fields the domain needs", async () => {
    const response = await request(appWithUpload())
      .post("/upload")
      .attach("file", Buffer.from("%PDF-1.4 fake"), { filename: "birth.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(200);
    expect(response.body.received).toEqual({ name: "birth.pdf", type: "application/pdf", size: 13 });
  });

  it("should put the other form fields on req.body, which express.json cannot do for multipart", async () => {
    const response = await request(appWithUpload())
      .post("/upload")
      .field("documentTypeId", "07f3f0e0-0000-4000-8000-000000000000")
      .field("direction", "Outgoing")
      .attach("file", Buffer.from("x"), { filename: "a.pdf", contentType: "application/pdf" });

    expect(response.body.fields).toEqual({
      documentTypeId: "07f3f0e0-0000-4000-8000-000000000000",
      direction: "Outgoing"
    });
  });

  it("should leave req.file undefined when no file part is sent, rather than erroring", async () => {
    // The domain owns that message ("Select a file to upload"), so the parser must not pre-empt it.
    const response = await request(appWithUpload()).post("/upload").field("documentTypeId", "x");

    expect(response.status).toBe(200);
    expect(response.body.received).toBeNull();
  });

  it("should reject a file over 25MB as a 400, not a 500", async () => {
    // Multer signals this with a MulterError, which is not a domain error — unwrapped it would
    // reach the error middleware unrecognised and tell the caller the server had broken.
    const response = await request(appWithUpload())
      .post("/upload")
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES + 1), { filename: "big.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([{ field: "file", message: "The file must be smaller than 25MB" }]);
  });

  it("should accept a file just under the limit, so the boundary is not off by a megabyte", async () => {
    const response = await request(appWithUpload())
      .post("/upload")
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES - 1), { filename: "big.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(200);
    expect(response.body.received.size).toBe(MAX_UPLOAD_BYTES - 1);
  });

  it("should reject a file type not on the list, attributed to the file input", async () => {
    const response = await request(appWithUpload())
      .post("/upload")
      .attach("file", Buffer.from("MZ"), { filename: "evil.exe", contentType: "application/x-msdownload" });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([{ field: "file", message: "Upload a PDF, image or Word document" }]);
  });

  it.each([
    ["application/pdf", "a.pdf"],
    ["image/jpeg", "a.jpg"],
    ["image/png", "a.png"],
    ["image/tiff", "a.tif"],
    ["application/msword", "a.doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"]
  ])("should accept %s", async (contentType, filename) => {
    const response = await request(appWithUpload()).post("/upload").attach("file", Buffer.from("x"), { filename, contentType });

    expect(response.status).toBe(200);
  });

  it("should reject a second file rather than silently taking one of them", async () => {
    const response = await request(appWithUpload())
      .post("/upload")
      .attach("file", Buffer.from("a"), { filename: "a.pdf", contentType: "application/pdf" })
      .attach("file", Buffer.from("b"), { filename: "b.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([{ field: "file", message: "Upload one file at a time" }]);
  });

  it("should reject a file sent under a different field name", async () => {
    const response = await request(appWithUpload())
      .post("/upload")
      .attach("attachment", Buffer.from("a"), { filename: "a.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(400);
  });

  it("should raise a domain error, so nothing downstream needs to know Multer exists", async () => {
    // Guards the seam rather than the status: uploadSingleFile is the only place in the app that
    // imports multer, and mapMulterError is what keeps it that way.
    const app = express();
    let captured: unknown;
    app.post("/upload", [uploadSingleFile(), (_req: express.Request, res: express.Response) => res.json({})]);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      captured = err;
      res.status(500).json({});
    });

    await request(app)
      .post("/upload")
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES + 1), { filename: "big.pdf", contentType: "application/pdf" });

    expect(captured).toBeInstanceOf(InvalidInputError);
  });
});
