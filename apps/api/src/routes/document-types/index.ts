/**
 * Document-type collection, ported from `document-types.controller.ts` (`@Get()`).
 *
 * **Not nested under a case.** Document types are global reference data — the list of things a
 * supporting document can be, with the marital statuses and case types each applies to — so they
 * sit at the top level while the documents that reference them live under
 * `/deed-polls/:id/documents`. That is why this is the one Phase 3 resource outside
 * `routes/deed-polls/`.
 *
 * **`GET` only, and there is no `[id].ts` any more.** `deed-poll-api` publishes
 * `GET /caseworker/document-types` and nothing else: no single-type read, and no writes at all. The
 * `POST` here, and the whole of `[id].ts` with its `PATCH` and its 409-answering `DELETE`, went with
 * those functions in task 4 of `docs/plans/02-dal-cutover-to-api.md`. The authorisation question the
 * old comment left open — whether editing reference data should be admin-only, since a wrong edit
 * changes what every case's document form offers — is api's to answer when it rebuilds the writes.
 */
import { findDocumentTypes } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDocumentTypes(callerFromRequest(req)));
};
