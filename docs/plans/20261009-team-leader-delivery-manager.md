# Team leader and Delivery Manager: admin application

## Overview

Replace the caseworker-admin persona with Team leader and introduce Delivery Manager. Delivery Manager
inherits Team leader's existing casework privileges. The entire Gazette area, its navigation and count
are Delivery Manager-only. Team leaders cannot view the ready list or history, configure the recipient,
review, preview, submit, or inspect publication requests. Further management powers are separate
requirements.

Requirements confirmed on 9 October 2026. Revised on 12 October 2026 against admin `master` `3fd7b3e`.
By then the full Gazette journey had merged (PRs #163, #165, #166): recipient settings, the request
ledger pages and the mandatory review/send flow all exist, and every one of them is in scope here.

Companions:

- API: `hmcts/deed-poll-api` PR #100 (`feat/team-leader-delivery-manager`, head `d335d39` on 2026-10-12),
  plan at `docs/plans/completed/20261009-team-leader-delivery-manager.md` on that branch. Locally:
  `../../../deed-poll-api/docs/plans/completed/20261009-team-leader-delivery-manager.md` when that branch
  is checked out.
- Infra and identity rollout: `../../../deed-poll-infra/docs/plans/20261009-team-leader-delivery-manager.md`.

## Context

Baseline on 2026-10-12: admin `origin/master` `3fd7b3e`; API `origin/master` `5ec0762`; API PR #100
unmerged and behind API master. Admin's `libs/deed-poll-api-client/openapi.json` was taken from API
`742cb5a` (see `SPEC-PROVENANCE.md`).

**What API PR #100 changes in the published contract, measured on 2026-10-12:** operation and query-parameter
*descriptions* only. Each Gazette operation now says "Requires caseworker-deedpoll-delivery-manager", and
the `filter` parameter says the named `readyForPublication` worklist answers 403 to anyone else, including
through saved-query links. **No path, operation, parameter or schema is added or removed.** So nothing in
this plan depends on the refresh. Task 1 takes it if #100 has merged, and records the deferral if not.

### The shared permission matrix

The authority is API's `src/test/resources/auth/staff-permission-contract.json` on the PR #100 branch.
These are its single-role rows; its mixed-role rows are unions of them:

| Claims | Capabilities | Judicial |
|---|---|---|
| `caseworker-deedpoll-team-leader` | `OVERRIDE_PRIVACY`, `DELETE_NOTE`, `DELETE_WITNESS`, `MANAGE_SHARED_QUERIES`, `REPAIR_CCD` | no |
| `caseworker-deedpoll-delivery-manager` | the five above, plus `ACCESS_GAZETTE` | no |
| `caseworker-deedpoll-admin` (legacy) | the same five as Team leader. **Never** `ACCESS_GAZETTE` | no |
| `caseworker-deedpoll` | none | no |
| `caseworker-deedpoll-judicial` | none | yes |
| empty, or only unrecognised claims | none | no |

Admin has no CCD repair UI (`REPAIR_CCD` appears only in `libs/deed-poll-api-client/src/api/deferred-contract.json`).
So admin mirrors all six names for parity and **consumes all but `REPAIR_CCD`**:
`OVERRIDE_PRIVACY`, `DELETE_NOTE`, `DELETE_WITNESS`, `MANAGE_SHARED_QUERIES` and `ACCESS_GAZETTE`.

### Every place the old admin role decides something today

Measured on `3fd7b3e`. Task 6 re-scans for any that merge in later.

- **Role and claim:** `libs/deed-poll/src/auth/roles.ts` (`DEEDPOLL_ADMIN`, the `Role` union),
  `libs/deed-poll/src/auth/idam-claims.ts` (`KNOWN_ROLES`), `libs/deed-poll/src/auth/current-user.ts`
  (`isAdmin: roles.includes(DEEDPOLL_ADMIN)`), and the exports in `libs/deed-poll/src/index.ts`.
- **Session:** `src/auth/session.ts`'s `sessionUser` returns the **stored** `CurrentUser` object unchanged,
  including a stored `isAdmin`. `src/auth/current-user.ts`'s `userFromRequest` returns that object.
  `src/auth/idam.ts` builds the user at login with `userFromClaims`.
- **Area gate:** `src/app.ts:208`, `app.use("/deed-polls/gazette", requireRole(DEEDPOLL_ADMIN))`.
  `src/auth/require-role.ts` exports `requireRole` and `requireJudicial`. `src/app.ts:64` mounts a
  urlencoded parser on `/deed-polls/gazette/batch`, ahead of the gate.
- **Gazette pages, all under the one gate:** `src/pages/deed-polls/gazette/{index,history,settings,batch}.ts`
  and `src/pages/deed-polls/gazette/requests/{index,[batchId]}.ts`. `settings.ts` and `batch.ts` handle POSTs.
- **Dashboard count:** `src/pages/deed-polls/index.ts:265` `worklistCounts(caller, userFromRequest(req).isAdmin)`.
  `countGazetteReadyCases` is requested only when that flag is true.
- **Landing:** `src/pages/index.ts:73`, `user.isJudicial && !user.isAdmin`.
- **Privacy:** `libs/deed-poll/src/deed-poll/form-presentation.ts` (`ctx.isAdmin`),
  `libs/deed-poll/src/deed-poll/edit-view.ts`, and `src/pages/deed-polls/[id]/edit/[tab].ts`.
- **Deletion:** `libs/deed-poll/src/notes/delete-policy.ts`, `libs/deed-poll/src/witnesses/delete-policy.ts`
  and `libs/deed-poll/src/witnesses/service.ts`, rendered through `src/pages/deed-polls/[id].ts`,
  `src/pages/deed-polls/[id]/notes/[noteId]/edit.ts`, `src/pages/deed-polls/[id]/witnesses/[witnessId]/edit.ts`,
  `note-edit.njk` and `witness-edit.njk`.
- **Shared-query publishing:** `src/pages/deed-polls/queries/new.ts:180` and `[queryId]/edit.ts:134,185`
  (`canPublish`), with `new.njk`, `edit.njk` and `delete.njk` beside them, and `[queryId]/delete.ts`.
- **Test doubles:** `src/express-doubles.ts:75` (an `admin` flag that maps to `DEEDPOLL_ADMIN`), and
  `src/app.test.ts:284`, which mocks `requireRole` for the Gazette gate.
- **Mock API:** `libs/deed-poll-api-client/src/mock/server.ts` checks the literal `"caseworker-deedpoll-admin"`
  at lines 432 (settings), 466 (preview, submit, requests, request detail and members) and 495 (history).
  **The `readyForPublication` filter, defined near line 1821, has no role check.**
- **Personas and seed data:** `src/auth/persona-switcher.ts:96` (the `admin` persona,
  "Caseworker with admin"), `src/auth/persona-users.ts`, `libs/deed-poll-api-client/src/seed/accounts.ts:43`,
  `scripts/seed-idam-users.mjs:34` (`admin@example.com`) and `scripts/seed-local-cases.mjs:72,345-347`
  (Gazette reads as `seed.admin` with `DEEDPOLL_ADMIN`).
- **Browser tests:** `e2e-tests/tests/idam-session.ts` (`ADMIN_EMAIL`, `ADMIN_STORAGE_STATE`),
  `e2e-tests/tests/auth.setup.ts`, `gazette.spec.ts`, `persona-switcher.spec.ts`, `deed-polls.spec.ts`,
  `confirmation.spec.ts`, `emails.spec.ts` and `judicial.spec.ts`. The configs are
  `e2e-tests/playwright.config.ts` and `e2e-tests/playwright.gazette.config.ts`.

## Decisions: implement these, do not revisit

1. **Claim names are exactly `caseworker-deedpoll-team-leader` and `caseworker-deedpoll-delivery-manager`,**
   in lockstep with API and IDAM. Add them to `roles.ts` and import them everywhere. Never restate the strings.
2. **Capabilities are derived from recognised roles by a pure function and are never stored.** Add
   `libs/deed-poll/src/auth/capabilities.ts` exporting the capability names, `capabilitiesFor(roles)` and
   `can(user, capability)`. A colocated test asserts every row of the matrix above.
   **Do not copy API's JSON into this repo**: it is API's test fixture, and a copied file goes stale without
   failing. The table above is the record of what was mirrored.
3. **`CurrentUser` stays a plain serialisable object** (roles, booleans, name), because Redis sessions store it.
   No `Set`, function or class instance goes into it.
4. **`isAdmin` keeps its name and now means `OVERRIDE_PRIVACY`.** That way the privacy, delete-policy and
   form-presentation call sites keep their `{ isAdmin }` context shape. The note, witness and shared-query
   controls move to `can(user, …)` with their own capability. **Gazette never reads `isAdmin`.**
5. **A stored session is re-derived on every read.** `sessionUser` returns
   `currentUser(rolesFrom(stored.roles), stored.name)`, so a session written before this change with
   `isAdmin: true` and only the legacy role still gets Team leader rights, but **never Gazette**. This also
   ignores stale booleans. A token refresh still does not update roles: a changed role assignment needs a
   fresh login (Post-Completion).
6. **The legacy role keeps Team leader rights during migration and loses Gazette immediately.** Mark it
   migration-only in `roles.ts` and keep it in `KNOWN_ROLES` until the infra plan's retirement criteria
   are met.
7. **There is one Gazette gate, at the area mount,** `requireCapability(ACCESS_GAZETTE)` in
   `src/auth/require-role.ts`. It refuses with `ForbiddenError`, exactly like `requireJudicial`, and covers
   any page added under `src/pages/deed-polls/gazette/` because of where the page lives. **Do not add a
   per-page check.**
8. **The ordinary case list already cannot reach the ready-for-publication worklist. Pin that; do not add
   a refusal.** `src/pages/deed-polls/index.ts:219` and `src/pages/deed-polls/queries/new.ts:145` resolve
   `?filter=` through `filterFor` (`libs/deed-poll/src/deed-poll/list-filters.ts`). It admits only the seven
   `LIST_FILTERS` keys and falls back to `all` for anything else, `readyForPublication` included. So a
   bookmarked URL or saved-query link shows "All applications", which is the existing fallback that
   `list-paging.ts` and `queries/new.ts` document. The only sender of `READY_FOR_PUBLICATION_FILTER`
   is `libs/deed-poll/src/gazette/service.ts`, which only Gazette pages call. **Never add
   `readyForPublication` to `LIST_FILTERS`.** API PR #100 enforces the 403 independently.
9. **The API stays the boundary.** Production calls still send only the access token. No capability, role
   or asserted header goes to the API. The mock's role checks are fixtures that model the API, not the
   security boundary.
10. **The repository, OAuth client and session cookie names do not change.** Only roles and personas do.

## Development Approach

- Work in an isolated worktree on a branch from current `origin/master`. Read `CLAUDE.md` and
  `.claude/rules/{frontend,backend,testing,e2e-testing}.md` first.
- Each task ships its regression tests with its code.
- **Run every build and test command in the foreground**, with a 600000 ms timeout. Never run one in the
  background and promise to commit later: a non-interactive session ends there, and the restart runs a second
  suite over the first. If a command outlives the timeout, stop and record that rather than retrying.
- Preserve other developers' files, worktrees, ports and containers. If port 3200, 3216 or 3316 is already
  held, it belongs to another agent. Do not kill it. Report and stop.
- Bilingual copy follows `.claude/rules/frontend.md`. Persona-switcher copy stays English-only in its
  `COPY` const (see CLAUDE.md).

## Validation Commands

Run after **every** task, from the worktree root, with immutable dependencies installed:

```bash
yarn lint
npx turbo test test:app --concurrency=1
yarn build
git diff --check
```

**Baseline on `3fd7b3e`, measured 2026-10-12:** lint clean; `8 successful, 8 total`, 3,724 tests passed and
3 skipped; build `8 successful`. Task 1 re-measures it on the implementation branch.

**Three checks are deliberately NOT in this section. They run only in Tasks 5 and 6:**

- **`yarn welsh:check` exits 1 on master by design.** On 2026-10-12: 675 strings, 474 still identical in
  `cy`. A gate that starts red fails every task. Compare the count against Task 1's baseline, and do not
  expect a zero exit.
- **`yarn test:gazette`** needs local IDAM on 5556 and Redis on 6316 (README, "test:gazette"), and starts
  its own app on 3316 and mock on 3216.
- **`yarn test:e2e`** cannot start its own `webServer` from a worktree. Docker compose names its project
  after the directory and collides with the main checkout's `deed-poll-redis`/`deed-poll-idam`. Start the
  mock and app by hand, without `dev:up`, and let `reuseExistingServer` find them.

A bare `yarn test` is not a substitute: it can report `0 successful, 8 total` having run nothing.

## Implementation Steps

### Task 1: Baseline, and reconcile the API contract

**Files:** `libs/deed-poll-api-client/openapi.json`, `libs/deed-poll-api-client/SPEC-PROVENANCE.md`,
`libs/deed-poll-api-client/src/api/contract.test.ts`, and this plan's Execution notes.

- [x] Record the admin branch base SHA, `git status`, and the Validation Commands results with counts. Record the `yarn welsh:check` totals (strings, identical in `cy`) as the Welsh baseline.
- [x] Check whether API PR #100 has merged: `gh pr view 100 -R hmcts/deed-poll-api --json state,mergeCommit`. **If it has merged,** regenerate `openapi.json` from merged API master in a clean detached API worktree, by the method `SPEC-PROVENANCE.md` records (`./gradlew integration --tests "*OpenAPIPublisherTest*"` with `TESTCONTAINERS_RYUK_DISABLED=true`). Then confirm the delta is descriptions only, and add a provenance entry with the SHA, the counts and that delta. Take the **whole** API document. If it carries unrelated operations, register them through the existing deferred-operation inventory, not wildcards.
- [x] **If #100 has not merged,** change nothing in the client. Record in Execution notes that the refresh is deferred, and that the measured delta is description-only, so no code depends on it.
- [x] Re-run the inventory greps for `DEEDPOLL_ADMIN`, `isAdmin` and `caseworker-deedpoll-admin` across `src`, `libs/*/src`, `scripts` and `e2e-tests`. Record any hit not listed in Context. Those files join the task that owns their concern.
- [x] Mark completed

### Task 2: Roles, capabilities and session normalisation

**Files:** `libs/deed-poll/src/auth/roles.ts`, `libs/deed-poll/src/auth/idam-claims.ts`,
`libs/deed-poll/src/auth/current-user.ts`, new `libs/deed-poll/src/auth/capabilities.ts` (+ `.test.ts`),
`libs/deed-poll/src/index.ts`, `libs/deed-poll/src/auth/idam-claims.test.ts`, `src/auth/session.ts`
(+ `session.test.ts`), `src/auth/current-user.ts` (+ test), `src/pages/index.ts` (+ test).

- [x] Add `DEEDPOLL_TEAM_LEADER` and `DEEDPOLL_DELIVERY_MANAGER` to `roles.ts` and the `Role` union, and to `KNOWN_ROLES`. Give `DEEDPOLL_ADMIN` a docblock saying it is migration-only and why it keeps Team leader rights.
- [x] Add `capabilities.ts` (Decision 2). Make `currentUser` derive `isAdmin` from `OVERRIDE_PRIVACY` (Decision 4). Export `rolesFrom`, or a session-safe equivalent, so that `session.ts` can reuse the same filter.
- [x] Make `sessionUser` re-derive the user from stored roles and name (Decision 5). A stored object with no `roles` array resolves to no roles, not to a crash.
- [x] Landing: `src/pages/index.ts` keeps judicial-only users on the pool and everyone else on the case list. Re-express the check as "judicial and holds no capability", not `!isAdmin`.
- [x] Tests: every matrix row; duplicate and unknown claims; a stored legacy session with `isAdmin: true`; a stored session whose roles were edited to include an unrecognised string; the landing for each single role and for each mixed judicial role.
- [x] Mark completed

### Task 3: Gate every Gazette entry, and move the other controls to capabilities

**Files:** `src/auth/require-role.ts` (+ test), `src/app.ts`, `src/app.test.ts`,
`src/pages/deed-polls/index.ts` (+ test, + template test), the privacy, deletion and shared-query files
listed in Context, and `src/express-doubles.ts`.

- [x] Add `requireCapability(capability)` beside `requireRole`, and mount `requireCapability(ACCESS_GAZETTE)` on `/deed-polls/gazette` at the line where `requireRole(DEEDPOLL_ADMIN)` is now, after authentication and before routing. Keep the `/deed-polls/gazette/batch` body parser where it is. Remove `requireRole` if nothing else uses it.
- [x] In `src/app.test.ts`, extend the filesystem-derived coverage so that every file under `src/pages/deed-polls/gazette/`, including `requests/`, sits behind the capability gate. The test must fail if a Gazette page is reachable without it, in the same way the judicial test does.
- [x] `src/pages/deed-polls/index.ts`: the Gazette count and link depend on `can(user, ACCESS_GAZETTE)`. A user without it makes **no** `countGazetteReadyCases` call. Keep the zero, unavailable and independent-failure states for Delivery Managers.
- [x] Pin Decision 8 with tests. `filterFor("readyForPublication")` resolves to `all`, and `LIST_FILTERS` never contains `READY_FOR_PUBLICATION_FILTER`. A case-list GET with `?filter=readyForPublication` sends `filter: "all"` to the API for every role. `READY_FOR_PUBLICATION_FILTER` is imported only under `libs/deed-poll/src/gazette/`, asserted by a source scan in the style of `src/app.test.ts`.
- [x] Privacy keeps `{ isAdmin }` (Decision 4). The note and witness delete policies take `DELETE_NOTE` and `DELETE_WITNESS`. Shared-query `canPublish` and the `shared` field take `MANAGE_SHARED_QUERIES`.
- [x] Replace `express-doubles.ts`'s `admin` flag with a role list, or with `teamLeader`/`deliveryManager` flags, and update its callers. Do not keep an `admin` alias that hides which role a test means.
- [x] Tests: an anonymous visitor to a Gazette URL is redirected to login. Team leader, legacy admin, caseworker and judge are refused every Gazette GET **and** the POSTs to `settings` and `batch`, without calling the API. A Delivery Manager reaches them. Team leader and Delivery Manager each keep privacy, note and witness deletion and publishing.
- [x] Mark completed

### Task 4: Mock API, personas and seed data

**Files:** `libs/deed-poll-api-client/src/mock/server.ts` (+ its tests), `src/auth/persona-switcher.ts`
(+ test), `src/auth/persona-users.ts` (+ test), `src/deployment-chart.test.ts` if it names personas,
`libs/deed-poll-api-client/src/seed/accounts.ts`, `scripts/seed-idam-users.mjs`, `scripts/seed-local-cases.mjs`.

- [x] In the mock, replace the three literal `"caseworker-deedpoll-admin"` checks with one helper that admits only `caseworker-deedpoll-delivery-manager`, as a single local constant. The client cannot import `@hmcts/deed-poll`, because that package depends on this one. Pin the constant to the domain's `DEEDPOLL_DELIVERY_MANAGER` with a test that lives in `libs/deed-poll`. Add the same check to the `readyForPublication` filter, answering 403, to match API PR #100. Keep the mock-only userinfo resolution.
- [x] Personas: replace `admin` ("Caseworker with admin") with `team-leader` ("Team leader") and add `delivery-manager` ("Delivery Manager"), each holding its single new role. Keep caseworker and judge. Persona count goes from 3 to 4. Update the docblocks that say "three personas".
- [x] Seed: `seed-idam-users.mjs` creates `team-leader@example.com` and `delivery-manager@example.com` and keeps `admin@example.com` as the **legacy negative fixture**, with a comment saying so. `seed-local-cases.mjs` reads Gazette as the Delivery Manager, and does ordinary privileged writes as the Team leader. `seed/accounts.ts` maps the new personas.
- [x] Tests: the mock allows and denies each Gazette route and the ready filter for every matrix row; persona definitions and switching; a missing IDAM role is still reported as it is today.
- [x] Mark completed

### Task 5: Browser journeys

**Files:** `e2e-tests/tests/idam-session.ts`, `e2e-tests/tests/auth.setup.ts`, `e2e-tests/tests/gazette.spec.ts`,
`e2e-tests/tests/persona-switcher.spec.ts`, and any of `deed-polls.spec.ts`, `confirmation.spec.ts`,
`emails.spec.ts` or `judicial.spec.ts` that use the admin fixture. Also both Playwright configs.

- [ ] Prerequisites first: local IDAM on 5556 with the Task 4 users seeded, Redis on 6316, and a Playwright chromium build. **If any is missing, write the specs, prove that they parse with `yarn workspace e2e-tests exec playwright test --list` (once for each config), record "NOT RUN: <reason>" in Execution notes, and complete the task.** Do not fake a pass, and do not download browsers through the proxy.
- [ ] Add Team leader and Delivery Manager storage states through real IDAM login. Keep the caseworker and judicial ones. Keep the legacy `admin` state for negative checks only. Never copy one persona's cookie into another persona's fixture.
- [ ] `gazette.spec.ts`: all five journeys run as the Delivery Manager. Add a refusal journey: the Team leader, legacy admin, caseworker and judge each see no Gazette link and get the 404 view on a direct Gazette URL, and the Team leader opening `/deed-polls?filter=readyForPublication` sees "All applications", not the ready list.
- [ ] Prove that Team leader and Delivery Manager each keep one representative control each for privacy, note deletion and shared-query publishing, and that neither reaches `/judicial`. Keep the inline axe checks.
- [ ] Run `yarn test:gazette`, and the affected `yarn test:e2e` specs, by the worktree method in Validation Commands. Record the counts.
- [ ] Mark completed

### Task 6: Acceptance, documentation and handoff

**Files:** `README.md`, `CLAUDE.md`, `docs/plans/16-gazette-1-ready-list-review-and-send.md`,
`docs/plans/16c-gazette-mandatory-review-and-send.md`, and this plan's Execution notes.

- [ ] Run the Validation Commands, `yarn welsh:check` and the Task 5 browser suites. Record the counts against Task 1's baselines. The Welsh count may move only by keys this plan added.
- [ ] Re-scan for `DEEDPOLL_ADMIN`, `isAdmin` and `caseworker-deedpoll-admin`. Each remaining hit must be legacy compatibility, a negative test, or privacy's `isAdmin` (Decision 4). No Gazette code may read `isAdmin`.
- [ ] Update CLAUDE.md's Gazette and "Personas and role gating" sections and README's persona list with the new names and matrix. Add the superseded note to 16c, as plan 16 already has. Leave completed plans unchanged.
- [ ] Record in Execution notes: the branch SHA, whether the spec refresh was taken or deferred, the API deployment dependency, fresh-login handling and the IDAM prerequisites for the infra plan. Do not claim live verification from mock or browser tests.
- [ ] Mark completed

## Execution notes

### Task 1 — 12 October 2026

Isolated branch `feat/team-leader-delivery-manager`, base `f043767`, initially clean.
API #100 merged at `be3291a`; fresh OpenAPI publication passed. Full artifact refreshed:
51 operations, 36 paths, 55 schemas, ten description changes only; provenance recorded.
Baseline lint, all eight test tasks and all eight build tasks passed. Welsh baseline:
675 strings, 474 identical (467 prose, 7 not prose), expected exit 1.
Sandbox initially refused HTTP listeners; test suite passed outside it. Gradle needed
its writable cache and the ARM `-XX:UseSVE=0` setting. No external service calls.
Role inventory covers existing auth/session, privacy, delete/shared-query controls,
Gazette mounts/counts, mocks, seed tooling, personas and browser fixtures; no additional
production permission surface was found. The old contract-drift warning is superseded:
the current Admin baseline already contains the full Gazette contract.


## Post-Completion

These are manual, not ralphex tasks.

- Deploy only once API enforcement from PR #100 is serving on every instance, and both IDAM roles and their CCD
  reader mappings exist in the target environment. AAT personas are created on demand from `roleNames`, so the
  Team leader and Delivery Manager personas fail to create until IDAM registers the roles.
- A new role assignment needs a fresh login, because a refresh does not update stored roles. Use the infra
  runbook to invalidate the affected sessions. Do not flush shared Redis, or rotate OAuth or session secrets,
  just to rename roles.
- Legacy-only accounts keep Team leader rights and lose Gazette as soon as this deploys. Only explicitly
  assigned Delivery Managers regain Gazette. Remove the legacy role, its compatibility code and its tests in a
  coordinated follow-up, once the infra retirement criteria are met.

### Task 2 — execution evidence, 12 October 2026

Capabilities are an immutable derived list, with explicit new and temporary legacy grants.
Session reads normalise stored roles and discard stale booleans without modifying Redis state.
Permission matrix, malformed/legacy sessions and mixed judicial landings are covered.
Lint, all eight test tasks and all eight build tasks passed; diff check clean.
Task 1's first contract check rejected the old admin-description assertion; corrected it to
Delivery Manager and the complete suite passed here. Baseline: 3,725 passed, three skipped.

### Task 3 — execution evidence, 12 October 2026

Gazette mount/counts require ACCESS_GAZETTE; delete and shared-query controls use their own
capabilities. Fixtures now name Team leader/Delivery Manager explicitly. Tests cover every
Gazette page/form refusal, mount ordering/recursive coverage, independent count degradation,
and all roles' bookmarked ready-filter fallback. Lint, eight test tasks, eight builds and
diff check passed. The ready-filter source-import guard is included in final acceptance.

### Task 4 — execution evidence, 12 October 2026

Four switcher personas each carry their own role. The old admin is a seed-only negative fixture.
Mock settings, history, preview, admission, requests, membership and ready counts enforce the
same role matrix as API, with mixed-role tests. A domain test pins mock role spelling without
a dependency cycle. Existing seed account journals retain their `admin` key/subject IDs while
the seeder assigns Team leader, avoiding duplicate users when resuming. The mock-only Gazette
seeder reads as Delivery Manager. Lint, eight test tasks, eight builds and diff check passed.
