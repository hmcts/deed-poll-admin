/**
 * A single document's metadata, ported from `documents.controller.ts` (`@Get(':id')`).
 *
 * **`GET` only.** api publishes neither a document patch nor a document delete — both are in the
 * plan's "out of scope" list, not rebuilt until something asks — so the `PATCH` and `DELETE` went with
 * `updateDocument` and `removeDocument`. The blob cleanup the delete used to do is gone with them: api
 * owns the bytes, so there is no local file to orphan.
 *
 * Both ids are still passed. `findDocument` looks only in this case's own document list, so a document
 * belonging to another case is a 404 rather than reachable through the wrong parent's URL.
 */
import { findDocument } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDocument(req.params.id, req.params.documentId, callerFromRequest(req)));
};
