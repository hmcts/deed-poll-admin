/**
 * A single document type, ported from `document-types.controller.ts` (`@Get(':id')` /
 * `@Patch(':id')` / `@Delete(':id')`).
 *
 * There is no parent to scope against here, unlike the nested children — a type is global, so its
 * id alone identifies it.
 *
 * `DELETE` can answer **409**, which no other route in this phase does: `removeDocumentType`
 * refuses while any document still references the type. See that function for why the check is
 * explicit rather than left to the foreign key.
 */
import { findDocumentType, removeDocumentType, updateDocumentType, updateDocumentTypeSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDocumentType(req.params.id));
};

export const PATCH = async (req: Request, res: Response) => {
  const parsed = updateDocumentTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.json(await updateDocumentType(req.params.id, parsed.data));
};

export const DELETE = async (req: Request, res: Response) => {
  await removeDocumentType(req.params.id);

  res.status(204).send();
};
