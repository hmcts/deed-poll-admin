import { z } from "zod";
import { DocumentDirection } from "../deed-poll/enums/option-sets.js";
import { MAX_UPLOAD_NAME_LENGTH, UPLOAD_NAME_TOO_LONG } from "./upload-policy.js";

/**
 * The non-file fields of the upload form, which arrive alongside the file in a multipart body.
 *
 * **The only document schema left.** `createDocumentSchema` and `updateDocumentSchema` described a
 * metadata-only create and a metadata patch, and `createDocumentTypeSchema`/`updateDocumentTypeSchema`
 * described document-type writes — api has none of the four, deliberately, so they went with the
 * services in task 4 of `docs/plans/completed/02-dal-cutover-to-api.md` rather than being kept as validation for
 * operations nothing can perform.
 *
 * An upload supplies less than a create did: `direction` and `name` are optional, because api defaults
 * the direction to Incoming and falls back to the file's own name, and the storage fields are gone
 * entirely — api owns where the bytes are.
 *
 * The prototype validated none of this — `@Body('documentTypeId')` and friends are raw primitives,
 * which its global `ValidationPipe` skipped, so an unrecognised `direction` reached Prisma and a
 * missing `documentTypeId` produced a foreign-key failure. Both are 400s here, and a 400 raised before
 * the bytes are put on the wire rather than after.
 *
 * Every value arrives as a string: multipart carries no types. That only shows in `direction`, whose
 * enum members are strings anyway.
 */
export const uploadFormSchema = z.object({
  documentTypeId: z.uuid(),
  name: z.string().max(MAX_UPLOAD_NAME_LENGTH, UPLOAD_NAME_TOO_LONG).optional(),
  direction: z.enum(DocumentDirection).optional()
});

export type UploadFormInput = z.infer<typeof uploadFormSchema>;
