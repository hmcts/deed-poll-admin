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
 * The api client's spec and adapter, which replaced Phase 3's route-file count.
 *
 * **Phase 3's model died with `apps/api`.** It counted `export const GET` in
 * `apps/api/src/routes/**` against a hardcoded 29-operation scope taken from the prototype's Nest
 * controllers — so once plan 02 deleted that app, the dashboard reported 0/29 and read as a total
 * regression rather than as a layer that had moved. What replaced it is the pair below: the caseworker
 * operations `deed-poll-api` publishes, and the adapter functions this repo exports for them. Both are
 * counted, neither is hardcoded, and `libs/deed-poll-api-client/src/api/contract.test.ts` is what proves
 * they correspond operation for operation — a dashboard cannot, and should not try.
 */
const SPEC_PATH = join(ROOT, "libs/deed-poll-api-client/openapi.json");
const ADAPTER_PATH = join(ROOT, "libs/deed-poll-api-client/src/api/client.ts");

const ADAPTER_EXPORT = /^export (?:async )?function (\w+)/gm;
const METHOD_EXPORT = /^export const (GET|POST|PUT|PATCH|DELETE)\b/gm;
/** Phase 4 still compares against the prototype's page controller, which plan 02 did not touch. */
const NEST_ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete)\(/g;

/**
 * A Playwright test declaration. Deliberately not `test.` anything — `test.describe`, `test.skip`,
 * `test.use` and `test.beforeEach` are all configuration rather than tests, and counting them would
 * inflate the figure. `auth.setup.ts` renames the import to `setup`, so it is excluded by matching
 * `*.spec.ts` only, which is also right: signing in is arrangement, not a journey.
 */
const PLAYWRIGHT_TEST = /^\s*test\(/gm;

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
    api: collectApi(),
    phase4: collectPhase4(),
    tests: withTests ? runTests() : null,
    git: collectGit()
  };
}

/**
 * The api surface: what the spec publishes for caseworkers, grouped the way the adapter is, and how
 * many adapter functions exist.
 *
 * Grouped by the first path segment after `/caseworker` so the table survives api adding an operation:
 * a new `/caseworker/cases/{id}/x` shows up under a new group rather than needing a line here.
 */
function collectApi() {
  if (!existsSync(SPEC_PATH) || !existsSync(ADAPTER_PATH)) return null;

  const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  const groups = new Map();

  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith("/caseworker/")) continue;

    const group = groupFor(path);
    const methods = Object.keys(operations).filter((key) => HTTP_METHODS.has(key));
    groups.set(group, (groups.get(group) ?? 0) + methods.length);
  }

  const adapter = readFileSync(ADAPTER_PATH, "utf8");

  return {
    groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
    adapterFunctions: (adapter.match(ADAPTER_EXPORT) ?? []).length
  };
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** `/caseworker/cases/{id}/notes/{noteId}` → `cases/notes`; `/caseworker/document-types` → `document-types`. */
function groupFor(path) {
  const segments = path.split("/").filter((segment) => segment && segment !== "caseworker" && !segment.startsWith("{"));

  return segments.slice(0, 2).join("/");
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

/**
 * Phase 4: the prototype's scope, and what `apps/web` has ported against it.
 *
 * `ported` can legitimately exceed `scope`. `apps/web` has one handler the prototype did not need —
 * a document download route — because the prototype served its API and its pages from one Nest app
 * and could link at `/api/...`, whereas these are separate origins.
 */
function collectPhase4() {
  return {
    scope: countNestHandlers("deed-poll/deed-poll-pages.controller.ts"),
    templates: countTemplates(join(ROOT, "power_app_nest/src/views")),
    ported: countPageHandlers(join(ROOT, "apps/web/src/pages/deed-polls")),
    e2e: countPlaywrightTests()
  };
}

/**
 * End-to-end tests, counted from source rather than by running Playwright.
 *
 * Counted statically on purpose: a run needs the IDAM simulator, the api mock and the web app up, and a
 * dashboard refresh must not depend on that. So this reports how many journeys are *written*, which is
 * the number that answers "is Phase 4 covered", while whether they pass is what `yarn test:e2e` is for.
 */
function countPlaywrightTests() {
  const dir = join(ROOT, "e2e-tests/tests");
  if (!existsSync(dir)) return null;

  const specs = readdirSync(dir).filter((name) => name.endsWith(".spec.ts"));
  const count = (name) => (readFileSync(join(dir, name), "utf8").match(PLAYWRIGHT_TEST) ?? []).length;

  return {
    total: specs.reduce((sum, name) => sum + count(name), 0),
    deedPolls: specs.includes("deed-polls.spec.ts") ? count("deed-polls.spec.ts") : 0
  };
}

function countPageHandlers(dir) {
  return routeFiles(dir).reduce((total, file) => total + (readFileSync(file, "utf8").match(METHOD_EXPORT) ?? []).length, 0);
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
 * Real test counts, by running the suite. Opt-in because it is slow — but no longer environment
 * dependent: every suite runs against the api mock in process, so the count is the same on a machine
 * with Docker up and in CI. It used to differ by the 11 `ccd` tests `apps/postgres` skipped without a
 * database.
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

function renderDashboard({ api, phase4, tests, git }) {
  const lines = [
    START_MARKER,
    "",
    "_Generated by `yarn progress:write`. Do not hand-edit inside the markers — the next run overwrites it._",
    "",
    ...renderApi(api),
    "### Phase 4 — SSR pages",
    "",
    ...renderPhase4(phase4),
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

/**
 * Phase 4's line. `ported` is counted from `apps/web`, which survives the prototype's deletion; the
 * prototype's own scope is reported only while it is still there to count.
 */
function renderPhase4(phase4) {
  const ported = `**${phase4.ported} page handlers** ported in \`apps/web/src/pages/deed-polls/\``;
  const lines = [];

  if (phase4.scope === null) {
    lines.push(`- ${ported}. \`power_app_nest/\` is gone, so the original scope can no longer be counted from source.`);
  } else {
    // Ported legitimately exceeds scope by the download route the split apps need — see collectPhase4.
    const against = `against **${phase4.scope}** in the prototype's \`deed-poll-pages.controller.ts\` and **${phase4.templates}** Nunjucks templates`;
    lines.push(`- ${ported}, ${against}.`);
  }

  if (phase4.e2e) {
    lines.push(
      `- **${phase4.e2e.total} end-to-end tests** written in \`e2e-tests/tests/\`, **${phase4.e2e.deedPolls}** of them deed-poll journeys. Accessibility and validation are checked inside the journeys, so they add no test count of their own.`
    );
  }

  return lines;
}

/**
 * The api surface. No progress bar and no percentage, deliberately: there is no denominator to be a
 * fraction of — api publishes what it publishes, and an operation this app does not need is not a gap.
 * The nine writes api has no endpoint for (witness writes, document patch and delete, document-type
 * writes) are recorded as out of scope in `DEED_POLL_API_PLAN.md`, not as work outstanding.
 */
function renderApi(api) {
  if (!api) {
    return ["### deed-poll-api", "", "- **Could not count.** `libs/deed-poll-api-client/openapi.json` or `src/api/client.ts` is missing.", ""];
  }

  const total = api.groups.reduce((sum, [, count]) => sum + count, 0);

  return [
    "### deed-poll-api — the surface this app consumes",
    "",
    "```",
    `${"caseworker path".padEnd(24)}operations`,
    `${"─".repeat(36)}`,
    ...api.groups.map(([group, count]) => `${group.padEnd(24)}${count}`),
    `${"─".repeat(36)}`,
    `${"published in the spec".padEnd(24)}${total}`,
    `${"adapter functions".padEnd(24)}${api.adapterFunctions}`,
    "```",
    "",
    "- The adapter's extra function is `checkApiReachable`, which the readiness probe uses against api's unauthenticated `/health/liveness` — not a caseworker operation. The path is the liveness group and not the ungrouped `/health` on purpose: see the docblock at the function.",
    "- `src/api/contract.test.ts` is what proves the two lines correspond; this table only counts them.",
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
    ...(skipped > 0 ? [`- **${skipped} skipped.** Nothing in this repo skips on a missing dependency any more — the \`apps/postgres\` \`ccd\` tests that needed \`docker compose up -d\` went with the data access layer — so a skip here is a \`.skip\` someone left in.`, ""] : [])
  ];
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
