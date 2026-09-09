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
 * `createNote` used to take `{ userName }` — the caller's name, so the row could be attributed. It
 * takes the caller's bearer token now and nothing else: `deed-poll-api` stamps both audit names from
 * the token it authenticated, so a name sent alongside would be this app asserting an author api never
 * verified. Same change as the case routes; see `../../[id].ts`.
 */
import { createNote, createNoteSchema, findNotes } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findNotes(req.params.id, callerFromRequest(req)));
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  const created = await createNote(req.params.id, parsed.data, callerFromRequest(req));

  res.status(201).json(created);
};
