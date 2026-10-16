/**
 * Driven through a real Express app with real multipart bodies, because that is the only way to exercise
 * Multer: its limits and its filter are enforced inside its own stream handling, so calling the middleware
 * with a request double proves nothing.
 *
 * **The rejections are the point, not the happy path.** This is the only multipart parser in the repo, and
 * the one thing it does differently from an ordinary error path is record a rejection on `res.locals` and
 * call `next()` cleanly, so the upload page can re-render its own form. Propagating instead produced a
 * **500** — `domainErrorHandler` deliberately passes `InvalidInputError` on, which is true of a handler that
 * validates and false of middleware running before one — and that regression is invisible to the page's own
 * tests, which drive the handler and skip the parser. The equivalent tests for the deleted API's copy went
 * with it in this branch.
 *
 * Sizes come from the policy rather than being restated: a test that hardcodes the threshold it is checking
 * stops testing that threshold the moment the two disagree, which is what happened when the limit moved from
 * 10MB to 25MB.
 */
import { MAX_UPLOAD_BYTES, uploadFormSchema } from "@hmcts/deed-poll";
import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { uploadRejection, uploadSingleFile } from "./upload.js";

const A_PDF = { filename: "birth.pdf", contentType: "application/pdf" };

/**
 * The upload middleware behind a handler that reports what reached it.
 *
 * `faults` records anything that got past the parser as an error, so "did not propagate" is asserted
 * positively rather than by the absence of a 500.
 */
function appWithUpload(): { app: Express; faults: unknown[] } {
  const faults: unknown[] = [];
  const app = express();

  app.post("/upload", [
    uploadSingleFile(),
    (req: express.Request, res: express.Response) => {
      const rejected = uploadRejection(res);

      res.json({
        rejection: rejected ? { message: rejected.message, errors: rejected.errors } : null,
        received: req.file ? { name: req.file.originalname, type: req.file.mimetype, size: req.file.size } : null,
        fields: req.body
      });
    }
  ]);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    faults.push(error);
    res.status(500).json({});
  });

  return { app, faults };
}

describe("uploadSingleFile", () => {
  it("should put the file on req.file with the four fields the domain needs", async () => {
    const { app } = appWithUpload();

    const response = await request(app).post("/upload").attach("file", Buffer.from("%PDF-1.4 fake"), A_PDF);

    expect(response.status).toBe(200);
    expect(response.body.received).toEqual({ name: "birth.pdf", type: "application/pdf", size: 13 });
  });

  it("should put the other form fields on req.body, which express.urlencoded cannot do for multipart", async () => {
    const { app } = appWithUpload();

    const response = await request(app)
      .post("/upload")
      .field("documentTypeId", "07f3f0e0-0000-4000-8000-000000000000")
      .field("direction", "Outgoing")
      .attach("file", Buffer.from("x"), A_PDF);

    expect(response.body.fields).toEqual({ documentTypeId: "07f3f0e0-0000-4000-8000-000000000000", direction: "Outgoing" });
  });

  it("should leave req.file undefined when no file part is sent, rather than rejecting it here", async () => {
    // The domain owns that message ("Select a file to upload"), so the parser must not pre-empt it.
    const { app } = appWithUpload();

    const response = await request(app).post("/upload").field("documentTypeId", "x");

    expect(response.status).toBe(200);
    expect(response.body.received).toBeNull();
    expect(response.body.rejection).toBeNull();
  });

  it.each([true, false])("should accept all three fields and a maximum-length multibyte name (file first: %s)", async (fileFirst) => {
    const { app } = appWithUpload();
    const fields = { documentTypeId: "07f3f0e0-0000-4000-8000-000000000000", name: "漢".repeat(100), direction: "Incoming" };
    expect(uploadFormSchema.safeParse(fields).success).toBe(true);

    const upload = request(app).post("/upload");
    const response = await (fileFirst
      ? upload.attach("file", Buffer.from("x"), A_PDF).field(fields)
      : upload.field(fields).attach("file", Buffer.from("x"), A_PDF));

    expect(response.body.rejection).toBeNull();
    expect(response.body.fields).toEqual(fields);
    expect(response.body.received.size).toBe(1);
  });

  it("should reject a fourth text field without propagating a fault", async () => {
    const { app, faults } = appWithUpload();

    const response = await request(app).post("/upload").field({ documentTypeId: "x", name: "x", direction: "Incoming", extra: "x" });

    expect(response.body.rejection?.errors).toEqual([
      { field: "file", message: "The upload contains too many fields. Reload the page and select the file again." }
    ]);
    expect(faults).toEqual([]);
  });

  it.each([1024, 1025])("should reject a %s-byte text field without propagating a fault", async (bytes) => {
    const { app, faults } = appWithUpload();

    const response = await request(app).post("/upload").field("name", "x".repeat(bytes));

    expect(response.body.rejection?.errors).toEqual([{ field: "name", message: "The name must be 100 characters or fewer" }]);
    expect(faults).toEqual([]);
  });

  it("should leave text below the parser limit for the form schema to validate", async () => {
    const { app } = appWithUpload();

    const response = await request(app).post("/upload").field("name", "x".repeat(1023));

    expect(response.body.rejection).toBeNull();
    expect(response.body.fields.name).toHaveLength(1023);
  });

  it("should count ignored multipart sections towards the parts limit", async () => {
    const { app, faults } = appWithUpload();
    // No Content-Disposition: ignored by the field/file counters, but still consumes parser work.
    const body = `${"--boundary\r\nContent-Type: text/plain\r\n\r\nx\r\n".repeat(5)}--boundary--\r\n`;

    const response = await request(app).post("/upload").set("Content-Type", "multipart/form-data; boundary=boundary").send(body);

    expect(response.body.rejection?.errors).toEqual([
      { field: "file", message: "The upload contains too many parts. Reload the page and select one file again." }
    ]);
    expect(faults).toEqual([]);
  });

  it("should record an over-large file as a rejection the handler can render, not as a fault", async () => {
    const { app, faults } = appWithUpload();

    const response = await request(app)
      .post("/upload")
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES + 1), { filename: "big.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(200);
    expect(response.body.rejection.errors).toEqual([{ field: "file", message: "The file must be smaller than 25MB" }]);
    expect(faults).toEqual([]);
  });

  it("should accept a file just under the limit, so the boundary is not off by a megabyte", async () => {
    const { app } = appWithUpload();

    const response = await request(app)
      .post("/upload")
      .attach("file", Buffer.alloc(MAX_UPLOAD_BYTES - 1), { filename: "big.pdf", contentType: "application/pdf" });

    expect(response.body.received.size).toBe(MAX_UPLOAD_BYTES - 1);
    expect(response.body.rejection).toBeNull();
  });

  it("should record a disallowed file type as a rejection attributed to the file input", async () => {
    const { app, faults } = appWithUpload();

    const response = await request(app).post("/upload").attach("file", Buffer.from("MZ"), { filename: "evil.exe", contentType: "application/x-msdownload" });

    expect(response.body.rejection.errors).toEqual([{ field: "file", message: "Upload a PDF, image or Word document" }]);
    expect(faults).toEqual([]);
  });

  it.each([
    ["application/pdf", "a.pdf"],
    ["image/jpeg", "a.jpg"],
    ["image/png", "a.png"],
    ["image/tiff", "a.tif"],
    ["application/msword", "a.doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"]
  ])("should accept %s", async (contentType, filename) => {
    const { app } = appWithUpload();

    const response = await request(app).post("/upload").attach("file", Buffer.from("x"), { filename, contentType });

    expect(response.body.rejection).toBeNull();
    expect(response.body.received.type).toBe(contentType);
  });

  it("should record a second file as a rejection rather than silently taking one of them", async () => {
    const { app } = appWithUpload();

    const response = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("a"), { filename: "a.pdf", contentType: "application/pdf" })
      .attach("file", Buffer.from("b"), { filename: "b.pdf", contentType: "application/pdf" });

    expect(response.body.rejection.errors).toEqual([{ field: "file", message: "Upload one file at a time" }]);
  });

  it("should record a file sent under a different field name as a rejection", async () => {
    const { app, faults } = appWithUpload();

    const response = await request(app).post("/upload").attach("attachment", Buffer.from("a"), A_PDF);

    expect(response.body.rejection).not.toBeNull();
    expect(faults).toEqual([]);
  });
});
