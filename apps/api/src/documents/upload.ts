/**
 * Multipart parsing for the one API route that accepts a file upload.
 *
 * `app.ts` mounts `express.json()` and `express.urlencoded()`; neither parses
 * `multipart/form-data`, so without this the upload route would see an empty `req.body` and no file
 * at all. This is a body parser for a single content type, mounted per-route rather than globally —
 * every other route in the app takes JSON, and a global multipart parser would be inspecting bodies
 * it can never be given.
 *
 * Replaces the prototype's `@UseInterceptors(FileInterceptor('file'))`, which took no options and so
 * accepted **any file of any size** into memory.
 *
 * **The limits and messages are not defined here.** They live in `@hmcts/deed-poll`'s
 * `upload-policy.ts`, because `apps/web` enforces the same ones for its SSR form and a size limit is
 * a decision about the service rather than about this app. Only the Multer wiring is per-app, since
 * Multer is Express middleware and the domain is framework-free.
 *
 * Memory storage rather than disk, because `uploadDocument` puts the bytes straight into the multipart
 * body it sends `deed-poll-api`. Multer's disk storage would write a temp file for us to read back and
 * forward, and would leave the temp file behind on a failure path — and this app now has no local file
 * storage at all, which is what task 4 of `docs/plans/02-dal-cutover-to-api.md` removed.
 */
import { isAllowedUploadType, MAX_UPLOAD_BYTES, UPLOAD_FILE_FIELD, uploadLimitRejection, uploadTypeRejection } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedUploadType(file.mimetype)) {
      callback(uploadTypeRejection(file.mimetype));
      return;
    }
    callback(null, true);
  }
});

/**
 * Parses the upload, translating Multer's own rejections into domain errors on the way out.
 *
 * Multer reports a too-large file by calling `next(MulterError)`, which is not a domain error, so
 * unwrapped it would reach the error middleware unrecognised and become a 500 — telling a caseworker
 * the server had broken when in fact their file was too big.
 */
export function uploadSingleFile(): RequestHandler {
  const parse = parser.single(UPLOAD_FILE_FIELD);

  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(uploadLimitRejection(error.code));
        return;
      }
      next(error);
    });
  };
}
