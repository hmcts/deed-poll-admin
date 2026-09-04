/**
 * Upload a file and create its document row, ported from `@Post('upload')` with
 * `@UseInterceptors(FileInterceptor('file'))`.
 *
 * The only multipart route in the service. It exports an **array** so the parser runs before the
 * handler — the same shape `requireRoles` uses, which `simple-router`'s `normalizeHandlers`
 * expects. See `apps/api/src/documents/upload.ts` for the size and type limits, neither of which
 * the prototype had.
 *
 * Static, so it must resolve before `[documentId].ts` or `/documents/upload` would be read as a
 * document id. `sortRoutes` orders by parameter count and this has one fewer than the dynamic
 * route, so it wins — the same mechanism that saves `field-rules`, and pinned by a wiring test for
 * the same reason: nothing in this file states the dependency.
 *
 * **The mapping onto `UploadedFile` is the point of the whole exercise.** `uploadDocument` takes a
 * plain `{ buffer, originalname, mimetype, size }` rather than `Express.Multer.File`, deliberately,
 * so the domain has no idea Multer exists. Those four fields are all it ever read.
 */
import { uploadDocument, uploadFormSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { uploadSingleFile } from "../../../../documents/upload.js";

const handler = async (req: Request, res: Response) => {
  // The non-file fields arrive on req.body once the parser above has run. Validated rather than
  // read raw: the prototype took them as untyped primitives its ValidationPipe skipped entirely.
  const parsed = uploadFormSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  // `req.file` is undefined when no part was sent under the field name. That is deliberately not
  // checked here — `uploadDocument` throws InvalidInputError("Select a file to upload"), so the
  // message stays with the rule and both callers (this and the Phase 4 form) get the same one.
  const created = await uploadDocument(req.params.id, parsed.data.documentTypeId, req.file, {
    name: parsed.data.name,
    direction: parsed.data.direction
  });

  res.status(201).json(created);
};

export const POST = [uploadSingleFile(), handler];
