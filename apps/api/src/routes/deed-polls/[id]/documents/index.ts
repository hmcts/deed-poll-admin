/**
 * Documents collection for a case, ported from `documents.controller.ts` (`@Get()`).
 *
 * **`GET` only.** The `POST` here created **metadata with no file attached** — a document logged as
 * expected-but-not-yet-received — and api has no endpoint for it: `DEED_POLL_API_PLAN.md` records the
 * metadata-only create among the operations not rebuilt until something asks, and nothing in this app
 * asks. Attaching bytes remains its own route, `upload.ts`, which is the one api does publish.
 */
import { findDocuments } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDocuments(req.params.id, callerFromRequest(req)));
};
