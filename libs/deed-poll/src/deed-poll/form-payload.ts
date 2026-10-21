import { InvalidInputError } from "../errors.js";
import { EDITABLE_FIELDS, type FieldDef } from "./form-fields.js";
import { fieldInputMessage, readFieldInput } from "./form-input.js";

/**
 * Turn a flat SSR form POST body into an update patch, driven by the field
 * metadata so the accepted payload can't drift from the rendered form. Read-only
 * (computed/state/referencenumber) fields are never in the list, so are ignored.
 * Date fields arrive as GOV.UK date-input parts (`<name>-day/-month/-year`) and
 * are composed into full UTC ISO strings, which is what goes on the wire — nothing
 * converts them afterwards. api would take a bare `YYYY-MM-DD` too (its
 * `DeedPollSchemas.isoDateString` accepts a bare date, an offset date-time and a
 * zoneless local date-time alike), so the explicit `T00:00:00.000Z` is here to make
 * the midnight-UTC instant this app means the one it states, rather than leaving api's
 * `coerceDates` to supply it.
 *
 * Each field in `fields` that the body carries is written (empty inputs → null),
 * matching the Dynamics form where saving persists the whole form, clearing blanked
 * fields — so state derivation stays correct (clearing dateEnroled un-enrols). Pass
 * ONLY the fields on the submitted tab so a per-tab save never nulls fields on other tabs.
 *
 * An absent text, textarea, enum or date field is omitted rather than cleared (review
 * finding R02): a rendered one is always submitted, even empty, so absent means it was
 * not rendered — hidden by its type's rules, or disabled. Checkboxes are the exception,
 * because an unticked one is absent too, so an absent boolean is `false` and an absent
 * multiselect `[]`; `deed-poll-validation.test.ts` fails if a rule ever hides one. A
 * `nullable` boolean is not a checkbox but Yes / No radios (review finding R07), so it
 * follows the text rule: nothing selected is absent and omitted, leaving an unanswered
 * question unanswered. The
 * minor-only fields and the Gazette notice date a type hides are cleared by api's own
 * write-path gates, not here.
 *
 * A `notNullable` field submitted empty is omitted too: its column is NOT NULL, and
 * nulling one is a 500.
 *
 * Number fields follow `readNumericInput` instead (review finding E04): absent is omitted, blank clears, and
 * text that is not a number throws `InvalidInputError` naming each such field, so no patch exists to send.
 * A typo used to become `null` — an instruction to clear the stored value. Every other kind refuses the same way
 * a value the rendered form could not have sent (review finding R08); `readFieldInput` is the rule for each.
 */
export function buildUpdatePatch(body: Record<string, unknown>, fields: FieldDef[] = EDITABLE_FIELDS): Record<string, unknown> {
  const readings = fields.filter((field) => !field.readOnly).map((field) => ({ field, input: readFieldInput(field, body) }));
  const errors = readings.filter(({ input }) => input.kind === "invalid").map(({ field }) => ({ field: field.name, message: fieldInputMessage(field) }));
  if (errors.length > 0) {
    throw new InvalidInputError("Form input could not have been sent by the form", errors);
  }
  const patch: Record<string, unknown> = {};
  for (const { field, input } of readings) {
    if (input.kind !== "valid" || (input.value === null && field.notNullable)) continue;
    patch[field.name] = input.value;
  }
  return patch;
}
