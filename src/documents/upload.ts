/**
 * Multipart parsing for the SSR document-upload form.
 *
 * `app.ts` mounts `express.urlencoded()`, which parses an ordinary form post but not
 * `multipart/form-data`, so without this the upload page would see an empty `req.body` and no file at
 * all. Mounted per-route rather than globally: it is the only form in the app that sends a file, and a
 * global multipart parser would be inspecting bodies it can never be given.
 *
 * The limits, accepted types and messages come from `@hmcts/deed-poll`'s `upload-policy.ts`, so the
 * SSR form and the API cannot disagree about what the service accepts. Only the Multer wiring is
 * per-app, because Multer is Express middleware and the domain library is framework-free.
 *
 * **It does NOT propagate a rejection, and that is the one real difference from the API's copy.**
 * The API wants Multer's failures to reach its error middleware, which turns them into a JSON 400.
 * A page cannot work that way: re-rendering the form with the message against the affected input is the
 * page's job, and an error handler has no idea which form to re-render. So a rejection is recorded on
 * `res.locals` and `next()` is called normally, leaving the handler to decide.
 *
 * That distinction was not obvious. Propagating it here produced a **500** — `domainErrorHandler`
 * deliberately passes `InvalidInputError` on, on the grounds that a page which validates is expected
 * to have caught it, which is true of a handler and false of middleware running before one. In
 * development the starter's 500 page even showed the right message, which made it look like a status
 * bug rather than a routing one.
 *
 * Memory storage rather than disk, because `uploadDocument` puts the bytes straight into the multipart
 * body it sends `deed-poll-api`. Multer's disk storage would write a temp file for us to read back and
 * forward, and would leave the temp file behind on a failure path — and this app now has no local file
 * storage at all, which is what task 4 of `docs/plans/completed/02-dal-cutover-to-api.md` removed.
 */
import { type InvalidInputError, isAllowedUploadType, MAX_UPLOAD_BYTES, UPLOAD_FILE_FIELD, uploadLimitRejection, uploadTypeRejection } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    // documentTypeId, name and direction in document-upload.njk. The longest valid value is
    // schemas.ts's 100-character name. The parser rejects at 1024 bytes (allows up to 1023),
    // leaving room for the name's UTF-8 encoding. multer 2.5.0 accepts a field of exactly
    // `fieldSize` bytes, so the limit is the largest accepted size, not the first refused one.
    fields: 3,
    fieldSize: 1023,
    // Three text fields plus one file; also bounds parts ignored by the field/file counters.
    parts: 4
  },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedUploadType(file.mimetype)) {
      callback(uploadTypeRejection(file.mimetype));
      return;
    }
    callback(null, true);
  }
});

/** Where a rejection is left for the handler to find. */
export function uploadRejection(res: Response): InvalidInputError | undefined {
  return res.locals.uploadRejection as InvalidInputError | undefined;
}

export function uploadSingleFile(): RequestHandler {
  const parse = parser.single(UPLOAD_FILE_FIELD);

  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        res.locals.uploadRejection = uploadLimitRejection(error.code, error.field);
        return next();
      }
      // The fileFilter's rejection is already a domain error; anything else is a real fault.
      if (error && typeof error === "object" && "errors" in error) {
        res.locals.uploadRejection = error as InvalidInputError;
        return next();
      }
      next(error);
    });
  };
}
