/**
 * SSR document-upload form, ported from the prototype's `@Get(':id/documents/upload')` /
 * `@Post(...)`.
 *
 * Static, so it resolves before `[documentId]/file.ts` — `sortRoutes` orders by parameter count and
 * this has one fewer.
 *
 * The POST exports an **array** so the multipart parser runs before the handler — a shape
 * `simple-router` supports for exactly this. See `apps/web/src/documents/upload.ts`.
 *
 * **The file cannot be preserved across a re-render**, because browsers do not repopulate a file
 * input — so unlike the note forms, a rejected upload always costs the caseworker the file selection.
 * The other three fields can be kept, and are: re-rendering still beats the prototype's `?error=`
 * redirect, which discarded the type and direction choices as well.
 *
 * Document types come from the reference table, so an empty table shows a message rather than an
 * unusable form with no options.
 */
import {
  findDeedPoll,
  findDocumentTypes,
  InvalidInputError,
  MAX_UPLOAD_BYTES,
  NotFoundError,
  uploadDocument,
  uploadFormSchema,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { uploadRejection, uploadSingleFile } from "../../../../documents/upload.js";

const en = {
  title: "Upload a document",
  heading: "Upload a document",
  fileLabel: "Choose a file",
  // Derived from the policy rather than restated, because a hint that disagrees with the limit is worse
  // than no hint: it told the caseworker 10MB while the limit was raised to 25MB, so the number they
  // were shown and the number enforced would have drifted apart the moment either changed.
  fileHint: `PDF, JPG, PNG, TIFF or Word, up to ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
  typeLabel: "Document type",
  typeEmpty: "Choose a type",
  nameLabel: "Name (optional)",
  nameHint: "Leave blank to use the file's own name.",
  directionLabel: "Direction",
  directionHint: "Incoming for documents received from the applicant, outgoing for documents we send.",
  submit: "Upload",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  noTypes: "No document types have been set up, so a document cannot be filed yet."
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

const directionOptions = [
  { value: "Incoming", text: "Incoming" },
  { value: "Outgoing", text: "Outgoing" }
];

export const GET = async (req: Request, res: Response) => {
  await render(req, res, {});
};

const handler = async (req: Request, res: Response) => {
  // The parser records its own rejections rather than throwing them, because re-rendering this form
  // is this handler's job and an error handler could not know which form to re-render. See
  // ../../../../documents/upload.ts.
  const rejected = uploadRejection(res);
  if (rejected) {
    const first = rejected.errors[0];
    return rerender(req, res, first?.field ?? "file", first?.message ?? rejected.message);
  }

  const body = req.body as Record<string, string>;
  const parsed = uploadFormSchema.safeParse({
    documentTypeId: body.documentTypeId || undefined,
    name: body.name || undefined,
    direction: body.direction || undefined
  });

  if (!parsed.success) {
    const [first] = zodErrorToFieldErrors(parsed.error);
    return rerender(req, res, first?.field ?? "documentTypeId", first?.message ?? "Check the form");
  }

  try {
    await uploadDocument(
      req.params.id,
      parsed.data.documentTypeId,
      req.file,
      { name: parsed.data.name, direction: parsed.data.direction },
      callerFromRequest(req)
    );
  } catch (error) {
    // A missing file arrives as InvalidInputError("Select a file to upload") from the domain, which
    // owns that message so this page and the API give the same one. api's own rejections arrive the
    // same way, carrying its field names — which are this form's field names, so an error against
    // `documentTypeId` still lands on the control the caseworker used. An unknown document type
    // arrives as NotFoundError: a 404 would be wrong here, because they picked from a list this page
    // rendered, so it belongs against the field they chose from.
    if (error instanceof InvalidInputError) {
      return rerender(req, res, error.errors[0]?.field ?? "file", error.errors[0]?.message ?? error.message);
    }
    if (error instanceof NotFoundError) {
      return rerender(req, res, "documentTypeId", error.message);
    }
    throw error;
  }

  res.redirect(`/deed-polls/${req.params.id}#documents`);
};

export const POST = [uploadSingleFile(), handler];

async function rerender(req: Request, res: Response, field: string, message: string) {
  res.status(400);
  await render(req, res, { field, message });
}

async function render(req: Request, res: Response, error: { field?: string; message?: string }) {
  const caller = callerFromRequest(req);
  const [found, types] = await Promise.all([findDeedPoll(req.params.id, caller), findDocumentTypes(caller)]);

  res.render("deed-polls/document-upload", {
    case: found,
    // The file input is never repopulated, so only the choices are replayed.
    values: (req.body ?? {}) as Record<string, string>,
    documentTypes: [{ value: "", text: en.typeEmpty }, ...types.map((type) => ({ value: type.id, text: type.name }))],
    hasTypes: types.length > 0,
    directionOptions,
    errorField: error.field ?? null,
    errorMessage: error.message ?? null,
    en,
    cy
  });
}
