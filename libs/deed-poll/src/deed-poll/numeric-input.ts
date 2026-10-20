/**
 * Plain decimal notation, optionally signed, nothing else: `7`, `-3`, `+0`, `25.50`, `.5`, `5.`.
 *
 * Deliberately narrower than `Number()`, which also reads `1e3`, `0x10`, `0b1`, `0o7`, `Infinity` and an
 * all-whitespace string. Nobody typing an age or a refund means any of those, and each is a value the
 * caseworker did not see on the form. Signs stay because `UpdateCaseRequest` sets no minimum on any numeric
 * field; a range is api's rule, not this parser's. Currency symbols and thousands separators are refused
 * rather than stripped, so no character the caseworker typed is discarded. Surrounding whitespace is trimmed,
 * as for every other field on the form. A decimal with more significant digits than a double holds is rounded
 * by `Number()`; api publishes no precision, so that is not refused here.
 */
const DECIMAL_SYNTAX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A fraction with any non-zero digit. Checked on the text, not the number, because `Number()` rounds
 * `7.00000000000000001` to a whole 7, which `Number.isInteger` would then accept.
 */
const NON_ZERO_FRACTION = /\.\d*[1-9]/;

/** `UpdateCaseRequest` publishes every integer case field as `format: int32`. */
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

/**
 * Read one submitted numeric control into one of four outcomes.
 *
 * The distinction is the point (review finding E04): `Number()` folded a typo into `NaN` and an overflow into
 * `Infinity`, both of which reached the patch as `null` — an instruction to clear the field. Here only `blank`
 * can mean "clear", and `invalid` is something the caseworker must be told about before anything is written.
 *
 * A value that is not a single string — a duplicated field arriving as an array, a bracketed name parsed into
 * an object — is `invalid`, not its first element: the form renders one control per field, so anything else
 * was not submitted by it.
 */
export function readNumericInput(raw: unknown, format: NumberFormat): NumericInput {
  if (raw === undefined) return { kind: "absent" };
  if (typeof raw !== "string") return { kind: "invalid" };
  const text = raw.trim();
  if (text === "") return { kind: "blank" };
  if (!DECIMAL_SYNTAX.test(text)) return { kind: "invalid" };
  const value = Number(text);
  if (!Number.isFinite(value)) return { kind: "invalid" };
  if (format === "integer" && (NON_ZERO_FRACTION.test(text) || !isInt32(value))) return { kind: "invalid" };
  return { kind: "valid", value };
}

/**
 * A stored number as the plain decimal `readNumericInput` accepts. `String()` switches to exponent notation
 * below 1e-6 and from 1e21, which the form would then refuse on an unchanged save.
 */
export function formatNumericInput(value: number): string {
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 100 });
}

/** The field error for an `invalid` reading, worded by the field's format. */
export function numericInputMessage(label: string, format: NumberFormat): string {
  return format === "integer" ? `${label} must be a whole number` : `${label} must be a number`;
}

function isInt32(value: number): boolean {
  return value >= INT32_MIN && value <= INT32_MAX;
}

/** `integer` for api's `int32` fields, `decimal` for its plain `number` ones. */
export type NumberFormat = "integer" | "decimal";

export type NumericInput = { kind: "absent" } | { kind: "blank" } | { kind: "valid"; value: number } | { kind: "invalid" };
