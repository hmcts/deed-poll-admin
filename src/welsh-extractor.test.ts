import { spawnSync } from "node:child_process";
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
