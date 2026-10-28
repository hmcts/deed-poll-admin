# Plan Da: item D's contract, mock and Delivery Manager settings

## Overview

Master Sullivan's feedback, item D (Steve, 2026-10-27/28): referrals are **assigned to a Master by the caseworker
raising them** instead of being claimed from a shared pool. api builds it in three plans on its branch
`feat/d-referral-assignment` (worktree `../deed-poll-api-juniper-d`, plans
`docs/plans/completed/20261028-d1-…`, `-d2-…`, `-d3-…`). **Read all three api plans' Overviews and D1's decision table
first**: they are the specification for this plan and the next. This plan is the admin foundation:

1. **Refresh `libs/deed-poll-api-client/openapi.json`** from that api branch's head, and bring the adapter
   (`client.ts`, `wire.ts`) and its contract test up to it.
2. **Teach the in-memory mock** the whole of item D, so the pages in plan Db and the e2e journeys run against it.
3. **The Delivery Manager settings page** grows the values D1 made settings, a Masters list and the bank holidays.

Plan Db is the caseworker and Master pages. Nothing in this plan changes a page a caseworker or a Master sees.

## Context

Read before changing anything:

- `CLAUDE.md`, especially "Delivery Manager settings" (two forms, two Saves, two revisions; the submitted section
  redrawn from the body with its original revision; a success is a 303 to `?saved=<section>#<section>`; the gate on
  `MANAGE_PROCESS_CONFIG`; the claim window form is digits only and does not use `readNumericInput`), "Admin spec
  refreshes are atomic" (the contract test is set-equal both ways, so a refresh carries the whole api),
  "No data access layer", the Welsh extractor rules, and the redirect-path rules.
- `docs/plans/20261026-dm-settings-page.md`: how the claim window section was built. Copy its patterns.
- `libs/deed-poll-api-client/SPEC-PROVENANCE.md`: how a refresh is recorded. `src/service-settings/` and
  `src/pages/deed-polls/settings/`: the settings page today. `libs/deed-poll/src/settings/schemas.ts`.
- `libs/deed-poll-api-client/src/mock/server.ts` and `server.test.ts`: the mock and its tests. The mock mirrors api's
  rules in api's words; a rule api has and the mock lacks lets a page ship with it applied at neither end.

## Development Approach

1. **Spec refresh.** In `../deed-poll-api-juniper-d` at its head commit, generate the document:
   `export JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true; OPENAPI_OUTPUT_PATH=/tmp/d-openapi.json
   ./gradlew cleanIntegration integration --tests '*OpenAPIPublisherTest' --no-daemon --console=plain`. Write it as
   2-space JSON into `libs/deed-poll-api-client/openapi.json`, run `yarn biome format --write .`, and check it parses
   equal to the raw artefact. Record a new top row in `SPEC-PROVENANCE.md` (the api branch and commit, that it is an
   **unmerged** branch, the raw SHA-256, the measured delta by parsed comparison) and relabel the old rows `Previous …`
   as the file does. **Do not edit the api worktree.** If the api worktree is mid-build or dirty, stop and say so.
2. **Adapter.** Add every new operation to `client.ts` and its schema to `wire.ts` (the Masters list and its writes,
   the bank holidays, assignment, the extended process settings and referral responses), following the existing
   functions exactly (`ApiResult`, no throws, `hasUsableSegments` for path ids). The deprecated pool and claim
   operations stay. `contract.test.ts` must pass set-equal both ways; extend its pinned lists for the new required
   fields and bounds (as `PROCESS_SETTINGS_LIMITS` is pinned today, add the new bounds to it or beside it).
3. **The mock.** Mirror api's D rules, in api's words, against the existing in-memory store:
   - The Masters list (create, update with revision, duplicate email 409, email change unlinks, unavailable), linking
     a judge whose token email matches an unlinked entry on their first judicial request, and the subject never in a
     response.
   - Process settings with the new fields, bounds, the ordering rule, old-shape PUTs, stale beats no-op.
   - Bank holidays seeded 2026–2028 (the same dates api seeds; copy them from api's migration), add and remove.
   - `ReferralWindows.windowFor` as a small pure function with its own tests (the same boundaries as api's), the cap
     (409 in api's words), assignment on create with `masterId`, `Open` without it, reassignment, the new response
     fields, `directionDueBy`, the Masters list's `window`, `cap` and `assignedInWindow`.
   - The Master side: `Open` invisible to judges, the pool always empty, `MINE_ORDER` as D2 states it,
     `unassignOverdue` on the same triggers the mock already uses for the lapse plus an explicit test hook to run it.
   - A test-only way to set the mock's clock, if it has none, so e2e journeys can make a referral overdue and cross a
     window without waiting. Follow how the mock already exposes scenarios (`scenario(...)` in the e2e helpers) and keep
     it out of production code paths.
   - **Seed data** (`yarn mock:seed` and `scripts/seed-local-cases.mjs`): seed three Masters (one unavailable, one
     linked to the existing judge persona's email), assign the seeded referrals rather than leaving them for claiming,
     and keep the seeder's read-back checks true (update its expected numbers and its CLAUDE.md line). Run it against a
     private-port mock and record that it completes.
4. **The settings page.** `/deed-polls/settings` gains sections, each its own form, Save and revision, after the
   existing two:
   - **"Referral process"**: replaces the "Referral claim window" section. Fields: the processing window in **days**
     (1–30, whole days; api's minutes are days × 1440), the reminder interval in hours (1–168), the cap per Master per
     window (1–100), and the four window times as `HH:mm` on the quarter hour. Digits-only parsing as the claim window
     does today (no `readNumericInput`); the ordering rule refused with a message on the afternoon start. One Save, one
     revision, because api keeps them in one row.
   - **"Masters"**: a table of the list (name, email, available, "Signed in" for linked), an "Add a Master" form
     (name, email) and, per row, a "Change" page for name, email and available. A duplicate email or a stale revision
     redraws the form with api's answer in the page's own words. Changing a linked Master's email says first that they
     will need to sign in again before they see their referrals.
   - **"Bank holidays"**: the list by date (dd-mm-yy, as Steve chose for the Master's page), "Add a bank holiday" (date
     and name, GOV.UK date input) and a "Remove" button per row (a POST to a dedicated route, with a confirmation
     page, never a state-changing GET).
   - Every new route is under `src/pages/deed-polls/settings/`, so the existing gate covers it (`app.test.ts` reads the
     directory). The handler code goes in `src/service-settings/` (every `.ts` under `src/pages` is a route). Every
     page has `en`/`cy` pairs (the `cy` mirroring `en` for now, as the existing sections do), and
     `src/service-settings` is already on the Welsh extractor's `INCLUDE`; check new directories are covered.
   - Templates extend `layouts/app.njk`; ids in hrefs go through the path filters (`template-hrefs.test.ts`).
5. **Tests first**: domain schema tests for every bound and the ordering rule; handler tests for each section's
   success, 400, 409 and stale-revision redraw; template tests (content spread first, model over it, per
   `.claude/rules/testing.md`); mock tests for every rule above; `client.test.ts` for each new adapter function against
   the mock.
6. **e2e:** extend `e2e-tests/tests/gazette.spec.ts`'s settings journey (the settings page's existing e2e, run with
   `yarn test:gazette` on its private ports) to change the referral process values, add a Master, mark one
   unavailable and add and remove a bank holiday, with an accessibility check on each new page. Run it with
   `yarn test:gazette`; it needs Redis on 6316 and local IDAM on 5556 (see README). If either is unavailable, say so in
   the execution notes rather than skipping silently.
7. **Out of scope:** the raise form, reassignment, the Master's pages and every other caseworker page (plan Db); the
   api branch; Notify.
8. **Publishing:** local task commits only, no push and no PR.

## Validation Commands

Run from the repository root before implementation and after each task:

```bash
yarn biome format --write .
yarn lint
yarn build --force
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
```

Never quote bare `yarn test`; the turbo command above is the full suite. `yarn welsh:check` exits 1 by design and is
not a gate. Record each package's test count from the turbo output (app, deed-poll, api-client and the five small
packages), and distinguish baseline failures from regressions. If Redis is not reachable on 6379, the Redis suites
skip; say so.

**Baseline on `93e1a29` (admin master, 2026-10-28):** expected green — app 3,142, deed-poll 1,612, api-client 1,216
at the equivalent #369 head. Re-record at execution time.

Run every build and test command in the **foreground** and wait for it to finish. A backgrounded build ends the
session, and the next one builds over it, wiping the results. Never move `dist` aside to test a clean build; use
`--force`.

## Implementation Steps

### Task 1: Spec refresh and adapter
- [ ] Record the execution baseline (commit, test counts) in the execution notes.
- [ ] Generate the spec from the api D branch head, record its provenance, and add the adapter functions and schemas with failing `client.test.ts` and `contract.test.ts` cases first.
- [ ] Implement, run all Validation Commands, and record the results.

### Task 2: The mock
- [ ] Add failing mock tests for every rule in the Development Approach.
- [ ] Implement the mock, the clock hook and the seed data, run the seeder against a private-port mock, run all Validation Commands, and record the results.

### Task 3: Settings: referral process
- [ ] Add failing schema, handler and template tests.
- [ ] Implement the section, run all Validation Commands, and record the results.

### Task 4: Settings: Masters and bank holidays
- [ ] Add failing schema, handler and template tests for both sections and the remove confirmation.
- [ ] Implement, run all Validation Commands, and record the results.

### Task 5: e2e, documentation and final verification
- [ ] Extend the settings e2e journey and run `yarn test:gazette`; record the result.
- [ ] Update `CLAUDE.md`'s "Delivery Manager settings" section, the mock seed line and `SPEC-PROVENANCE.md`; regenerate the Welsh CSV with `yarn welsh:extract`.
- [ ] Run all Validation Commands once more with `--force`, record the counts against the baseline, and confirm `git status` is clean apart from the task commits.

## Execution notes
