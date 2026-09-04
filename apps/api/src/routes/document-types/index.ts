/**
 * Document-type collection, ported from `document-types.controller.ts` (`@Get()` / `@Post()`).
 *
 * **Not nested under a case.** Document types are global reference data — the list of things a
 * supporting document can be, with the marital statuses and case types each applies to — so they
 * sit at the top level while the documents that reference them live under
 * `/deed-polls/:id/documents`. That is why this is the one Phase 3 resource outside
 * `routes/deed-polls/`.
 *
 * Reference data is normally seeded and edited rarely, so these are effectively admin operations.
 * They are left unguarded to match the prototype, which carried no `@Roles(...)` anywhere — but the
 * case for guarding this is stronger than for case data, because a wrong edit here changes what
 * every case's document form offers. Noted with the other authorisation questions in
 * `.business_context/PROGRESS.md`, not decided here.
 */
import { createDocumentType, createDocumentTypeSchema, findDocumentTypes } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

export const GET = async (_req: Request, res: Response) => {
  res.json(await findDocumentTypes());
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createDocumentTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.status(201).json(await createDocumentType(parsed.data));
};
