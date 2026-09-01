/**
 * Documents collection for a case, ported from `documents.controller.ts` (`@Get()` / `@Post()`).
 *
 * `POST` here creates **metadata only** — the row and its document-type reference, with no file
 * attached. Attaching bytes is a separate route (`upload.ts`), which is how the prototype had it:
 * a document can be logged as expected-but-not-yet-received, and the file arrives later.
 */
import { createDocument, createDocumentSchema, findDocuments } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDocuments(req.params.id));
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.status(201).json(await createDocument(req.params.id, parsed.data));
};
