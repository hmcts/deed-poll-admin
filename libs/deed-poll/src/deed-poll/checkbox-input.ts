/**
 * How a checkbox value reads, shared by `buildUpdatePatch` and the edit view so a redrawn box and a saved one
 * cannot disagree (review finding R01). A stored record holds `true` and numbers, a submitted body
 * `"true"`/`"on"` and strings.
 */
export function isTicked(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "on";
}

/** A multiselect's ticked option values: one value or many, stored or submitted. */
export function tickedValues(raw: unknown): number[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values.map((value) => Number(String(value))).filter((n) => Number.isInteger(n));
}
