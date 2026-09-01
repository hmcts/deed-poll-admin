/**
 * Notes collection for a case, ported from `notes.controller.ts` (`@Get()` / `@Post()`).
 *
 * Nested under `[id]/` rather than the `[deedPollId]/` the handover's route table proposed. The
 * prototype needed the distinct name because `@Controller('api/deed-polls/:deedPollId/notes')`
 * declares the parent segment in its own path string; here the parent segment is the directory,
 * which already exists as `[id]/` for `validate.ts`. Two sibling parameter directories naming the
 * same URL position would both work — `discoverRoutes` keys on the URL path, so there is no
 * conflict — but it would read as an accident.
 *
 * `createNote` takes only `{ userName }`, not the `{ isAdmin, userName }` the case writes take:
 * there is no privileged field on a note, so admin status is not part of the decision. Passing it
 * would imply a rule that does not exist.
 */
import { createNote, createNoteSchema, findNotes } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { userFromRequest } from "../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findNotes(req.params.id));
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  const { name } = userFromRequest(req);
  const created = await createNote(req.params.id, parsed.data, { userName: name });

  res.status(201).json(created);
};
