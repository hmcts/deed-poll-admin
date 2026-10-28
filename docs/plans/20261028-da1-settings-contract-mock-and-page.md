# Plan Da1: item D's settings contract, mock and Delivery Manager settings

## Overview

Master Sullivan's feedback, item D (Steve, 2026-10-27/28): referrals are **assigned to a Master by the caseworker
raising them** instead of being claimed from a shared pool. api builds it in three plans on its branch
`feat/d-referral-assignment` (worktree `../deed-poll-api-juniper-d`, plans
`docs/plans/completed/20261028-d1-…`, `-d2-…`, `-d3-…`). **Read all three api plans' Overviews and D1's decision table
first**: they are the specification for this plan and the next. This plan is the admin foundation:

1. **Refresh `libs/deed-poll-api-client/openapi.json`** to **api D1's** finished contract (the Masters list, the
   extended process settings, the bank holidays), and bring the adapter (`client.ts`, `wire.ts`) and its contract
   test up to it.
2. **Teach the in-memory mock D1's rules.**
3. **The Delivery Manager settings page** grows the values D1 made settings, a Masters list and the bank holidays.

**Split for speed (Steve, 2026-10-28):** this plan runs **while api works on D2**, so it covers only what D1 built.
Plan Db1 refreshes the contract again to D2, teaches the mock assignment, and builds the caseworker and Master pages.
Nothing in this plan changes a page a caseworker or a Master sees.

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

1. **Spec refresh.** The overnight chain has already generated api D1's document for you, in a throwaway api
   worktree, so nothing here touches the api worktree ralphex is using: copy `/tmp/juniper-340/spec-d1.json` into
   `libs/deed-poll-api-client/openapi.json` as 2-space JSON, run `yarn biome format --write .`, and check it parses
   equal to that file. `/tmp/juniper-340/spec-d1.meta` holds the api commit and the raw SHA-256. Record a new top
   row in `SPEC-PROVENANCE.md` (api branch `feat/d-referral-assignment`, that commit, that it is an **unmerged**
   branch, the SHA-256, the measured delta by parsed comparison) and relabel the old rows `Previous …` as the file
   does. **Do not generate it yourself and do not touch `../deed-poll-api-juniper-d`.** If the two files are missing,
   stop and say so.
2. **Adapter.** Add every new operation to `client.ts` and its schema to `wire.ts` (the Masters list and its writes,
   the bank holidays and the extended process settings), following the existing
   functions exactly (`ApiResult`, no throws, `hasUsableSegments` for path ids). The deprecated pool and claim
   operations stay. `contract.test.ts` must pass set-equal both ways; extend its pinned lists for the new required
   fields and bounds (as `PROCESS_SETTINGS_LIMITS` is pinned today, add the new bounds to it or beside it).
3. **The mock.** Mirror api D1's rules, in api's words, against the existing in-memory store:
   - The Masters list (create, update with revision, duplicate email 409, email change unlinks, unavailable), linking
     a judge whose token email matches an unlinked entry on their first judicial request, and the subject never in a
     response.
   - Process settings with the new fields, bounds, the ordering rule, old-shape PUTs, stale beats no-op.
   - Bank holidays seeded 2026–2028 (the same dates api seeds; copy them from api's V42 in
     `../deed-poll-api-juniper-d/src/main/resources/db/migration/`, reading only), add and remove.
   - **Seed data** (`yarn mock:seed`): seed three Masters (one unavailable, one with the judge persona's email so it
     links on first sign-in). Keep the seeder's read-back checks true. Assignment of the seeded referrals is Db1's.
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
7. **Out of scope:** assignment in the adapter and the mock, the raise form, reassignment, the Master's pages and every
   other caseworker page (plan Db1); the api branch; Notify.
8. **Publishing:** local task commits only, no push and no PR.

## Validation Commands

Run the full set from the repository root **twice only**: before implementation (the baseline) and in the final
task. **After each other task**, run `yarn biome format --write .`, `yarn lint`, `yarn build --force` and only the
touched packages' tests (for example `yarn workspace @hmcts/deed-poll-api-client vitest run`, `yarn workspace
@hmcts/deed-poll vitest run`, and `yarn vitest run <paths>` for the app), with `REDIS_URL=redis://127.0.0.1:6379`.
If one of those shows a failure outside the task, run the full suite then. The full set:

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
- [x] Record the execution baseline (commit, test counts) in the execution notes.
- [x] Copy the chain's D1 spec, record its provenance, and add the adapter functions and schemas with failing `client.test.ts` and `contract.test.ts` cases first.
- [x] Implement, run the per-task checks, and record the results.

### Task 2: The mock
- [x] Add failing mock tests for every rule in the Development Approach.
- [x] Implement the mock rules and the seed data, run the seeder against a private-port mock, run the per-task checks, and record the results.

### Task 3: Settings: referral process
- [x] Add failing schema, handler and template tests.
- [x] Implement the section, run the per-task checks, and record the results.

### Task 4: Settings: Masters and bank holidays
- [x] Add failing schema, handler and template tests for both sections and the remove confirmation.
- [x] Implement, run the per-task checks, and record the results.

### Task 5: e2e, documentation and final verification
- [x] Extend the settings e2e journey and run `yarn test:gazette`; record the result.
- [x] Update `CLAUDE.md`'s "Delivery Manager settings" section, the mock seed line and `SPEC-PROVENANCE.md`; regenerate the Welsh CSV with `yarn welsh:extract`.
- [x] Run all Validation Commands once more with `--force`, record the counts against the baseline, and confirm `git status` is clean apart from the task commits.

## Execution notes

**Baseline (2026-10-28, branch `feat/d-referral-assignment` at `54b64aa`, after `yarn install`).** Full set green:
lint clean, `yarn build --force` 8/8, suite 8/8 tasks. app 3,148, deed-poll 1,612, api-client 1,216,
cloud-native-platform 156, express-govuk-starter 132, simple-router 45, express-session-postgres 85,
express-session-redis 7. Redis answered on 6379, so the Redis suites ran. (The plan's 3,142 for app was #369's head;
the two plan commits since added none of the six.)

**Task 1 (spec refresh and adapter).**
- `/tmp/juniper-340/spec-d1.json` at api `504ce4b` copied, Biome-formatted and parsed equal to the raw file; its
  SHA-256 matched `spec-d1.meta`. Delta: 6 operations and 5 schemas added, nothing removed; 65 operations, 46 paths,
  66 schemas. New top row in `SPEC-PROVENANCE.md`, the old top row relabelled `Previous …`.
- **Two parts of the delta reached beyond the plan's list.** (1) D1 also carries api's PR 3: `publishToGazette` is
  gone from `ReferralResponse`, `JudicialReferralDetail` and `JudicialDirectionRequest`. The wire schemas, the
  `JudicialDirection` type and the mock's derived alias are dropped with it (the mock test now pins its absence).
  (2) The processing window's bounds moved from 30–1440 to **1440–43200** minutes, and api's seed is now 10080.
  So `PROCESS_SETTINGS_LIMITS` is renamed (`min/maxProcessingMinutes`, plus reminder and cap bounds) and the mock's
  process settings were updated now rather than in Task 2. They now take every new field and bound, keep an absent
  field's stored value and use api's seed. That is needed because the response schema requires the new ints. The
  ordering rule is still Task 2's.
- The existing claim-window form (hours ≤ 24, minutes ≤ 59) now accepts only 24:00–24:59 under the new floor. Its
  range copy, which said "between 30 minutes and 24 hours", now says "at least 24 hours". Its schema, handler,
  template and e2e fixtures are moved onto values valid against the new bounds. Task 3 replaces the section. The
  e2e was edited but not run; `yarn test:gazette` is Task 5's.
- Adapter: `listMasters`, `createMaster`, `updateMaster`, `listBankHolidays`, `addBankHoliday`, `removeBankHoliday`,
  and `updateProcessSettings` now sends the six optional fields (undefined ones are dropped by `JSON.stringify`, so an
  old-shape body is still possible). New exported bounds `MASTER_LIMITS`, `BANK_HOLIDAY_LIMITS` and
  `WINDOW_TIME_PATTERN`, all pinned in `contract.test.ts`. Strictness: `MasterResponse` id/available/linked/revision;
  `BankHolidayResponse` date (its key and path segment); the process settings' three ints. A bank holiday's date
  stays a `yyyy-MM-dd` string, not a `Date`.
- `client.test.ts` round trips run against basic mock routes added now (`src/mock/masters.ts`,
  `src/mock/bank-holidays.ts`): reads for any staff caller, writes `MANAGE_PROCESS_CONFIG` only, revision and
  duplicate 409s, and a 404 for an unknown Master or an unlisted date. Task 2 still owns linking on a judge's first
  request, the ordering rule, the V42 dates and the seed data, and the tests for every rule.
- Per-task checks: format, lint clean, `yarn build --force` 8/8. api-client 1,242 (+26), deed-poll 1,611 (one
  claim-window table row fewer), app 3,148 (the full app suite, run because the mock changed under it).

**Task 2 (the mock).**
- Masters (`masters.ts`) now use api's `MasterService` sentences and checking order: unknown key, name, email,
  available, revision, then the id (not a UUID is the same 404, "No such Master"), stale before the no-op, and the
  duplicate check only when the email actually changes. A duplicate is a 409 with api's field error on `email` and
  never the address. An email change unlinks the entry.
- Linking: `linkIfListed` runs on every `/judicial/` path before the request is answered (api's `MasterLinking`
  interceptor). It reads the caller through `callerClaims`, so a local IDAM token's email comes from userinfo. It
  needs the judicial role, a subject and an email with an `@`. It never creates or moves an entry. api's two fixed
  WARN sentences are `console.warn`ed and name nobody. The subject is never in a response.
- Process settings: api's ordering rule after the stale check, against stored values for absent times, refused on
  `morningWindowEnd`, `afternoonWindowStart` or `afternoonWindowEnd` in api's words. Also api's unknown-key and
  quarter-hour sentences.
- Bank holidays: api's V42 24 dates (2026–2028) seeded and restored on reset, plus api's sentences and a 409 field
  error on `date`. `client.test.ts`'s bank-holiday cases moved to 2029 dates, because 2026-12-25 is now seeded.
- New tests: `masters.test.ts` and `bank-holidays.test.ts` (over HTTP) and 25 new `process-settings.test.ts` cases.
- Seed: `yarn mock:seed` adds Master Judge (`judge@example.com`, the local judge persona from `seed-idam-users.mjs`),
  Master Sullivan and Master Wren (unavailable), all through `POST /caseworker/masters` as the Delivery Manager. The
  read-back fails on a mismatch. `--keep` skips addresses already listed.
- I ran the seeder against a private mock on 3241: exit 0, 57 cases, 3 Masters with 1 unavailable, and every
  existing read-back true. A judicial request with `Judge@example.com` then linked Master Judge. A `--keep` re-run
  added no duplicate.
- Per-task checks: format and lint clean, `yarn build --force` 8/8. api-client 1,314 (+72). I ran the app suite
  too, because the mock changed under it: 3,148, green. deed-poll was not touched.

**Task 3 (settings: referral process).**
- "Referral process" replaces "Referral claim window" in place: same `id="process-settings"`, the same POST to
  `/deed-polls/settings`, one revision and one Save ("Save referral process"). There are seven controls: `processingDays`,
  `reminderIntervalHours`, `masterWindowCap`, then two fieldsets (`morning-window`, `afternoon-window`) holding
  `morningWindowStart`/`End` and `afternoonWindowStart`/`End`. Every save sends all seven fields, because the form
  draws every one.
- `processSettingsFormSchema` (`libs/deed-poll/src/settings/schemas.ts`) reads whole numbers as trimmed `^\d{1,4}$`
  (still not `readNumericInput`) against bounds taken from `PROCESS_SETTINGS_LIMITS`. The days bounds are a new export,
  `PROCESSING_DAYS_LIMITS` (1-30, from api's minutes ÷ 1,440). Times are trimmed and must match `WINDOW_TIME_PATTERN`.
  The ordering rule runs only when every control is valid. It is refused on the field api names: the morning end, the
  **afternoon start** for the morning end not being before it, or the afternoon end.
- api's 400 maps each field to its control in this page's words. The form has already checked each time's format, so
  api naming `morningWindowEnd`, `afternoonWindowStart` or `afternoonWindowEnd` is shown as the ordering message.
  `revision` still requires a reload, and any other field gets the generic refusal.
- A stored window of part-days (possible only for an old claim window, e.g. 1,470 minutes) is shown as days to two
  places (`1.02`), never rounded. The digits-only form refuses it, so a save cannot silently change it. A null window
  time is shown as an empty control.
- The copy no longer mentions claims or the pool: the warning is "Changes take effect immediately for every
  referral." The new copy's `cy` mirrors its `en`.
- The e2e spec (`service-settings.spec.ts`) and README were moved onto the new section. The e2e was edited but not
  run; `yarn test:gazette` is Task 5's.
- Tests were written alongside the code rather than run failing first.
- Per-task checks: format and lint clean, `yarn build --force` 8/8. deed-poll 1,650 (+39), app 3,164 (+16), all
  passing, with Redis on 6379.

**Task 4 (settings: Masters and bank holidays).**
- The Masters and Bank holidays sections come after the Gazette section and before Staff and access. Each holds a
  list that is always read (degrading on its own to a sentence) and an add form below it, posting to
  `/deed-polls/settings/masters` and `/deed-polls/settings/bank-holidays`. Neither form carries a revision. Only a
  refused add form is redrawn from the body. Both addresses answer a `GET` with a 302 back to their section, as
  `gazette-recipient` does.
- New routes, all under `src/pages/deed-polls/settings/`, so the existing gate covers them. `app.test.ts` now names
  all four: `masters/[masterId]` (the Change page, `GET` and `POST`), `bank-holidays/[date]/remove` (the
  confirmation `GET` and the removal `POST`), and the two add routes. The handlers are in `src/service-settings/`
  (`page.ts`, `master-change.ts`, `bank-holiday-remove.ts`). Every save is a 303 through `savedRedirect`, to one of
  six `?saved=` keys and its section's fragment.
- **One change below the page.** api's duplicate-email 409 names `email`, and a stale revision names no field. The
  adapter used to drop a 409's field errors, which left the two indistinguishable. A 409 now keeps `fieldErrors`
  when api sends them (left out when there are none, so existing results are unchanged), and `ConflictError` carries
  them as `errors`. The Change page reads `email` as "Another Master already has this email address" and anything
  else as a reload. On the add form every 409 is the duplicate, because a new Master has no revision.
- The Change page sends all three fields at the original revision. api has no single-Master read, so the `GET` finds
  the Master on the list and answers 404 when it is not there. A refused save re-reads only `linked`, which decides
  the warning that a signed-in Master must sign in again after an email change. If that read fails, the warning is
  shown.
- Bank holidays are shown as `dd-mm-yy`. The add form uses a GOV.UK date input (`date-day`, `date-month`,
  `date-year`) read by `bankHolidayFormSchema` into a real calendar date, and every date issue is on `date`.
  The Remove link goes to the confirmation page, whose one form posts the removal. A removal api answers 404 for
  reads as removed.
- New domain functions: `masterFormSchema`, `masterChangeFormSchema`, `bankHolidayFormSchema`, `findMasters`,
  `saveNewMaster`, `saveMasterChange`, `findBankHolidays`, `saveBankHoliday`, `deleteBankHoliday`. The new copy is
  in `src/service-settings/content.ts`, with its `cy` mirroring `en`.
- Tests were written alongside the code rather than run failing first.
- Per-task checks: format and lint clean, `yarn build --force` 8/8. api-client 1,314 (two new assertions, no new
  cases), deed-poll 1,701 (+51), app 3,227 (+63), all passing, with Redis on 6379.

**Task 5 (e2e, documentation and final verification).**
- `service-settings.spec.ts` gains a second journey: add a Master (then a duplicate email, refused with the page's
  sentence), change it to unavailable on its Change page, add a 2029 bank holiday and remove it through the
  confirmation page, with an axe check on the settings page after each save, the Change page and the confirmation.
- `yarn test:gazette`: **10 passed**. Redis was not running on 6316, so I started a throwaway
  `redis:8-alpine` container on it per the README (`--rm`, stopped afterwards); local IDAM answered on 5556. The
  first run failed one assertion in the referral-process journey that Task 3 edited but never ran: an exact
  `getByText` on the warning text, which GOV.UK prefixes with a visually hidden "Warning". It now asserts the
  warning's text with `toContainText`. The second run passed all ten.
- `CLAUDE.md`'s "Delivery Manager settings" now describes the referral process form, the Masters' 409 field errors,
  the bank holiday removal and the mock's starting state and linking; the `mock:seed` line names the three Masters.
  `SPEC-PROVENANCE.md` already had Task 1's complete row, so it is unchanged. `yarn welsh:extract` rewrote only
  `src/service-settings/content.ts` rows (the claim window's gone, the new sections' added).
- Final full set: format (one file fixed), lint clean, `yarn build --force` 8/8, suite 8/8 with Redis on 6379 (the
  Redis suites ran). Against the baseline: app 3,227 (+79), deed-poll 1,701 (+89), api-client 1,314 (+98),
  cloud-native-platform 156, express-govuk-starter 132, simple-router 45, express-session-postgres 85,
  express-session-redis 7 (all unchanged). No failures. `git status` was clean apart from this task's files.
