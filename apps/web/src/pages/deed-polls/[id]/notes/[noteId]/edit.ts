/**
 * Amend-a-note form, ported from the prototype's `@Get(':id/notes/:noteId/edit')` / `@Post(...)`.
 *
 * `findNote` is scoped to the parent, so a note id belonging to another case 404s rather than
 * rendering someone else's note under this case's reference.
 *
 * **Delete is a second submit button on the same form**, not its own route: two forms would mean two
 * routes free to drift. The handler branches on `action`, and **delete is checked first** so a blank
 * or over-long textarea cannot block a deletion — the text is irrelevant to a row about to disappear.
 *
 * There is no confirmation step. The note is one field of text, recreating it costs a sentence, and
 * an interstitial on every deletion is friction paid on the safe path. The button is styled as a
 * warning so it cannot be mistaken for the primary action.
 */
import { buildNoteDetail, createNoteSchema, findDeedPoll, findNote, MAX_NOTE_LENGTH, removeNote, updateNote, zodErrorToFieldErrors } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../../../../../auth/current-user.js";

const en = {
  titlePrefix: "Amend note",
  noteLabel: "Note",
  noteHint: "What you record here is visible to anyone working on this case.",
  createdLabel: "Created",
  modifiedLabel: "Modified",
  notEdited: "Not edited",
  save: "Save note",
  delete: "Delete note",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  maxLength: MAX_NOTE_LENGTH
};

// English content in the cy shape — see the note in ../../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const [found, note] = await Promise.all([findDeedPoll(req.params.id, callerFromRequest(req)), findNote(req.params.id, req.params.noteId)]);

  res.render("deed-polls/note-edit", { case: found, note: buildNoteDetail(note), value: note.note, error: null, en, cy });
};

export const POST = async (req: Request, res: Response) => {
  const body = req.body as { note?: unknown; action?: unknown };

  // First, so a note whose text would fail validation can still be deleted.
  if (body.action === "delete") {
    await removeNote(req.params.id, req.params.noteId);
    return res.redirect(`/deed-polls/${req.params.id}#notes`);
  }

  const parsed = createNoteSchema.safeParse({ note: body.note });

  if (!parsed.success) {
    const [found, note] = await Promise.all([findDeedPoll(req.params.id, callerFromRequest(req)), findNote(req.params.id, req.params.noteId)]);
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

  const { name } = userFromRequest(req);
  await updateNote(req.params.id, req.params.noteId, parsed.data, { userName: name });

  res.redirect(`/deed-polls/${req.params.id}#notes`);
};
