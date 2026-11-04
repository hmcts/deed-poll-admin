# Plan: Management information, admin half (tables, charts, CSV)

> **Reviewed by Steve 2026-11-03; every decision is settled (Wren).** This is the admin half of `mi-dashboard-api.md`,
> and that plan holds the KPI definitions. This plan needs the api half **merged, deployed to AAT and
> its `openapi.json` available** before Task 1. Do not execute it until then, and until it has been
> copied to `deed-poll-admin/docs/plans/` on its own branch.

## Overview

One new page, **Management information**, for callers holding `VIEW_MANAGEMENT_INFORMATION` (Team
leaders and Delivery Managers, per api D3). It shows the api's four KPIs (volume, stage durations,
referral outcomes, time to completion by cohort) for a chosen period and granularity. Each KPI has:

- a **GOV.UK table**, which is the primary view and the accessible one;
- a **server-rendered SVG line chart** above the table, which adds no information the table lacks;
- a **CSV download** of exactly the rows in the table.

No client-side JavaScript is required for any of it. The page works with JS off.

**Not in scope:** SLA, escalation and re-submission (deferred in the api half); "compare periods";
alert thresholds; drill-down to case lists (the api returns aggregates only, by design).

## Context

Baseline: admin `origin/master` `e3d5045` (2026-11-04), recorded under Validation Commands. The api half is
merged (api #165, squashed) and deployed, and api master is now `e7ee862`. Read `CLAUDE.md` first, especially:

- **"No data access layer"**: the page calls the generated api client; no SQL, no figures computed
  beyond formatting and percentages.
- **"Personas and role gating"** and the `requireCapability` gate as used for the settings pages
  (`src/app.test.ts`, "should require MANAGE_PROCESS_CONFIG after authentication and before
  routing…"). The new page copies that pattern with `VIEW_MANAGEMENT_INFORMATION`.
- **The spec-refresh rule**: `contract.test.ts` is set-equal both ways, so the refresh carries the
  whole api as it is at refresh time. `libs/deed-poll-api-client/SPEC-PROVENANCE.md` records it.
- **The mock** (`libs/deed-poll-api-client/src/mock/server.ts`) must implement the four operations
  with the api's validation rules in the api's words.
- **Welsh**: a new page area must be added to `scripts/extract-welsh-strings.mjs`'s `INCLUDE`; the
  copy's `cy` mirrors `en` until translated, so it adds to `yarn welsh:check`'s identical count.
- **Redirect paths**: the filter form is a GET to the same page, so there is no redirect, but any
  link carrying `returnTo` follows those rules.
- Page layout to copy: `src/pages/deed-polls/settings/` (index route, `.njk`, `.njk.test.ts`).
- The accessibility review in `deed-poll-documentation` (2026-10-30, "Add Deed Poll Admin
  accessibility review"). The new page must not add any of the issues it lists.

## Decisions

Proposed by Wren; confirmed or amended by Steve on 2026-11-03 (see Open decisions):

| # | Decision |
|---|---|
| A1 | Route `/deed-polls/management-information`, files under `src/pages/deed-polls/management-information/`. Linked from wherever the settings page is linked, shown only to callers with the capability. |
| A2 | Filters in one GET form: period preset (**last 7, 30, 60 and 90 days, and last year**: Steve, 2026-11-03), custom `from`/`to`, granularity (week / month / quarter) and "include migrated cases" (default on). Each preset picks a default granularity: week for 7 to 90 days, month for the year. Default view: **last 30 days, weekly** (Steve, 2026-11-03). The page validates `from`/`to` itself and shows GOV.UK error summaries in the api's words; it also handles the api's 400 the same way. |
| A3 | Table first. Each chart is an inline `<svg role="img">` with a `<title>` and a one-sentence text summary, and the table that follows is its full equivalent. Colour is never the only distinction: every line carries a marker shape and a direct label. Colours come from the GOV.UK palette. |
| A4 | Charts are drawn in Nunjucks from numbers computed in TypeScript (a small `chart-geometry.ts`: scales, ticks, polyline points). No charting library, so nothing is added to the bundle or the CSP. |
| A5 | Percentiles are always shown (api D6), and **every percentile cell sits next to its case count**, in the table and the CSV, so a median from 2 cases is visibly a median from 2 cases. A bucket with no cases shows "No cases" in the table, a gap in the chart and an empty cell in the CSV, and never zero. |
| A6 | K4's table shows `stillOpen` next to every cohort's percentiles, with the sentence "Recent intake periods look faster because their slower cases are still open." |
| A7 | Every KPI's details component says what the figure does not count, in the api's description words: edited dates, no further-docs duration, no staff referral withdrawals, and the `excluded` counts. |
| A8 | CSV: one route per KPI, `…/management-information/<kpi>.csv`, with the same query string and the same gate. UTF-8 with a BOM (Excel), a header row, and ISO dates. Every text cell is guarded against formula injection: a leading `=`, `+`, `-`, `@`, tab or CR gets a `'` prefix. Filename `deed-poll-mi-<kpi>-<from>-<to>.csv`. |

## Development Approach

- Tests first in every task.
- `chart-geometry.ts` gets plain unit tests with hand-worked numbers: an empty series, a single point,
  all-null values, a gap in the middle, a max of zero.
- Template tests (`.njk.test.ts`) render each KPI from fixed api responses, including an empty
  bucket, a bucket of 1, an empty period range, an `excluded` block with non-zero counts, and an api 400 and 500.
- Run every build and test command in the **foreground**. Never move `dist` aside; use `--force`.
- **Local data:** `yarn mock:seed` for the mock (in memory, so re-run after a mock restart), or
  `yarn seed:cases --environment local --api-url http://127.0.0.1:4550` against a local Java api
  (`docs/SEED-DATA.md`). Never point the seeder at a deployed environment from this plan.
- **Environment access is pinned (Steve, 2026-11-03).** Local development (ralphex, every task below)
  runs against the api-client **mock** only, never a deployed api, database, Key Vault or cluster.
  Don't run `az` or `kubectl`, and don't sign in to AAT. Checks against deployed environments are
  the manual "After merge" steps, run by Wren with Steve.

## Validation Commands

As `docs/plans/completed/20261028-da1-settings-contract-mock-and-page.md`. Run the full set before
implementation and in the final task; after each other task, run format, lint, build and only the
touched packages' tests:

```bash
yarn biome format --write .
yarn lint
yarn build --force
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
```

Never quote bare `yarn test`. `yarn welsh:check` exits 1 by design and isn't a gate. Record each
package's test count. **Baseline (2026-11-04, admin `e3d5045`, local Redis on 6379 so the session suites ran):** format, lint and
`build --force` clean; tests **6,958 passed, 0 failed, 0 skipped**: `//:test:app` 3,346, `@hmcts/deed-poll` 1,739,
`@hmcts/deed-poll-api-client` 1,448, `cloud-native-platform` 156, `express-govuk-starter` 132,
`express-session-postgres` 85, `simple-router` 45, `express-session-redis` 7. If Redis is not up on 127.0.0.1:6379,
start it with `docker start deed-poll-redis` before running the tests; never drop `REDIS_URL` to make them pass.

## Implementation Steps

### Task 1: Spec refresh, adapter and mock

- [x] Refresh `openapi.json` from the merged api. **The spec is already generated; do not build the api.** Copy
      `/Users/steve.newman/Documents/GitHub/deed-poll-admin-workspace/cft-workspace/.context/deed-poll-admin/mi-spec/openapi-e7ee862.json`
      (SHA-256 `b4034cd9980268e6381b1dce4aa730b8dc04fde63660d7a3cf1a46aa37cac49d`) over
      `libs/deed-poll-api-client/openapi.json` byte for byte, keeping the file's existing formatting rules if the repo
      has any. It was generated 2026-11-04 from api master `e7ee862` (squash of api #166, on top of #165's `5840c99`)
      with `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true OPENAPI_OUTPUT_PATH=/tmp/mi-spec/openapi-e7ee862.json ./gradlew integration --tests '*OpenAPIPublisherTest' -I <workspace>/.context/scripts/no-checkstyle.gradle --no-daemon`
      in a clean detached api worktree at that commit. **Delta against the previous copy, measured by parsed comparison:**
      4 paths added (`/caseworker/management-information/{volume,stage-durations,referral-outcomes,completion}`), 20
      `Mi*` schemas added, and `CallerAccessResponse` changed (its `capabilities` enum gains
      `VIEW_MANAGEMENT_INFORMATION`); nothing removed, nothing else changed. Record all of this as a new top row in
      `SPEC-PROVENANCE.md`, in its existing table style, and make `contract.test.ts` pass.
- [x] Add `VIEW_MANAGEMENT_INFORMATION` to `libs/deed-poll/src/auth/capabilities.ts` **and** to the mock's table
      (`libs/deed-poll-api-client/src/mock/caller-access.ts`), whose test pins it to `CallerAccessResponse`'s enum
      (CLAUDE.md, "Personas and role gating"). Team leader and Delivery Manager hold it; the deprecated
      `caseworker-deedpoll-admin` does not (api `RoleCapabilities`).
- [x] Mock: the four operations with fixed, realistic data (including an empty bucket, a 1-case bucket and
      a negative-interval exclusion), plus the api's 400 rules, with `server.test.ts` cases.

### Task 2: Gate and route

- [x] Failing `app.test.ts` case: the page and every CSV route require `VIEW_MANAGEMENT_INFORMATION`
      after authentication and before routing; a caseworker gets the standard 403 page.
- [x] Route, filter parsing and validation (A2), with a link shown only to capability holders.

### Task 3: Tables and copy

- [x] The four tables, the A5 rendering, the A6 sentence and the A7 details, all in `src/locales`
      (en + cy mirror); the page area added to the Welsh extractor's `INCLUDE`.

### Task 4: Charts

- [ ] `chart-geometry.ts` and its tests; the SVG macro; the A3 accessibility rules; an axe check in
      the template tests.

### Task 5: CSV downloads

- [ ] The four routes (A8), with tests for the header row, the BOM, an empty-bucket cell, the count column, a
      formula-injection value, the filename and the gate.

### Task 6: e2e, documentation and final verification

- [ ] One Playwright spec: a Team leader persona opens the page, changes the period, sees the tables
      and downloads one CSV; a caseworker persona gets 403. Run it on a temporary private-port config,
      not the default one, which reuses whatever is listening on 3000/3200.
- [ ] Add a "Management information" section to `CLAUDE.md`: the gate, table-first, no charting
      library, the CSV guard.
- [ ] Full Validation Commands, forced; record counts against the baseline; `git status` clean apart
      from the task commits.
## After merge (manual, NOT ralphex)

- In AAT, signed in through IDAM as a Team leader and as a Delivery Manager: the page loads with
  real figures, one CSV downloads, and a caseworker gets 403. Compare one week's figures by hand
  against the api pre-flight results.

## Open decisions (for Steve)

| # | Question | Wren's proposal |
|---|---|---|
| OA1 | Default view? | **DECIDED (Steve, 2026-11-03): last 30 days, grouped weekly (A2).** |
| OA2 | Are charts wanted at all in the first release, or tables + CSV only? | **DECIDED (Steve, 2026-11-03): charts included (Task 4 stays).** |

## Execution notes

- 2026-11-04: plan copied from `.context/plans/mi-dashboard-admin.md` onto branch `feat/mi-dashboard-page` from
  admin master `e3d5045`; Task 1's spec pre-generated (above) so no task builds the api. Run with
  `ralphex -b origin/master docs/plans/20261103-mi-dashboard-page.md`.
- 2026-11-04, Task 1: spec copied (parsed equal to the artefact; 72 operations, 53 paths, 98 schemas). The `Mi*`
  nested records are pinned strict (see `STRICT_RESPONSE_PROPERTIES`); the mock's 400s restate api's `MiParameters`
  at `e7ee862`, since the document publishes none. Format, lint and `build --force` clean; tests
  `@hmcts/deed-poll-api-client` 1,538 (+90), `@hmcts/deed-poll` 1,739, `//:test:app` 3,346, all passing.
- 2026-11-04, Task 2: gate mounted on the `/deed-polls/management-information` prefix (page and CSVs alike), pinned in
  `app.test.ts`; `require-role.test.ts` pins who is refused. Filters are `parseMiFilters`
  (`libs/deed-poll/src/management-information/filters.ts`): `period` (`7-days` … `year`, `custom`), `from`/`to` as
  `yyyy-MM-dd` text inputs (so api's own sentences apply verbatim and the CSV routes can reuse the query string),
  `granularity` (api's `WEEK`/`MONTH`/`QUARTER`, unchecked unless chosen, otherwise weekly up to 90 days and monthly
  beyond) and `includeMigrated` as Yes/No radios, absent meaning Yes. "Last year" is the 365/366 days ending today in
  London. The four KPIs are read concurrently and degrade one by one; any api 400 is shown against the form. The page
  handler lives in `src/management-information/` (added to the Welsh extractor's `INCLUDE`). Format, lint and
  `build --force` clean; tests `//:test:app` 3,379 (+33), `@hmcts/deed-poll` 1,767 (+28), all passing.
- 2026-11-04, Task 3: the tables are word-free data in `libs/deed-poll/src/management-information/tables.ts` (columns as
  keys, cells as api's number or null), so Task 5's CSVs can draw exactly the same rows; `src/management-information/report-view.ts`
  names and formats them for `govukTable`. Stage durations are one captioned table per interval (fifteen columns would
  not read), each count followed by its median and 95th percentile; a null percentile reads "No cases". Completion puts
  Still open immediately before Cases timed and the percentiles, under the A6 sentence as inset text. Each section's
  details list the edited-dates caveat, the KPI's own api caveats and api's excluded counts (stage durations as a small
  table per interval); a `migrated` count is listed only when migrated cases were left out, since api reports 0
  otherwise. The copy stays in `src/management-information/content.ts`, the settings page's pattern, rather than
  `src/locales`, which holds only the layout's shared strings; notes are named keys because the Welsh extractor does
  not read arrays. Wide tables scroll in a focusable region (`_management-information.scss`). Format, lint and
  `build --force` clean; tests `//:test:app` 3,392 (+13), `@hmcts/deed-poll` 1,776 (+9), all passing.
