/**
 * Amend-a-note form, ported from the prototype's `@Get(':id/notes/:noteId/edit')` / `@Post(...)`.
 *
 * `findNote` is scoped to the parent — the operation is nested under the case in `deed-poll-api` too —
 * so a note id belonging to another case 404s rather than rendering someone else's note under this
 * case's reference.
 *
 * **The delete button is temporarily gone, and comes back in task 6.** It was a second submit on this
 * same form, and the handler branched on `action` with delete checked first. api has the endpoint —
 * its thirteenth caseworker operation, added for this app — but task 4 of
 * `docs/plans/02-dal-cutover-to-api.md` ports the reads and writes and task 6 the delete, so the
 * service function, this branch and the template's button return together rather than one of the three
 * arriving early and calling something that is not there. The behaviour to restore exactly: delete is
 * checked **before** validation, so a note whose text would fail validation can still be deleted, and
 * only the literal `"delete"` deletes — a missing `action` falls through to save and is never
 * destructive.
 */
import { buildNoteDetail, createNoteSchema, findDeedPoll, findNote, MAX_NOTE_LENGTH, updateNote, zodErrorToFieldErrors } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";

const en = {
  titlePrefix: "Amend note",
  noteLabel: "Note",
  noteHint: "What you record here is visible to anyone working on this case.",
  createdLabel: "Created",
  modifiedLabel: "Modified",
  notEdited: "Not edited",
  save: "Save note",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  maxLength: MAX_NOTE_LENGTH
};

// English content in the cy shape — see the note in ../../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const caller = callerFromRequest(req);
  const [found, note] = await Promise.all([findDeedPoll(req.params.id, caller), findNote(req.params.id, req.params.noteId, caller)]);

  res.render("deed-polls/note-edit", { case: found, note: buildNoteDetail(note), value: note.note, error: null, en, cy });
};

export const POST = async (req: Request, res: Response) => {
  const body = req.body as { note?: unknown };
  const caller = callerFromRequest(req);
  const parsed = createNoteSchema.safeParse({ note: body.note });

  if (!parsed.success) {
    const [found, note] = await Promise.all([findDeedPoll(req.params.id, caller), findNote(req.params.id, req.params.noteId, caller)]);
    const [first] = zodErrorToFieldErrors(parsed.error);

    return res.status(400).render("deed-polls/note-edit", {
      case: found,
      note: buildNoteDetail(note),
      // The submitted text, not the stored note: the point of re-rendering is that what was typed is
      // still there to be corrected.
      value: typeof body.note === "string" ? body.note : "",
      error: first?.message ?? null,
      en,
      cy
    });
  }

  // The caller's token and nothing else: api re-stamps `modifiedBy` from it, so the session's name is
  // not sent alongside.
  await updateNote(req.params.id, req.params.noteId, parsed.data, caller);

  res.redirect(`/deed-polls/${req.params.id}#notes`);
};
