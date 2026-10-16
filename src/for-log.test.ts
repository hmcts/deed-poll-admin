import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { forLog } from "./for-log.js";

const SRC = path.dirname(fileURLToPath(import.meta.url));

describe("forLog", () => {
  it("should remove CR and LF so an api message cannot forge a second log line", () => {
    const result = forLog("name too long\r\n2026-10-16 INFO login succeeded subject=admin");

    expect(result).toBe("name too long2026-10-16 INFO login succeeded subject=admin");
  });

  it("should remove ANSI escape sequences whole, not just their ESC byte", () => {
    const result = forLog("\u001b[2K\u001b[1Gcleared \u001b[31mred\u001b[0m");

    expect(result).toBe("cleared red");
  });

  it("should remove the remaining C0 and C1 control characters and DEL", () => {
    const result = forLog("a\u0000b\u0007c\u0008d\u007fe\u0085f\u009bg h");

    expect(result).toBe("abcdefgh");
  });

  it("should leave ordinary text, including non-ASCII, untouched", () => {
    const result = forLog("Enw'r ymgeisydd — ‘quoted’ ✓");

    expect(result).toBe("Enw'r ymgeisydd — ‘quoted’ ✓");
  });

  it("should cap the text at 500 characters", () => {
    const result = forLog("x".repeat(10_000));

    expect(result).toHaveLength(500);
  });

  it("should not split a surrogate pair at the cap", () => {
    const result = forLog(`${"x".repeat(499)}😀😀`);

    expect(Array.from(result)).toHaveLength(500);
    expect(result.endsWith("😀")).toBe(true);
  });
});

describe("console calls that log an error message", () => {
  const sources = [...pageSources(), path.join(SRC, "errors.ts")];

  it("should find page sources to check", () => {
    // A guard against the sweep finding nothing and the test below passing vacuously.
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(sources.map((file) => [path.relative(SRC, file), file]))("should pass every .message through forLog in %s", (_name, file) => {
    const offenders = consoleCalls(readFileSync(file, "utf8")).filter((call) => withoutForLogArguments(call).includes(".message"));

    expect(offenders).toEqual([]);
  });

  it("should report a console call that interpolates .message without forLog", () => {
    const source = 'console.error("refused:", error.message);\nconsole.error("fine:", forLog(error.message));';

    const offenders = consoleCalls(source).filter((call) => withoutForLogArguments(call).includes(".message"));

    expect(offenders).toEqual(['console.error("refused:", error.message)']);
  });
});

function pageSources(): string[] {
  const root = path.join(SRC, "pages");

  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => path.join(root, entry));
}

/** Each `console.<method>(…)` call's full text, across lines, by matching its parentheses. */
function consoleCalls(source: string): string[] {
  return [...source.matchAll(/console\.\w+\(/g)].map((match) => source.slice(match.index, closingParen(source, match.index + match[0].length - 1) + 1));
}

function withoutForLogArguments(call: string): string {
  const start = call.indexOf("forLog(");
  if (start === -1) return call;

  const open = start + "forLog".length;
  return withoutForLogArguments(call.slice(0, start) + call.slice(closingParen(call, open) + 1));
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") depth++;
    if (text[index] === ")" && --depth === 0) return index;
  }
  return text.length - 1;
}
