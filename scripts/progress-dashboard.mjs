#!/usr/bin/env node

/**
 * Regenerates the "At a glance" dashboard in `.business_context/PROGRESS.md`.
 *
 * This exists because that file has drifted repeatedly — stale test counts, a stale commit list,
 * and route paths (`/api/deed-polls`) that were never correct. Every one of those was a number a
 * command could have answered. So the countable parts are counted here rather than typed, and the
 * editorial parts — why a phase is blocked, which decisions are open — stay hand-written outside
 * the generated block, because no script can derive those.
 *
 *   yarn progress          print it, change nothing (instant, skips the suite)
 *   yarn progress:write    splice it into PROGRESS.md, measuring the suite for real (~40s)
 *
 * Or directly, which is what those wrap and what works when Yarn itself is unavailable here:
 *
 *   node scripts/progress-dashboard.mjs [--write] [--tests] [--skip-tests]
 *
 * `--write` measures the suite unless `--skip-tests` says otherwise, so the written document never
 * silently loses its test counts.
 *
 * Printing is the default deliberately: a generator that writes on sight is one typo away from
 * mangling the handover document, so the safe mode is the one you get by accident.
 *
 * `.mjs` rather than `.js` because the root `package.json` does not set `"type": "module"` — only
 * the workspaces do. Setting it at the root would also change how `vitest.config.ts` is loaded,
 * which is not a change worth making for a dev script.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROGRESS_PATH = join(ROOT, ".business_context/PROGRESS.md");

const START_MARKER = "<!-- BEGIN GENERATED DASHBOARD -->";
const END_MARKER = "<!-- END GENERATED DASHBOARD -->";

/**
 * Phase 3's scope. Hardcoded rather than derived so the dashboard still works after
 * `power_app_nest/` is deleted at the end of Phase 4 — but cross-checked against the prototype
 * while it is still there, so a wrong number here is reported rather than trusted.
 */
const PHASE_3_RESOURCES = [
  { name: "deed-polls", total: 7, controller: "deed-poll/deed-poll.controller.ts", note: "incl. field-rules, validate" },
  { name: "notes", total: 5, controller: "notes/notes.controller.ts", note: "" },
  { name: "witnesses", total: 5, controller: "witnesses/witnesses.controller.ts", note: "" },
  { name: "document-types", total: 5, controller: "documents/document-types.controller.ts", note: "global reference data" },
  { name: "documents", total: 7, controller: "documents/documents.controller.ts", note: "incl. multipart upload, download" }
];

const METHOD_EXPORT = /^export const (GET|POST|PUT|PATCH|DELETE)\b/gm;
const NEST_ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete)\(/g;

function main() {
  const write = process.argv.includes("--write");

  // `--write` measures unless told not to. Otherwise a run without `--tests` silently replaces a
  // real test table with "not measured" — a generator that can quietly degrade the document it
  // maintains is worse than no generator. Printing stays cheap by default.
  const withTests = process.argv.includes("--tests") || (write && !process.argv.includes("--skip-tests"));

  const snapshot = collect(withTests);
  const dashboard = renderDashboard(snapshot);

  // Warned rather than written into the document: at `--write` time the tree is dirty by definition,
  // since the document is about to change. A line that always says "dirty" trains people to skip it.
  if (snapshot.git.dirty) {
    process.stderr.write("Note: the working tree is dirty, so this snapshot may include uncommitted work.\n");
  }

  if (!write) {
    process.stdout.write(`${dashboard}\n`);
    return;
  }

  spliceIntoProgress(dashboard);
  process.stdout.write(`Updated ${PROGRESS_PATH}\n`);
}

function collect(withTests) {
  return {
    phase3: collectPhase3(),
    phase4: collectPhase4(),
    tests: withTests ? runTests() : null,
    git: collectGit()
  };
}

/** Ported handlers, counted from the route files that actually exist. */
function collectPhase3() {
  const ported = countPortedByResource();

  return PHASE_3_RESOURCES.map((resource) => ({
    ...resource,
    done: ported.get(resource.name) ?? 0,
    // Only meaningful while the prototype is still in the tree.
    declared: countNestHandlers(resource.controller)
  }));
}

function countPortedByResource() {
  const counts = new Map();

  for (const file of routeFiles(join(ROOT, "apps/api/src/routes"))) {
    const methods = (readFileSync(file, "utf8").match(METHOD_EXPORT) ?? []).length;
    if (methods === 0) continue;

    const resource = resourceFor(file);
    if (resource) {
      counts.set(resource, (counts.get(resource) ?? 0) + methods);
    }
  }

  return counts;
}

/**
 * Which resource a route file belongs to. Nested children are checked before the parent, since
 * every nested path also contains `/deed-polls/`.
 */
function resourceFor(file) {
  if (file.includes("/notes/")) return "notes";
  if (file.includes("/witnesses/")) return "witnesses";
  if (file.includes("/documents/")) return "documents";
  if (file.includes("/document-types")) return "document-types";
  if (file.includes("/deed-polls")) return "deed-polls";
  return null; // template-provided routes (users, onboarding) are not Phase 3 scope
}

function routeFiles(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) return [];
    return [full];
  });
}

function countNestHandlers(relativePath) {
  const full = join(ROOT, "power_app_nest/src", relativePath);
  if (!existsSync(full)) return null;
  return (readFileSync(full, "utf8").match(NEST_ROUTE_DECORATOR) ?? []).length;
}

/** Phase 4's scope: the SSR page handlers and the templates behind them. */
function collectPhase4() {
  return {
    handlers: countNestHandlers("deed-poll/deed-poll-pages.controller.ts"),
    templates: countTemplates(join(ROOT, "power_app_nest/src/views"))
  };
}

function countTemplates(dir) {
  if (!existsSync(dir)) return null;

  return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return total + countTemplates(full);
    return total + (entry.name.endsWith(".njk") ? 1 : 0);
  }, 0);
}

/**
 * Real test counts, by running the suite. Opt-in because it is slow, and because `apps/postgres`
 * skips its 11 `ccd` tests unless Postgres is up — so the number legitimately differs between a
 * machine with `docker compose up -d` and CI.
 *
 * Runs `vitest` directly rather than going through `yarn test` or `turbo test`. Both of those invoke
 * `yarn` per workspace, and in this devcontainer Corepack cannot reach `repo.yarnpkg.com`, so the run
 * dies before a single test executes — a tool for keeping the handover honest should not be defeated
 * by a problem the handover itself documents. Every workspace's `test` script is exactly `vitest run`,
 * so this is equivalent while taking the package manager out of the path.
 */
function runTests() {
  const counts = new Map();
  const unmeasured = [];

  for (const workspace of testableWorkspaces()) {
    const result = runVitest(workspace.dir);
    if (result) {
      counts.set(workspace.name, result);
    } else {
      unmeasured.push(workspace.name);
    }
  }

  return { counts, unmeasured };
}

/** Workspaces declaring a vitest `test` script, discovered rather than listed. */
function testableWorkspaces() {
  const found = [];

  for (const parent of ["apps", "libs"]) {
    const dir = join(ROOT, parent);
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const manifestPath = join(dir, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (!manifest.scripts?.test?.includes("vitest")) continue;

      found.push({ name: manifest.name, dir: join(dir, entry.name) });
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function runVitest(cwd) {
  let output = "";

  try {
    output = execFileSync(join(ROOT, "node_modules/.bin/vitest"), ["run"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    // A failing suite still prints its summary line, so read it: the counts are real, and
    // renderTests flags the failures rather than presenting them as a clean run.
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }

  const clean = stripAnsi(output);

  // A workspace with a `test` script but no test files is not a measurement failure — vitest runs
  // clean under `passWithNoTests` and simply prints no summary. Reporting it as unmeasured would
  // send someone looking for a broken runner.
  if (/No test files found/.test(clean)) return { passed: 0, skipped: 0, failed: 0, empty: true };

  const summary = clean.match(/Tests\s+(.+)/);
  if (!summary) return null;

  const count = (label) => {
    const match = summary[1].match(new RegExp(`(\\d+) ${label}`));
    return match ? Number(match[1]) : 0;
  };

  return { passed: count("passed"), skipped: count("skipped"), failed: count("failed"), empty: false };
}

function stripAnsi(text) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
  return text.replace(/\[[0-9;]*m/g, "");
}

function collectGit() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

  return {
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    head: git("log", "-1", "--format=%h  %s"),
    commitsAhead: git("rev-list", "--count", "master..HEAD"),
    dirty: git("status", "--porcelain").length > 0
  };
}

function renderDashboard({ phase3, phase4, tests, git }) {
  const done = phase3.reduce((sum, r) => sum + r.done, 0);
  const total = phase3.reduce((sum, r) => sum + r.total, 0);

  const lines = [
    START_MARKER,
    "",
    "_Generated by `yarn progress:write`. Do not hand-edit inside the markers — the next run overwrites it._",
    "",
    "### Phase 3 — JSON API handlers",
    "",
    "```",
    `${"resource".padEnd(18)}${"progress".padEnd(10)}${"ported".padEnd(7)}${"".padEnd(6)}notes`,
    `${"─".repeat(72)}`,
    ...phase3.map(renderResource),
    `${" ".repeat(28)}${"─".repeat(14)}`,
    `${" ".repeat(28)}${`${done}/${total}`.padEnd(7)}${percent(done, total)}`,
    "```",
    "",
    ...renderMismatches(phase3),
    "### Phase 4 — SSR pages, not started",
    "",
    phase4.handlers === null
      ? "- `power_app_nest/` is gone, so the scope can no longer be counted from source."
      : `- **${phase4.handlers} page handlers** in \`deed-poll-pages.controller.ts\`, **${phase4.templates} Nunjucks templates** under \`src/views/\`.`,
    "",
    ...renderTests(tests),
    "### Branch",
    "",
    "```",
    git.branch,
    `${git.commitsAhead} commits ahead of master`,
    `HEAD  ${git.head}`,
    "```",
    "",
    END_MARKER
  ];

  return lines.join("\n");
}

function renderResource(resource) {
  const bar = `${"█".repeat(resource.done)}${"░".repeat(Math.max(0, resource.total - resource.done))}`;
  const tally = `${resource.done}/${resource.total}`;
  const mark = resource.done === resource.total ? "done" : resource.done === 0 ? "" : "part";

  return `${resource.name.padEnd(18)}${bar.padEnd(10)}${tally.padEnd(7)}${mark.padEnd(6)}${resource.note}`.trimEnd();
}

/**
 * The hardcoded totals are the thing most likely to go quietly wrong, so they are checked against
 * the prototype for as long as it is in the tree, and a mismatch is surfaced rather than silently
 * preferred either way.
 */
function renderMismatches(phase3) {
  const wrong = phase3.filter((r) => r.declared !== null && r.declared !== r.total);
  if (wrong.length === 0) return [];

  return [
    "> **Scope mismatch.** These totals disagree with the prototype's controllers, so one of the two",
    "> is wrong and this dashboard cannot be trusted until it is resolved:",
    ...wrong.map((r) => `> - \`${r.name}\`: this script says ${r.total}, \`${r.controller}\` has ${r.declared}`),
    ""
  ];
}

function renderTests(tests) {
  if (!tests) {
    return ["### Tests", "", "- Not measured. Re-run with `--tests` to count them.", ""];
  }

  const rows = [...tests.counts.entries()].filter(([, t]) => !t.empty);
  const sum = (key) => rows.reduce((total, [, t]) => total + t[key], 0);
  const [passed, skipped, failed] = [sum("passed"), sum("skipped"), sum("failed")];

  // "0 passed" in a handover document reads as a catastrophic regression, so if nothing reported at
  // all, say the measurement failed instead of publishing a zero.
  if (rows.length === 0) {
    return ["### Tests", "", "- **Could not measure.** No workspace reported a summary — check that `node_modules/.bin/vitest` runs.", ""];
  }

  const tally = (t) => `${String(t.passed).padStart(5)} passed${t.skipped ? `  ${t.skipped} skipped` : ""}${t.failed ? `  ${t.failed} FAILED` : ""}`;

  return [
    "### Tests",
    "",
    ...(failed > 0 ? [`> **${failed} test(s) failing.** These counts are real but the suite is not green.`, ""] : []),
    ...(tests.unmeasured.length > 0 ? [`> Not measured: ${tests.unmeasured.join(", ")}.`, ""] : []),
    "```",
    ...rows.map(([pkg, t]) => `${pkg.padEnd(38)}${tally(t)}`),
    `${"─".repeat(53)}`,
    `${"total".padEnd(38)}${tally({ passed, skipped, failed })}`,
    "```",
    "",
    ...(skipped > 0 ? ["- Skips are `apps/postgres`' `ccd` tests: they need `docker compose up -d`, and CI has no database.", ""] : [])
  ];
}

function percent(done, total) {
  return total === 0 ? "" : `${Math.round((done / total) * 100)}%`;
}

function spliceIntoProgress(dashboard) {
  const content = readFileSync(PROGRESS_PATH, "utf8");
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);

  // Refuse rather than guess. Appending to the end, or writing a second block, would leave two
  // dashboards disagreeing with each other — worse than the drift this is meant to fix.
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find the dashboard markers in ${PROGRESS_PATH}. Expected ${START_MARKER} ... ${END_MARKER}.`);
  }

  writeFileSync(PROGRESS_PATH, content.slice(0, start) + dashboard + content.slice(end + END_MARKER.length));
}

if (!existsSync(PROGRESS_PATH)) {
  throw new Error(`${PROGRESS_PATH} does not exist.`);
}

if (statSync(PROGRESS_PATH).isDirectory()) {
  throw new Error(`${PROGRESS_PATH} is a directory.`);
}

main();
