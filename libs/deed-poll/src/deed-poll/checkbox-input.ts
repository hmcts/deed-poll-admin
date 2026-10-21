/**
 * How a checkbox value reads, shared by `buildUpdatePatch` and the edit view so a redrawn box and a saved one
 * cannot disagree (review finding R01). A stored record holds `true` and numbers, a submitted body
 * `"true"`/`"on"` and strings.
 */
export function isTicked(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "on";
}

/**
 * A nullable boolean's Yes / No answer (review finding R07), shared the same way: stored `true`/`false` or a
 * submitted radio's `"true"`/`"false"`, and `null` for no answer.
 */
export function yesNoAnswer(raw: unknown): boolean | null {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return null;
}

/**
 * A multiselect's ticked option values: one value or many, stored or submitted. Lenient on purpose, because it reads
 * stored numbers too: a submitted value reaches it only once `readFieldInput` has accepted it (review finding R08).
 */
export function tickedValues(raw: unknown): number[] {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((value) => Number(String(value))).filter((n) => Number.isInteger(n));
}
