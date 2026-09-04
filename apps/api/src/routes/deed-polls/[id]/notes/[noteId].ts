/**
 * A single note, ported from `notes.controller.ts` (`@Get(':id')` / `@Patch(':id')` /
 * `@Delete(':id')`).
 *
 * Every domain call takes both ids. That is the whole of the scoping rule: `findNote` matches on
 * `{ id, deedPollId }`, so a note id belonging to another case answers 404 rather than being read
 * or mutated through the wrong parent. Passing only `noteId` would compile and would quietly make
 * every note in the database reachable from any case's URL.
 */
import { DEEDPOLL_ADMIN, findNote, removeNote, updateNote, updateNoteSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { userFromRequest } from "../../../../auth/current-user.js";
import { requireRoles } from "../../../../auth/require-roles.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findNote(req.params.id, req.params.noteId));
};

export const PATCH = async (req: Request, res: Response) => {
  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  const { name } = userFromRequest(req);

  res.json(await updateNote(req.params.id, req.params.noteId, parsed.data, { userName: name }));
};

// Admin-only, same decision as the case delete — see routes/deed-polls/[id].ts. A note is part of a
// case history, so removing one is a records change rather than data entry.
const deleteHandler = async (req: Request, res: Response) => {
  await removeNote(req.params.id, req.params.noteId);

  res.status(204).send();
};

export const DELETE = [requireRoles(DEEDPOLL_ADMIN), deleteHandler];
