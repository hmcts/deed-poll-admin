/**
 * Amend-a-note form, ported from the prototype's `@Get(':id/notes/:noteId/edit')` / `@Post(...)`.
 *
 * `findNote` is scoped to the parent — the operation is nested under the case in `deed-poll-api` too —
 * so a note id belonging to another case 404s rather than rendering someone else's note under this
 * case's reference.
 *
 * **Delete is a second submit button on the same form**, not its own route: two forms would mean two
 * routes free to drift. The handler branches on `action`, and **delete is checked first** so a blank or
 * over-long textarea cannot block a deletion — the text is irrelevant to a row about to disappear.
 * Only the literal `"delete"` takes that path, so a missing `action` falls through to save and is never
 * destructive; both halves of that rule are pinned by tests, because a control that deletes when the
 * caseworker asked to save and one that saves when they asked to delete are the same defect.
 *
 * There is no confirmation step. The note is one field of text, recreating it costs a sentence, and an
 * interstitial on every deletion is friction paid on the safe path. The button is styled as a warning
 * so it cannot be mistaken for the primary action.
 *
 * **Only an Administrator is offered the delete button** — `canDeleteNote`, whose docblock holds the
 * reasoning. Amending stays open to both roles, because the business splits edit from delete, so the
 * flag gates that one button and not the form. It is read in `GET` **and** in `rerender`: a flag set
 * only on the first render reappears as a button the moment a validation error re-renders the form,
 * which is the path a caseworker reaches by submitting an over-long note.
 *
 * The `action === "delete"` branch below is deliberately ungated. api enforces the rule and refuses a
 * forged POST; a local refusal as well would put the authority in two places.
 */
import {
  buildNoteDetail,
  canDeleteNote,
  createNoteSchema,
  findDeedPoll,
  findNote,
  InvalidInputError,
  MAX_NOTE_LENGTH,
  removeNote,
  updateNote,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
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
  noteRefused: "The note could not be saved. Check the note and try again.",
  maxLength: MAX_NOTE_LENGTH
};

// English content in the cy shape — see the note in ../../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const caller = callerFromRequest(req);
  const [found, note] = await Promise.all([findDeedPoll(req.params.id, caller), findNote(req.params.id, req.params.noteId, caller)]);

  res.render("deed-polls/note-edit", {
    case: found,
    note: buildNoteDetail(note),
    value: note.note,
    error: null,
    canDelete: canDeleteNote(userFromRequest(req)),
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  const body = req.body as { note?: unknown; action?: unknown };
  const caller = callerFromRequest(req);

  // First, so a note whose text would fail validation can still be deleted.
  if (body.action === "delete") {
    await removeNote(req.params.id, req.params.noteId, caller);
    return res.redirect(`/deed-polls/${req.params.id}#notes`);
  }

  const parsed = createNoteSchema.safeParse({ note: body.note });

  if (!parsed.success) {
    const [first] = zodErrorToFieldErrors(parsed.error);

    return rerender(req, res, first?.message ?? null);
  }

  try {
    // The caller's token and nothing else: api re-stamps `modifiedBy` from it, so the session's name is
    // not sent alongside.
    await updateNote(req.params.id, req.params.noteId, parsed.data, caller);
  } catch (error) {
    // api applies its own note rules and this form does not mirror all of them, so a rejection it has no
    // local equivalent for still belongs against the textarea — see the same catch on `../new.ts`.
    if (error instanceof InvalidInputError) {
      // A rejection naming no field carries api's own wording rather than anything a caseworker can act
      // on, so it is logged and this page's copy is shown — see the same split on `../new.ts`.
      if (error.errors.length === 0) {
        console.error(`note save refused with no field named: ${error.message}`);
        return rerender(req, res, en.noteRefused);
      }
      return rerender(req, res, error.errors[0].message);
    }
    throw error;
  }

  res.redirect(`/deed-polls/${req.params.id}#notes`);
};

async function rerender(req: Request, res: Response, error: string | null) {
  const caller = callerFromRequest(req);
  const [found, note] = await Promise.all([findDeedPoll(req.params.id, caller), findNote(req.params.id, req.params.noteId, caller)]);
  const body = req.body as { note?: unknown };

  res.status(400).render("deed-polls/note-edit", {
    case: found,
    note: buildNoteDetail(note),
    // The submitted text, not the stored note: the point of re-rendering is that what was typed is still
    // there to be corrected.
    value: typeof body.note === "string" ? body.note : "",
    error,
    // Re-read here, not carried from `GET`: a re-render is its own request, and omitting it would put the
    // button back on the failed-validation path.
    canDelete: canDeleteNote(userFromRequest(req)),
    en,
    cy
  });
}
