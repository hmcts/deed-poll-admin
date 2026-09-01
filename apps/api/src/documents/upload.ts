/**
 * Multipart parsing for the one route that accepts a file upload.
 *
 * `app.ts` mounts `express.json()` and `express.urlencoded()`; neither parses
 * `multipart/form-data`, so without this the upload route would see an empty `req.body` and no
 * file at all. This is a body parser for a single content type, mounted per-route rather than
 * globally — every other route in the app takes JSON, and a global multipart parser would be
 * inspecting bodies it can never be given.
 *
 * Replaces the prototype's `@UseInterceptors(FileInterceptor('file'))`, which took no options and
 * so accepted **any file of any size** into memory. That is not ported: see the two limits below.
 *
 * Memory storage rather than disk, because `saveFile(buffer)` in the domain takes a `Buffer`.
 * Multer's disk storage would write a temp file for us to read straight back and write again, and
 * would leave the temp file behind on a failure path.
 */
import { InvalidInputError } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

/**
 * 10 MB. Chosen on 2026-09-01 for scanned certificates and multi-page PDFs, which is what these
 * documents are; there was no existing limit anywhere in the repo or the prototype to inherit.
 * **Confirm against real-world file sizes with the service team** — it is a defensible guess, not
 * a researched number.
 *
 * A limit matters more here than it looks: the file is buffered in memory, so the worst case is
 * this figure multiplied by concurrent uploads, against the pod's memory limit.
 */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Accepted MIME types: PDF, the common scan formats, and Word for documents produced by the court.
 *
 * **This is hygiene, not security.** The type is taken from the `Content-Type` the client puts on
 * the part, which a client can simply lie about — it stops an accidental upload of the wrong thing
 * and keeps obvious executables out, and it does not verify that the bytes are what they claim.
 * Real inspection and virus scanning belong with CDAM in Phase 10.
 */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

/** The multipart field name the SSR form posts under (`document-upload.njk`). */
const FILE_FIELD = "file";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      // An InvalidInputError, so `errorHandler` answers 400 with the failure attributed to the
      // file input the form actually renders, rather than a generic 500 from an unrecognised error.
      callback(
        new InvalidInputError(`${file.mimetype} is not an accepted file type`, [{ field: FILE_FIELD, message: "Upload a PDF, image or Word document" }])
      );
      return;
    }
    callback(null, true);
  }
});

/**
 * Parses the upload, translating Multer's own rejections into domain errors on the way out.
 *
 * Multer reports a too-large file by calling `next(MulterError)`, which is not a domain error, so
 * unwrapped it would reach the error middleware unrecognised and become a 500 — telling a
 * caseworker the server had broken when in fact their file was too big. The same trap the
 * reference-number and document-type defects fell into, so it is handled at the source.
 */
export function uploadSingleFile(): RequestHandler {
  const parse = parser.single(FILE_FIELD);

  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(mapMulterError(error));
        return;
      }
      next(error);
    });
  };
}

function mapMulterError(error: multer.MulterError): InvalidInputError {
  const message =
    error.code === "LIMIT_FILE_SIZE"
      ? `The file must be smaller than ${Math.round(MAX_BYTES / (1024 * 1024))}MB`
      : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
        ? "Upload one file at a time"
        : "The file could not be read";

  return new InvalidInputError(message, [{ field: FILE_FIELD, message }]);
}
