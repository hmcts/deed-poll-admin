/**
 * The save-a-query form: the three things a caseworker types or ticks.
 *
 * Everything else a saved query holds — the status filter, the conditions, the order — arrives off the
 * URL the form was opened with rather than out of a control, so there is nothing to validate about it
 * that `../deed-poll/case-query.ts` has not already decided. `savedQueryStored` in `view.ts` is what
 * turns that half into a payload.
 *
 * **The bounds are api's, and this is the second of two guards rather than the only one.**
 * `CreateSavedQueryRequest` publishes `name` as 1-100 characters and `description` as ≤500, and the
 * adapter's own schema refuses a body beyond them regardless. What this schema buys is a message beside
 * the input instead of a 400 the page has to translate — the reason `schema-primitives.ts` rejects a
 * `null` api would also reject. Plan 11's rule is that the UI's limits must not *exceed* the spec's, so
 * these two numbers may only ever be lowered.
 *
 * **The messages are here rather than in the page**, following `../notes/note-form.ts` rather than
 * `../witnesses/schemas.ts`: a blank name and an over-long name are two different things to say about
 * one field, and a page that maps a single message per field cannot say both.
 */
import { z } from "zod";

/** api's `CreateSavedQueryRequest.name` maxLength. Its minLength is 1, which is the `.min(1)` below. */
export const MAX_SAVED_QUERY_NAME = 100;

/** api's `CreateSavedQueryRequest.description` maxLength. */
export const MAX_SAVED_QUERY_DESCRIPTION = 500;

/**
 * One schema for both forms, unlike every other pair in this package.
 *
 * Saving and amending offer the same three controls and both post all three every time, so there is no
 * partial to make: a `.partial()` would accept a body missing a field the form always sends, which is why
 * the witness amend page validates against its *create* schema too.
 *
 * `name` is trimmed before it is measured, so "   " is a blank rather than a three-character name, and the
 * trimmed value is what gets stored — `../notes/schemas.ts` holds the same reasoning.
 */
export const savedQueryFormSchema = z.object({
  name: z
    .string({ error: "Enter a name for this query" })
    .trim()
    .min(1, "Enter a name for this query")
    .max(MAX_SAVED_QUERY_NAME, `Name must be ${MAX_SAVED_QUERY_NAME} characters or fewer`),
  // Blank becomes `undefined` rather than `""`: on a create api's schema takes no null, and an empty
  // description is the absence of one rather than a description that says nothing.
  description: z
    .string({ error: `Description must be ${MAX_SAVED_QUERY_DESCRIPTION} characters or fewer` })
    .trim()
    .max(MAX_SAVED_QUERY_DESCRIPTION, `Description must be ${MAX_SAVED_QUERY_DESCRIPTION} characters or fewer`)
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
  // A checkbox, so absence is the answer "no": an unchecked box posts nothing at all, and only the literal
  // the control carries is a yes. Nothing is rejected here — there is no third answer for a caseworker to
  // give, and a hand-crafted `shared=maybe` means the same as not ticking it.
  // `.optional()` because zod 4 refuses an absent key even for `unknown`, and an absent key is exactly
  // what an unticked checkbox sends.
  shared: z
    .unknown()
    .optional()
    .transform((value) => value === "true")
});

/** What a validated save-a-query form holds. The query itself is not in it — see the docblock. */
export type SavedQueryFormInput = z.output<typeof savedQueryFormSchema>;
