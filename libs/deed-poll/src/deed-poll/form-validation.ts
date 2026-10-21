import type { FieldDef } from "./form-fields.js";
import { fieldInputMessage, readDateInput, readFieldInput } from "./form-input.js";

/** One error, addressed to a field so the form can render it in place. */
export interface FormError {
  /** Field name, or the anchor the error is shown against. */
  field: string;
  message: string;
}

/**
 * Validation for a tab save, run BEFORE the patch reaches the service.
 *
 * Split from `buildUpdatePatch()` on purpose: that function's job is to shape a
 * payload, and for a date it signals "no usable value" as `null`, which is also
 * how it signals a deliberate clear. Those two cases must be told apart here — a
 * blank date clears the field, whereas `99/99/abcd` is a mistake the caseworker
 * needs told about. Until 2026-08-10 both were silently stored as null, so a typo
 * in a year read back as "the date was never entered". Numbers no longer reach
 * that ambiguity: `buildUpdatePatch` throws on an invalid one (review finding E04).
 */

/**
 * Every per-field input error on a tab save, dates, numbers and input the form could not have sent together, in
 * the order the fields render.
 *
 * One list so a caseworker who mistyped both a date and an amount is told about both at once, and in page
 * order because the GOV.UK error summary is read top to bottom against the form. The non-date errors are
 * `readFieldInput`'s, the rule `buildUpdatePatch` also refuses by (review finding R08).
 */
export function collectFormErrors(body: Record<string, unknown>, fields: FieldDef[]): FormError[] {
  const position = new Map(fields.map((field, index) => [field.name, index]));
  const inputErrors = fields.filter((field) => field.kind !== "date" && !field.readOnly).flatMap((field) => invalidInput(field, body));
  return [...collectDateErrors(body, fields), ...inputErrors].sort((a, b) => (position.get(a.field) ?? 0) - (position.get(b.field) ?? 0));
}

/**
 * Errors for date fields whose parts are PARTIALLY or badly filled.
 *
 * Three outcomes per date field: all three parts blank (a clear — no error),
 * all three parts a real date (fine), anything else (an error). The middle
 * case is what `composeDate()` cannot distinguish from the first.
 *
 * Rejects out-of-range parts rather than letting `Date.UTC` roll them over:
 * `32/13/2026` is a typo, and silently storing 2027-02-01 is worse than
 * refusing it. Two-digit years are refused for the same reason — `Date.UTC(26,…)`
 * means 1926, which nobody typing "26" intends.
 */
export function collectDateErrors(body: Record<string, unknown>, fields: FieldDef[]): FormError[] {
  return fields.filter((field) => field.kind === "date" && !field.readOnly).flatMap((field) => invalidDateInput(field, body));
}

function invalidInput(field: FieldDef, body: Record<string, unknown>): FormError[] {
  return readFieldInput(field, body).kind === "invalid" ? [{ field: field.name, message: fieldInputMessage(field) }] : [];
}

function invalidDateInput(field: FieldDef, body: Record<string, unknown>): FormError[] {
  const input = readDateInput(field.name, body);
  if (input.kind === "absent") return [];
  // A repeated or bracketed part is not a date the caseworker typed (review finding R08), and reading it as
  // blank would clear the field.
  if (input.kind === "invalid") return [{ field: field.name, message: fieldInputMessage(field) }];
  const { day, month, year } = input;

  // All blank: the caseworker is clearing the field, which is legitimate.
  if (!day && !month && !year) return [];

  const missing = [!day && "day", !month && "month", !year && "year"].filter(Boolean) as string[];
  if (missing.length > 0) {
    return [{ field: field.name, message: `${field.label} must include a ${missing.join(" and ")}` }];
  }
  if (!isRealDate(day, month, year)) {
    return [{ field: field.name, message: `${field.label} must be a real date` }];
  }
  return [];
}

/**
 * True when the three parts name a date that actually exists.
 *
 * Checks the composed date agrees with its parts, which catches rollover
 * (31 February becoming 3 March) as well as out-of-range months. The year is
 * required to be four digits so a two-digit entry is a correction rather than
 * a silent trip to the 1900s.
 */
function isRealDate(day: string, month: string, year: string): boolean {
  if (!/^\d{1,2}$/.test(day)) return false;
  if (!/^\d{1,2}$/.test(month)) return false;
  if (!/^\d{4}$/.test(year)) return false;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const composed = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(composed.getTime())) return false;
  return composed.getUTCFullYear() === y && composed.getUTCMonth() === m - 1 && composed.getUTCDate() === d;
}
