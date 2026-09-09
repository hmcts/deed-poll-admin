/**
 * Case notes, read and written through `deed-poll-api`.
 *
 * The scoping this file used to enforce by hand — `assertCaseExists` before every list, `{ id,
 * deedPollId }` in every `where`, belt and braces so an unscoped write was not expressible — is api's
 * now. Its note routes are all nested under `/caseworker/cases/{id}/notes`, so a note id belonging to
 * another case answers 404 there rather than being reachable through the wrong parent's URL. That is
 * the same guarantee, made at the only place that can still make it; re-checking here would mean
 * asking api for the case as well, which is a second round trip to learn something the note call
 * already told us.
 *
 * **Authorship is no longer a parameter.** `NoteAuthor` and the `SERVICE_ACCOUNT_NAME` fallback are
 * gone: api stamps `createdBy` and `modifiedBy` from the caller's own token, so passing a name
 * alongside it would let this app attribute a note to whoever it liked. See `../api/deed-poll-api.ts`
 * for why the `Caller` carries only the token.
 *
 * **There is no `removeNote` yet.** api has the endpoint — it is its thirteenth caseworker operation,
 * added for this app — and the adapter already wires it, but porting it is task 6 of
 * `docs/plans/02-dal-cutover-to-api.md` along with the note form's delete branch, so the two arrive
 * together rather than leaving a service function nothing calls.
 */
import { createNote as apiCreateNote, getNote, listNotes, type Note, patchNote } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import type { CreateNoteInput, UpdateNoteInput } from "./schemas.js";

/**
 * Notes for a case, as api orders them — newest first, the order the subgrid renders.
 *
 * A missing case is still a 404 rather than an empty list, which was worth a comment when this file
 * had to arrange it: filtering by `deedPollId` alone answered `[]` with 200 both for a mistyped case
 * id and for a real case with no notes, and only one of those is true. api's nested route answers 404
 * for the first, so the distinction now costs nothing to keep.
 */
export function findNotes(deedPollId: string, caller: Caller): Promise<Note[]> {
  return callApi(caller, (config) => listNotes(deedPollId, config));
}

export function findNote(deedPollId: string, id: string, caller: Caller): Promise<Note> {
  return callApi(caller, (config) => getNote(deedPollId, id, config));
}

export function createNote(deedPollId: string, dto: CreateNoteInput, caller: Caller): Promise<Note> {
  return callApi(caller, (config) => apiCreateNote(deedPollId, dto.note, config));
}

/**
 * Amend a note.
 *
 * `dto.note` may be absent — `updateNoteSchema` is a partial — and that is passed through rather than
 * defaulted, because api accepts an empty patch and re-stamps `modifiedBy` for it. An edit can only
 * ever move `modifiedBy`: `UpdateNoteInput` cannot carry `createdBy`, and api would not honour it.
 */
export function updateNote(deedPollId: string, id: string, dto: UpdateNoteInput, caller: Caller): Promise<Note> {
  return callApi(caller, (config) => patchNote(deedPollId, id, dto.note, config));
}
