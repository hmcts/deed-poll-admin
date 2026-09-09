/**
 * A single note, ported from `notes.controller.ts` (`@Get(':id')` / `@Patch(':id')`).
 *
 * Every domain call takes both ids. That is the whole of the scoping rule: the note operations are
 * nested under the case in `deed-poll-api` too, so a note id belonging to another case answers 404
 * rather than being read or mutated through the wrong parent. Passing only `noteId` would compile and
 * would quietly make every note reachable from any case's URL.
 *
 * **There is no `DELETE` yet.** api has the endpoint — its thirteenth caseworker operation, added for
 * this app — but wiring it through is task 6 of `docs/plans/02-dal-cutover-to-api.md`, along with the
 * SSR note form's delete branch, so the two arrive together. The admin-only guard the old `DELETE`
 * carried is a decision to re-take then rather than to preserve here: api authorises the call from the
 * caller's own token now, so a second role check in this app would be a rule with two owners.
 */
import { findNote, updateNote, updateNoteSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findNote(req.params.id, req.params.noteId, callerFromRequest(req)));
};

export const PATCH = async (req: Request, res: Response) => {
  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.json(await updateNote(req.params.id, req.params.noteId, parsed.data, callerFromRequest(req)));
};
