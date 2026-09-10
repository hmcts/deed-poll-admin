#!/usr/bin/env node
/**
 * Merge every workspace's `coverage/lcov.info` into one at the repository root, with source paths rewritten
 * to be root-relative.
 *
 * `sonar-project.properties` points at a root `lcov.info`. That file used to be produced by a
 * `lcov-result-merger` step in `.github/workflows/job.test.yml`, which this repository deleted when CI moved
 * to the Jenkins CNP pipeline — so without this, Sonar finds no report at all and every build reports 0%
 * coverage on new code, which is the condition the quality gate fails on. See docs/PIPELINES.md.
 *
 * The rewrite is the whole reason this is not a plain `cat` of the per-package files. Vitest writes `SF:` paths relative
 * to each package (`SF:src/app.ts`), and Sonar resolves them from the project root — so concatenating as-is
 * would produce a report naming files that do not exist, and two packages' `src/index.ts` would collide on
 * one entry. Each record is prefixed with the package directory instead.
 *
 * The application's own report needs no prefix, because since plan 03 task 3 the application *is* the root
 * package: its `SF:src/app.ts` is already root-relative.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_DIRS = ["libs"];
const OUTPUT = path.join(ROOT, "lcov.info");

function main() {
  const reports = [...findRootReport(), ...WORKSPACE_DIRS.flatMap(findReports)];

  // Removed before anything else, because Jenkins reuses a workspace: a run that merges nothing would
  // otherwise leave the previous build's report in place, and Sonar would attribute the earlier commit's
  // coverage to this one and pass the gate on it. Reporting 0% is wrong and visible; reporting a stale
  // number is wrong and invisible.
  rmSync(OUTPUT, { force: true });

  if (reports.length === 0) {
    // Not a failure: `yarn test` without `--coverage` legitimately produces none, and failing here would
    // fail the pipeline's test stage over a missing side effect rather than a failing test.
    console.warn("merge-lcov: no coverage/lcov.info found at the root or under libs/ — nothing to merge.");
    return;
  }

  const merged = reports.map(({ packageDir, file }) => prefixSourcePaths(readFileSync(file, "utf8"), packageDir));
  writeFileSync(OUTPUT, merged.join(""));
  console.log(`merge-lcov: wrote ${path.relative(ROOT, OUTPUT)} from ${reports.length} report(s).`);
}

function findRootReport() {
  const file = path.join(ROOT, "coverage", "lcov.info");
  return existsAndNotEmpty(file) ? [{ packageDir: ".", file }] : [];
}

function findReports(workspaceDir) {
  const parent = path.join(ROOT, workspaceDir);
  let entries;

  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ packageDir: `${workspaceDir}/${entry.name}`, file: path.join(parent, entry.name, "coverage", "lcov.info") }))
    .filter(({ file }) => existsAndNotEmpty(file));
}

function existsAndNotEmpty(file) {
  try {
    return readFileSync(file, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Absolute `SF:` paths are left alone — Sonar resolves those itself, and rewriting them would be guesswork
 * about which prefix to strip.
 */
function prefixSourcePaths(report, packageDir) {
  const prefixed = report.replace(/^SF:(.+)$/gm, (line, sourcePath) => (path.isAbsolute(sourcePath) ? line : `SF:${path.posix.join(packageDir, sourcePath)}`));
  return prefixed.endsWith("\n") ? prefixed : `${prefixed}\n`;
}

main();
