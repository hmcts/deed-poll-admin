import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const SAFE_FILTERS = /\|\s*(casePath|referralPath|pathSegment)\s*$/;

function templates(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return templates(full);
    return entry.name.endsWith(".njk") ? [full] : [];
  });
}

/** Every `{{ … }}` in an href's path (before any `#`) that names an id, with no path filter applied. */
function rawIdsInHrefs(source: string): string[] {
  const found: string[] = [];
  for (const href of source.matchAll(/href="([^"]*)"/g)) {
    const pathPart = href[1].split("#")[0];
    for (const expression of pathPart.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
      const value = expression[1];
      if (/(\.id|Id)\b/.test(value) && !SAFE_FILTERS.test(value)) found.push(`{{ ${value} }}`);
    }
  }
  return found;
}

describe("template hrefs", () => {
  // admin#193 put every redirect through casePath/referralPath; the templates followed in this change. A raw
  // `{{ case.id }}`, or `urlencode`, lets a `.`/`..` id name the case list or the site root.
  it("puts every id in an href path through casePath, referralPath or pathSegment", () => {
    const offenders = templates(SRC).flatMap((file) => rawIdsInHrefs(readFileSync(file, "utf8")).map((raw) => `${path.relative(SRC, file)}: ${raw}`));

    expect(offenders).toEqual([]);
  });

  it("detects a raw or urlencoded id, and allows a fragment", () => {
    expect(rawIdsInHrefs('<a href="/deed-polls/{{ case.id }}#notes">')).toEqual(["{{ case.id }}"]);
    expect(rawIdsInHrefs('<a href="/judicial/referrals/{{ row.id | urlencode }}">')).toEqual(["{{ row.id | urlencode }}"]);
    expect(rawIdsInHrefs('<a href="{{ case.id | casePath }}#{{ tab.id }}">')).toEqual([]);
  });
});
