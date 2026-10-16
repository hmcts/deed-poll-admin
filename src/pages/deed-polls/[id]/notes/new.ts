/**
 * Add-a-note form, ported from the prototype's `@Get(':id/notes/new')` / `@Post(...)`.
 *
 * Static, so it resolves before `[noteId]/edit.ts` — `sortRoutes` orders by parameter count and this
 * has one fewer.
 *
 * The form has a single control. The source shows three, two of them read-only: Deed Poll (the case
 * reference) and NoteID (blank until saved). Neither is an input here — the case is in the URL and
 * appears as the caption, and the code is derived from the row's own id, so there is nothing to show
 * before the row exists.
 *
 * **Validation re-renders rather than redirecting with `?error=`, which is what the prototype did.**
 * A redirect loses the textarea's contents, and `validateNoteText` rejects a note over 2000
 * characters — so the failure most likely to be hit is the one where the caseworker has typed the
 * most. Re-rendering keeps it on screen to be trimmed. Same reasoning as the edit form; the
 * prototype's own comment justified the redirect on the grounds that this form "carries one field",
 * which is true but is an argument about how much there is to lose, not about whether losing it is
 * acceptable.
 */
import { createNote, createNoteSchema, findDeedPoll, InvalidInputError, MAX_NOTE_LENGTH, zodErrorToFieldErrors } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { forLog } from "../../../../for-log.js";

const en = {
  title: "Add a note",
  heading: "Add a note",
  noteLabel: "Note",
  noteHint: "What you record here is visible to anyone working on this case.",
  submit: "Add note",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  noteRefused: "The note could not be saved. Check the note and try again.",
  maxLength: MAX_NOTE_LENGTH
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const found = await findDeedPoll(req.params.id, callerFromRequest(req));

  res.render("deed-polls/note-form", { case: found, value: "", error: null, en, cy });
};

export const POST = async (req: Request, res: Response) => {
  // The schema, not `validateNoteText` directly: it trims first and the trimmed value is what gets
  // stored, so going through it keeps this form and the API accepting exactly the same input.
  const parsed = createNoteSchema.safeParse({ note: (req.body as { note?: unknown }).note });

  if (!parsed.success) {
    const [first] = zodErrorToFieldErrors(parsed.error);

    return rerender(req, res, first?.message ?? null);
  }

  try {
    // The caller's token and nothing else: api stamps the note's author from it, so the session's name
    // is not sent alongside — it would be this app asserting an identity api never verified.
    await createNote(req.params.id, parsed.data, callerFromRequest(req));
  } catch (error) {
    // api applies its own note rules and this form does not mirror all of them, so a rejection it has
    // no local equivalent for still has to reach the textarea rather than the 500 page —
    // `domainErrorHandler` deliberately passes `InvalidInputError` on, on the grounds that a page which
    // validates has caught it, and a caseworker losing what they typed to a rule they cannot see is the
    // failure this catch exists for.
    if (error instanceof InvalidInputError) {
      // A rejection that names no field is api's alone — every local rejection attributes itself — and its
      // message is written for whoever reads api's logs, not for a caseworker: a gateway in front of api
      // answering 400 with an HTML body leaves `failureFromResponse` with nothing but
      // `deed-poll-api answered 400`. So api's wording is logged and this page's own copy is shown, the
      // same split as the edit tab and the new-case form.
      if (error.errors.length === 0) {
        console.error(`note create refused with no field named: ${forLog(error.message)}`);
        return rerender(req, res, en.noteRefused);
      }
      return rerender(req, res, error.errors[0].message);
    }
    throw error;
  }

  res.redirect(`/deed-polls/${req.params.id}#notes`);
};

async function rerender(req: Request, res: Response, error: string | null) {
  const found = await findDeedPoll(req.params.id, callerFromRequest(req));

  res.status(400).render("deed-polls/note-form", {
    case: found,
    value: (req.body as { note?: string }).note ?? "",
    error,
    en,
    cy
  });
}
