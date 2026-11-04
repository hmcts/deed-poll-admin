import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The Welsh extractor has no other test, and its `--check` exits 1 by design while strings await translation, so a
 * crash looked the same as a normal run to anything that only read the exit code. That is how TypeScript 7 (#90)
 * broke it on 2026-10-21 with nothing failing: the translation request silently stopped growing. This pins the one
 * thing that tells a working run from a broken one, its summary line.
 */
describe("the Welsh string extractor", () => {
  it("should parse every page and print its summary line, rather than crash", () => {
    const run = spawnSync(process.execPath, ["scripts/extract-welsh-strings.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });

    expect(run.stderr).not.toMatch(/TypeError|SyntaxError|Cannot find (package|module)/);
    expect(run.stdout).toMatch(/^\d+ strings, \d+ still identical in cy/m);
  });
});

/**
 * The viewer's words live outside `src/pages`, in the one content module both scopes' viewer renders, so they reach
 * the translation request only because the module's directory is on `INCLUDE`. Every key `en` holds must arrive,
 * the page-count sentences and the function-shaped "Document N of M" included.
 */
describe("the Welsh string extractor and the document viewer", () => {
  it("should collect every label, message and count sentence of the viewer's content", async () => {
    const { en } = await import("./document-viewer/content.js");
    const directory = mkdtempSync(path.join(tmpdir(), "welsh-extract-"));
    const out = path.join(directory, "request.csv");

    const run = spawnSync(process.execPath, ["scripts/extract-welsh-strings.mjs", `--out=${out}`], { cwd: ROOT, encoding: "utf8" });
    const collected = readFileSync(out, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("src/document-viewer/content.ts,"))
      .map((line) => line.split(",")[1]);
    rmSync(directory, { recursive: true, force: true });

    expect(run.status).toBe(0);
    expect(collected.sort()).toEqual(keysOf(en).sort());
    expect(collected).toEqual(expect.arrayContaining(["documentPosition", "pageTotal", "pageStatus", "messages.tooLarge", "tryAgain"]));
  });
});

function keysOf(content: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(content).flatMap(([key, value]) =>
    typeof value === "object" && value !== null ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`]
  );
}
