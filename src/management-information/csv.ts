/**
 * CSV for the management information downloads (plan `docs/plans/20261103-mi-dashboard-page.md`, decision A8):
 * RFC 4180 quoting, CRLF line ends and a byte order mark, because Excel reads UTF-8 without one as its own code page.
 *
 * A text cell starting with `=`, `+`, `-`, `@`, a tab or a CR is one a spreadsheet would run as a formula, so it gets
 * a `'` in front (OWASP, "CSV Injection"). Numbers are api's figures and are written as they are; null is an empty
 * cell, never zero.
 */

const BOM = "\uFEFF";
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function toCsv(rows: CsvCell[][]): string {
  return `${BOM}${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

function cell(value: CsvCell): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export type CsvCell = string | number | null;
