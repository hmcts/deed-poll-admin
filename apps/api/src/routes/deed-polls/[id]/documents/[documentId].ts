/**
 * A single document's metadata, ported from `documents.controller.ts` (`@Get(':id')` /
 * `@Patch(':id')` / `@Delete(':id')`).
 *
 * Both ids on every call, as with notes and witnesses: `findDocument` matches on
 * `{ id, deedPollId }`, so a document belonging to another case is a 404 rather than reachable
 * through the wrong parent's URL.
 *
 * `DELETE` removes the row and then its stored blob. It answers 204 even if the blob cleanup
 * fails — see `removeDocument`, where that is deliberate and was not always true.
 */
import { findDocument, removeDocument, updateDocument, updateDocumentSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDocument(req.params.id, req.params.documentId));
};

export const PATCH = async (req: Request, res: Response) => {
  const parsed = updateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.json(await updateDocument(req.params.id, req.params.documentId, parsed.data));
};

export const DELETE = async (req: Request, res: Response) => {
  await removeDocument(req.params.id, req.params.documentId);

  res.status(204).send();
};
