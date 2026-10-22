import { composeDateParts } from "./date-parts.js";
import { enumOptions, type FieldDef, TEXTAREA_MAX_LENGTH } from "./form-fields.js";
import { numericInputMessage, readNumericInput } from "./numeric-input.js";

const DATE_PARTS = ["day", "month", "year"] as const;

/**
 * Read one submitted field into what a patch should do with it, shared by `collectFormErrors` and
 * `buildUpdatePatch` so what is refused and what is written cannot drift (review finding R08).
 *
 * The rule is the same for every kind: a value the rendered form could not have sent is `invalid`, never coerced.
 * A text or textarea sends one string; a select one string that is exactly `""` or one of its option values; each date part one string; a checkbox `"true"` when ticked (or a
 * browser's default `"on"`) and nothing when not; Yes / No radios `"true"` or `"false"` or nothing; a multiselect
 * zero or more strings, each exactly one of its option values and none twice. An array or object where one string belongs is a
 * repeated or bracketed name, which used to become a clear or its first element, and `Number()` read `"1e0"`,
 * `"0x2"` and `" 3 "` as options and dropped `"abc"` silently. Numbers keep their own parser, `readNumericInput`.
 *
 * `absent` is what R02 made it: not rendered, so left out of the patch. A checkbox and a multiselect are never
 * absent, because nothing ticked is how they say false and none.
 */
export function readFieldInput(field: FieldDef, body: Record<string, unknown>): FieldInput {
  const raw = body[field.name];
  switch (field.kind) {
    case "number": {
      const input = readNumericInput(raw, field.numberFormat ?? "decimal");
      if (input.kind === "absent" || input.kind === "invalid") return input;
      return { kind: "valid", value: input.kind === "valid" ? input.value : null };
    }
    case "date": {
      const input = readDateInput(field.name, body);
      if (input.kind !== "parts") return input;
      return { kind: "valid", value: composeDateParts(input.day, input.month, input.year) };
    }
    case "boolean":
      return field.nullable ? readYesNo(raw) : readCheckbox(raw);
    case "multiselect":
      return readMultiselect(raw, field);
    case "enum":
      return readSelect(raw, field);
    default: {
      if (raw === undefined) return { kind: "absent" };
      if (typeof raw !== "string") return { kind: "invalid" };
      const text = raw.trim();
      if (field.kind === "textarea" && text.length > TEXTAREA_MAX_LENGTH) return { kind: "invalid", reason: "too-long" };
      return { kind: "valid", value: text === "" ? null : text };
    }
  }
}

/**
 * A date's three parts, trimmed, with a missing part read as blank. `absent` only when all three are missing, and
 * `invalid` when any part is not one string. `collectDateErrors` decides what blank and partial parts mean.
 */
export function readDateInput(name: string, body: Record<string, unknown>): DateInput {
  const raw = DATE_PARTS.map((part) => body[`${name}-${part}`]);
  if (raw.every((part) => part === undefined)) return { kind: "absent" };
  if (raw.some((part) => part !== undefined && typeof part !== "string")) return { kind: "invalid" };
  const [day, month, year] = raw.map((part) => (typeof part === "string" ? part.trim() : ""));
  return { kind: "parts", day, month, year };
}

/** The field error for an `invalid` reading, worded for the caseworker rather than naming the input's shape. */
export function fieldInputMessage(field: FieldDef, input?: FieldInput): string {
  if (input?.kind === "invalid" && input.reason === "too-long") {
    return `${field.label} must be ${TEXTAREA_MAX_LENGTH.toLocaleString("en-GB")} characters or less`;
  }
  switch (field.kind) {
    case "number":
      return numericInputMessage(field.label, field.numberFormat ?? "decimal");
    case "boolean":
      return `Select a valid answer for ${field.label}`;
    case "multiselect":
      return `Select only options from the list for ${field.label}`;
    case "enum":
      return `Select an option from the list for ${field.label}`;
    default:
      return `Enter a single value for ${field.label}`;
  }
}

function readYesNo(raw: unknown): FieldInput {
  if (raw === undefined) return { kind: "absent" };
  if (raw === "true") return { kind: "valid", value: true };
  if (raw === "false") return { kind: "valid", value: false };
  return { kind: "invalid" };
}

function readCheckbox(raw: unknown): FieldInput {
  if (raw === undefined) return { kind: "valid", value: false };
  if (raw === "true" || raw === "on") return { kind: "valid", value: true };
  return { kind: "invalid" };
}

function readSelect(raw: unknown, field: FieldDef): FieldInput {
  if (raw === undefined) return { kind: "absent" };
  if (typeof raw !== "string") return { kind: "invalid" };
  // A rendered select sends `""` or an option value exactly, so it is not trimmed. An out-of-set value would reach
  // api, and after its refusal the select could not redraw it.
  if (raw === "") return { kind: "valid", value: null };
  return optionValues(field).has(raw) ? { kind: "valid", value: raw } : { kind: "invalid" };
}

function readMultiselect(raw: unknown, field: FieldDef): FieldInput {
  if (raw === undefined) return { kind: "valid", value: [] };
  const members = Array.isArray(raw) ? raw : [raw];
  const allowed = optionValues(field);
  if (!members.every((member) => typeof member === "string" && allowed.has(member))) return { kind: "invalid" };
  // A rendered checkbox group sends each value at most once.
  if (new Set(members).size !== members.length) return { kind: "invalid" };
  return { kind: "valid", value: members.map(Number) };
}

function optionValues(field: FieldDef): Set<string> {
  return new Set(field.enumSet ? enumOptions(field.enumSet).map((option) => option.value) : []);
}

/** `too-long` is a textarea over `TEXTAREA_MAX_LENGTH`: one string the caseworker typed, so it is redrawn as sent. */
export type FieldInput = { kind: "absent" } | { kind: "valid"; value: unknown } | { kind: "invalid"; reason?: "too-long" };

export type DateInput = { kind: "absent" } | { kind: "parts"; day: string; month: string; year: string } | { kind: "invalid" };
