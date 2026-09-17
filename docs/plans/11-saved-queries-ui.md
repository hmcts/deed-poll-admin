# Plan 11: saved and shared queries — the caseworker's side

## Read this section before running anything

**Written provisionally, and now reconciled.** Written 2026-09-17 on Steve's instruction to get the UI
thinking on paper ahead of the api work, with every contract claim flagged rather than assumed. **api's side
has since run and merged, and this plan has been corrected against the document it actually publishes**
(reconciled 2026-09-17 against api commit `3b2579a`). The gate below is met; the corrections are recorded
here rather than silently applied, because a plan that quietly changed its mind teaches nothing.

`deed-poll-api`'s `docs/plans/saved-queries-and-search.md` describes seven `/caseworker/saved-queries*`
operations. **That plan has now run and merged** — `hmcts/deed-poll-api#16`, 2026-09-17 — and admin's copy of
the spec has been refreshed from it. Everything this plan needs exists:

| What this plan needs | In the spec today |
|---|---|
| 7 `/caseworker/saved-queries*` operations | **present** — 13 caseworker paths, 25 operations |
| A per-query editability flag | **present**, and named **`editable`** — not `canEdit`. See below |
| `CreateSavedQueryRequest` / `UpdateSavedQueryRequest` field lists | **present** — 8 properties each, `name` required on create |

**The flag is `editable`, not `canEdit`.** api added it as asked, under its own name, and
[`SavedQueryResponse`](../../libs/deed-poll-api-client/openapi.json) publishes `editable: boolean` beside
`selected: boolean`. **Use `editable` everywhere.** This repo does not rename at the boundary — the wire is
camelCase and a field named differently here would be a divergence to fix, not a style choice (`CLAUDE.md`,
"Wire Fields"). The name `canEdit` survives in this document only where it records the original ask.

`editable` is computed server-side from the same predicate that enforces the rule
(`SavedQueryPermissions.editableBy`), so what a client is told and what it is permitted cannot drift — which
is a stronger guarantee than the `isOwner` alternative this plan offered as an option.

**Why it cannot merely be run early and corrected.** `libs/deed-poll-api-client/src/api/contract.test.ts`
asserts **exact set equality** twice: `Object.keys(WIRE_SCHEMAS)` against the spec's
`components.schemas` names (line 58), and `IMPLEMENTED_OPERATIONS` against every `METHOD path` in
`spec.paths` (line 73). Adding one saved-query operation to the client therefore fails at least three tests
— the schema-set equality, the operation-set equality, and the strictness pin at line 120 — **from task 1
onward**. That is precisely the failure mode
[`10-case-query-fixes.md`](completed/10-case-query-fixes.md) and this repo's history warn about: a
validation gate that starts red cannot tell a break from a pre-existing failure, so every subsequent task
reports the same red and the run teaches nothing.

**The gate, all three steps done:**

1. ~~Run api's `saved-queries-and-search.md`~~ — **done**, `hmcts/deed-poll-api#16`, all seven tasks.
2. ~~Refresh `libs/deed-poll-api-client/openapi.json`~~ — **done**, from api commit `3b2579a`; provenance table
   updated. 19 → 26 operations, 16 → 19 schemas, no removals and no renames.
3. ~~Re-read this plan against the refreshed spec and correct it~~ — **done**, and the corrections are the
   `editable` rename plus the two unanticipated behaviours in the section below. Task 0 still runs, as a check
   rather than a discovery.

**Two api defects were found and fixed during the refresh**, both of which would have broken this plan:

- **The two request bodies published as `{}`.** `CreateSavedQueryRequest` and `UpdateSavedQueryRequest` are
  keyed maps, so springdoc reflected no fields; `OpenAPIWriteBodies` had not been extended. `contract.test.ts`
  would have matched empty schemas and a client would have been built blind to the fields it must send. Fixed
  in `hmcts/deed-poll-api#17`, with a classpath-scanning guard so a future keyed body cannot ship empty.
- **The `sort` parameter's field list was non-deterministic.** api held four audit columns in a `Set.of`, whose
  iteration order Java randomises per JVM, so every spec refresh would show a spurious diff in those names.
  Fixed in `hmcts/deed-poll-api#18`.

**Statements about api paths, parameters and response fields are now checked rather than provisional.** Two
**[PROVISIONAL]** markers deliberately remain, and neither is about api's contract: the mock's `editable: true`
(a limitation of the mock, recorded at the mock) and the operation table in task 1. Where the spec and this
plan disagree, **the spec still wins and this plan is still wrong** — that rule does not expire.

## Overview

Plan 10 made the query builder usable. A caseworker can now build a filter worth keeping — and has nowhere
to keep it. This plan adds that: name a query, optionally publish it so colleagues can find it, choose which
found queries appear in your own navigation.

The persistence is entirely api's. **This repo owns no database and never will** — its only local state is
Redis sessions, which are transport state, and a shared query is definitively not session state because one
user's write is another user's read. So this plan adds no storage, only a presentation layer over seven api
operations.

Scope decided with Steve 2026-09-17: **saved queries only.** The case search (`q`, the `referenceMatch`
redirect, and `newSurname` in the list table) is plan 12. api treats them as one journey; splitting them
here keeps this plan at eight tasks and lets it merge without waiting on a table-column change.

### What plan 10 left ready, and what it did not

Verified on branch `case-query-fixes`, not assumed. Plan 10's decision 8 said to build the nav to hold two
groups before the second one existed. **It half-did**, and the distinction matters:

- **Built:** the markup scaffold. `src/pages/deed-polls/index.njk:27-43` — a `<nav class="app-filter-nav">`
  containing one `<div class="app-filter-nav__group">` with an `<h2 class="app-filter-nav__group-label">`,
  and `_filter-nav.scss:22` carries an `.app-filter-nav__group + .app-filter-nav__group` margin rule that
  today applies to nothing.
- **Not built:** any group *data*. The handler passes a **flat** `filters` array
  (`index.ts:205`, each entry `{ key, label, href }`) and a **scalar** `filterGroupLabel` (`index.ts:59`,
  `"Status"`). The group is hard-coded once in the template.
- **A label that stops being true.** The `<nav aria-label>` is `filterLabel` = `"Filter by status"`
  (`index.ts:56`). Saved queries in that nav are not statuses.

## Decisions taken — implement these, do not revisit

1. **Ownership is api's, and this repo holds no user id.** Service functions send `{ accessToken }` and
   nothing else; api derives the owner from the token's subject, exactly as it already derives the audit
   author and the admin flag. The UI renders **flags api returns per query** and never computes
   permission locally. Chosen by Steve 2026-09-17 over two alternatives, both rejected on the same
   ground: `CurrentUser` is `{ roles, isAdmin, name }` (`libs/deed-poll/src/auth/current-user.ts:24-28`)
   with **no id**, and the IDAM `sub` that is in the session is documented at `src/auth/session.ts:20-27` as
   deliberately *not* what authorization is decided from. A UI that compared a
   local id to an `ownerId` could disagree with api about who owns a query — two sources of truth for one
   fact. **Do not add `subject` to `CurrentUser`, and do not add an `ownerFromRequest`.**
2. **`name` is audit text, never an identifier.** `userFromRequest(req).name` is displayable and is neither
   stable nor unique: `displayNameFrom` (`libs/deed-poll/src/auth/idam-claims.ts:68`) falls back to `sub`
   and then to the literal `SERVICE_ACCOUNT_NAME` = `"# svc_HMCTS_LCPT_Dev"`
   (`libs/deed-poll/src/auth/current-user.ts:9`), and that file's docblock at lines 20-22 says *"`name` is
   only ever used as audit text (createdBy / modifiedBy), never for authorisation"*. Render `ownerName` as
   api sends it; never key on it.
3. **The permission flags are api's to state and this plan asks for them.** The UI shows an edit or delete
   control when api says the caller may, not when it infers they may. See "What this plan asks of api" —
   this is an addition to api's plan, not something to fake here.
4. **The nav generalises to `filterGroups`, and the nav's label changes.** Replace the flat `filters` plus
   scalar `filterGroupLabel` with `filterGroups: { label: string; entries: NavEntry[] }[]`, one data shape
   for every group, so a third group later is free. The `<nav aria-label>` becomes wording true of both
   groups — *"Filter cases"* — because "Filter by status" describing a bar of saved queries is a lie to a
   screen-reader user. Chosen by Steve 2026-09-17 over a second hard-coded group.
5. **Deleting a shared query goes through a confirmation page, and it states uncertainty rather than a
   count.** Wording along the lines of *"Other people may have this query in their list."* api exposes no
   subscriber count and this plan does not ask for one — a number would be a second api change for a
   sentence. Chosen by Steve 2026-09-17. **This is a new pattern in this repo, not an existing one** — see
   the correction below.
6. **A saved query is a live reference, not a copy** — api's decision 1, restated here because the UI must
   not undermine it. Subscribers see the owner's edits. **Do not add a "copy to my own" button as a
   convenience**; duplication is deliberate (open the query, save it under a new name), and a
   one-click copy turns one shared query into nine diverging ones inside a month.
7. **Applying a saved query navigates to the list URL it describes; it does not become a mode.** A saved
   query *is* a URL — that is what decision 1 of the original query plan bought. Selecting one from the nav
   is a link to `/deed-polls?filter=…&where=…&sort=…`, so the back button, bookmarking and Slack-pasting all
   keep working, and the builder below shows the conditions ready to amend.
8. **Page is never stored and never restored.** api's decision 5. `caseListSearch` already omits `page` when
   it is `<= 1` (`case-query.ts:143-146`); a saved query simply never carries one.
9. **Saving is a separate page, not a control in the builder.** The list page's handler is already a single
   `GET` doing two jobs (canonical render, and builder-submission redirect). A name-and-description form
   inside it would make a third. New pages under `src/pages/deed-polls/queries/` keep the list page's shape.
10. **No JavaScript is required by anything here.** Plan 10 established JS as enhancement over a working
    round trip; nothing in this plan needs it at all. Do not add any.

### A correction to what I told Steve when this was decided

**I said the existing witness and note deletes were the precedent for a confirmation page. They are not —
there is no interstitial anywhere in this repo.** Both deletes are a warning-styled button submitting
`action=delete` from the edit form (`src/pages/deed-polls/witness-edit.njk:79-81`,
`note-edit.njk:64`), rendered only when `canDelete` is true, and they delete immediately. Decision 5 still
stands on its own merits — a shared query others rely on has a wider blast radius than a note — but it is
**new work with no local pattern to copy**, and the task must be read that way rather than as "do what
witnesses do".

## What this plan asked of api — asked, and delivered

**This was the highest-value thing in this document when it was written, and it worked.** api's plan stated
the permission rules in prose — decision 2: *"Only the owner may edit or delete a query — and an administrator
may edit or delete any shared one"* — but described its `GET /caseworker/saved-queries` response only as
*"shared queries plus their own, each flagged with whether it is selected"*. **Selected, not editable.** The
UI would have had to infer editability from `ownerId` against a local user id, which decision 1 forbids and
this repo cannot do.

**api added the flag before its plan ran.** `SavedQueryResponse` now carries `editable: boolean`, derived
server-side from `SavedQueryPermissions.editableBy` — the same predicate the write paths use to refuse — so
what a client is told and what it is permitted cannot drift.

**Nothing in this plan is provisional on that any more.** Every task below reads `editable` as a fact api
states. Do not write a local policy function, do not compare owner ids, and do not treat the flag as advisory:
a client that renders an edit button on its own reasoning is a second authority on a rule api enforces.

### Two things api shipped that this plan did not anticipate

Both are api's own decisions, discovered when the spec was refreshed, and both are *narrower* than what this
plan assumed:

1. **A query the caller cannot see is `404`, not `403`** — identical to an id that never existed, so no id is
   discoverable by watching status codes. That includes an administrator naming somebody else's *unshared*
   query: the admin override reaches shared queries only. So a page handling a saved query must treat 404 as
   "gone or never yours" and must not distinguish the two in what it renders.
2. **`DELETE .../selection` answers `204` even for a query the caller cannot see.** Deliberate asymmetry with
   `PUT`, which 404s: the selection row is keyed by the caller, so the delete cannot reach anybody else's, and
   requiring visibility would trap a subscriber holding a stale selection for a query its owner has since
   unshared — the one selection they most need to clear and the one they can no longer see. **Do not add a
   visibility pre-check before unselecting.**

## Open questions — flagged, NOT answered here

- **Ordering within a caseworker's selection.** api v1 orders by name (its own open question). Fine for a
  handful; wrong once someone has fifteen. Needs a position column and a reorder operation on api's side, so
  it cannot be solved here.
- **What happens to a selected query whose owner deletes it.** api permits the deletion; nothing says what a
  subscriber then sees. Probably it silently disappears from their nav, which is defensible and worth
  *knowing* is the behaviour rather than discovering. Confirm against api once built.
- **Welsh.** New strings follow the page's existing pattern — inline English in the handler's `en`/`cy`
  content objects, `cy = { ...en }` (`index.ts:123`). Consistent, still not right, still page-wide work.
  `yarn welsh:check` exists; do not let this plan make its output worse.
- **A "modified — save or reset?" indicator** when a caseworker departs from a saved query's conditions.
  Plan 10 deliberately deferred this. Still deferred: build saved queries first and see whether anyone misses
  it.
- **Whether the library needs search or paging.** Not until there are enough saved queries to need it, and
  there is no way to know that before the feature exists.

## Constraints

- **No `prisma.*`, no migration, no database.** There is none in this repo. Every read and write goes to api
  over HTTP through `libs/deed-poll-api-client`.
- **`Caller` is `{ accessToken }` and nothing else** (`libs/deed-poll/src/api/deed-poll-api.ts:51`), and a
  page obtains one from `callerFromRequest(req)` (`src/auth/current-user.ts:35`).
- **A page may not call the api client directly.** `callApi` is deliberately absent from
  `libs/deed-poll/src/index.ts`'s public surface — see the comment at lines 9-14. Service functions live
  **inside `libs/deed-poll/src/`** and pages call those.
- **The adapter never throws.** It returns `ApiResult<T>`; `callApi` maps a failed result to the domain
  errors `src/errors.ts` already renders. **No request or response logging at all** —
  `client.ts:8-14` states the no-PII rule has no debugging exception.
- **The `where` wire format lives in `libs/deed-poll/src/deed-poll/case-query.ts`, NOT in
  `query-builder.ts`.** `serialiseConditions` (line 101), `parseConditions` (93), `caseListSearch` (137),
  `caseQueryWhere` (112, complete conditions only). `query-builder.ts` owns the per-round-trip *form
  controls* (`field-0`, `op-0`, `value-0-0`) and says at lines 14-17 that these are transport, not a
  persisted form. **A saved query stores what `serialiseConditions` produces.** This is stated because I got
  it wrong once already and a wrong path here gets faithfully implemented.
- **Never run bare `yarn test`.** It fans 8 packages across 14 CPUs and the workers do not start:
  `Tasks: 0 successful, 8 total`, `Tests no tests`. Use `yarn turbo test test:app --concurrency=1`. **And
  do not treat `0 successful, 8 total` as proof that nothing ran** — it has also meant a real
  first-workspace failure stopping the other seven. Read the per-workspace output.
- **A worker-startup timeout is an environment failure, not a code failure.** `Failed to start forks
  worker` / `Timeout waiting for worker to respond` — **re-run before investigating.** It is a filesystem
  resource race and it is flaky, not deterministic.
- **`yarn lint` is a single `biome check .`** It exits 0 today with two pre-existing `noUndeclaredEnvVars`
  warnings and a stale `biome.json` schema notice. Do not let the count grow.
- **Do not touch `charts/`, and do not add a `values.template.yaml`.** Nothing here is a deployment change.
- **`src/deployment-chart.test.ts` and `src/pipeline.test.ts` must stay green.** Neither should be affected;
  if either breaks, something outside this plan's scope was changed.
- **Do not delete any of the six pipeline scripts** — `lint`, `test`, `test:coverage`, `test:a11y`,
  `test:smoke`, `test:functional`. The Jenkins stage fails on a missing one and `src/pipeline.test.ts`
  pins it.
- **`libs/deed-poll` and `src/` tests stub the client rather than driving the mock.** They
  `vi.mock("@hmcts/deed-poll-api-client")` or `vi.mock("@hmcts/deed-poll")`. Only the api-client package's
  own `client.test.ts` and `mock/server.test.ts` start the in-memory mock in process.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

**The baseline is measured, not estimated.** Taken 2026-09-17 from a `/tmp` copy of this plan's branch point
(`d430d50`, the tip of `case-query-fixes`), all three commands green:

| Package | Tests |
|---|---|
| `//` (the app) | 488 |
| `@hmcts/deed-poll` | 684 |
| `@hmcts/deed-poll-api-client` | 192 |
| `@hmcts-cft/cloud-native-platform` | 140 |
| `@hmcts-cft/express-govuk-starter` | 127 |
| `@hmcts-cft/simple-router` | 41 |
| `@hmcts-cft/express-session-postgres` | 23 |
| `@hmcts-cft/express-session-redis` | 7 |
| **Total** | **1,702**, 8 of 8 tasks successful, 0 failures, 0 worker errors |

`yarn lint` exits 0 with exactly two `noUndeclaredEnvVars` warnings (`src/session-store.test.ts:32` and one
other) plus two infos — that is the documented pre-existing state, not a regression. `yarn build` 8 of 8.
The whole suite ran in **33s** and the build in **13s** from `/tmp`.

Compare **totals** against 1,702, and expect the count to rise monotonically. If a total *falls*, stop — a
test was lost, not replaced.

**Run these from a `/tmp` copy, not in the clone.** Measured 2026-09-16: the same `yarn build` took 19m26s
in the working tree and 13.8s in a `git archive HEAD` copy under `/tmp`. Use
`git archive HEAD | (mkdir -p /tmp/dpa-verify && tar -x -C /tmp/dpa-verify)`, then `yarn install` and run
there. This is the difference between a validation pass and a command that looks hung.

**For driving the app by hand while working:**

```bash
yarn mock:api          # in-memory api on :3200 — starts with NO cases
yarn mock:seed         # 32 cases across all five filter tabs
yarn idam:users        # admin@example.com / Pa55word11, in-memory, gone on restart
yarn dev:nowatch:web   # :3000 — prefer this over `yarn dev`; `turbo watch` stalls on this filesystem
```

Note `yarn mock:seed`, **not** `yarn seed:cases` — `scripts/seed-local-cases.mjs`'s own docblock names a
script that does not exist. Do not propagate it.

## Tasks

### Task 0: Reconcile this plan against the refreshed spec — RUN THIS FIRST, ALONE

**Do not proceed past this task if it finds a divergence. Report and stop.**

Read `libs/deed-poll-api-client/openapi.json` and confirm it carries the saved-query surface. Check, and
write the answer into the task log:

- Which `/caseworker/saved-queries*` paths exist, with their exact methods and paths.
- The exact name of each new schema in `components.schemas`, and each one's properties.
- **That `SavedQueryResponse` carries `editable: boolean`.** If it does not, **stop and report** — decisions 1
  and 3 depend on it and no local workaround is permitted. It was `editable` when this plan was reconciled
  against api commit `3b2579a`; the flag is **not** called `canEdit`, which is the name this plan originally
  asked for.
- Whether the selection sub-resource is `PUT`/`DELETE` on `…/{id}/selection` as api's plan describes.
- Read the `where` and `sort` parameter *descriptions*, per `SPEC-PROVENANCE.md`'s fourth note: the operator
  vocabulary arrives only as prose and nothing pins it.

Then **correct every **[PROVISIONAL]** marker in this document** to match, and delete the marker. A task
below that names a field the spec does not have is a task that must be rewritten before it is run, not
worked around.

If the spec has no saved-query operations at all, the gate at the top of this plan has not been met: stop.

- [ ] Spec confirmed to carry the saved-query surface; every path, schema name and property recorded in the
      task log; `editable` confirmed present on `SavedQueryResponse`; the two request bodies confirmed to
      publish their eight properties rather than an empty schema; every **[PROVISIONAL]** marker in this plan
      either corrected or the run stopped with a report

### Task 1: The wire schemas and the adapter operations

`libs/deed-poll-api-client/src/api/wire.ts`, then `client.ts`, then `contract.test.ts`.

Follow the file's existing pattern exactly (it is uniform, so there is no judgement to exercise):

1. A **module-private** `const savedQuerySchema = z.object({...})` beside the others. Response properties
   are `.nullish()` by default — springdoc emits no nullability for a response body — except properties
   that are Java primitives at source.
2. Add each new schema to `WIRE_SCHEMAS` (line 410), **keyed by the exact spec `components.schemas` name**.
3. Add response schemas to `STRICT_RESPONSE_PROPERTIES` (line 454), and add any **request** schema to the
   hard-coded `requests` array in `contract.test.ts:123` — the test at line 120 fails otherwise.
4. `export type WireSavedQuery = z.infer<typeof savedQuerySchema>` with the others (479-492).

Then the operations in `client.ts`. Copy the shape of `listCases` (line 97) for the read and `createNote`
(165) / `patchNote` (177) / `deleteNote` (187) for the writes. Nothing new is invented: `request(...)` for
anything with a body to parse, `requestNoContent(...)` for a `DELETE` or an idempotent `PUT` that returns
none. Seven operations, **each verified against the refreshed spec** — every method and path below is exactly
as `openapi.json` carries it:

| Function | Method and path |
|---|---|
| `listSavedQueries` | `GET /caseworker/saved-queries` |
| `createSavedQuery` | `POST /caseworker/saved-queries` |
| `getSavedQuery` | `GET /caseworker/saved-queries/{id}` |
| `patchSavedQuery` | `PATCH /caseworker/saved-queries/{id}` |
| `deleteSavedQuery` | `DELETE /caseworker/saved-queries/{id}` |
| `selectSavedQuery` | `PUT /caseworker/saved-queries/{id}/selection` |
| `deselectSavedQuery` | `DELETE /caseworker/saved-queries/{id}/selection` |

`encodeURIComponent` every path segment, as `notePath` does. Add all seven to `IMPLEMENTED_OPERATIONS`
(`contract.test.ts:35`) — the list is compared for **exact equality** with the spec's paths, so it must
match to the character.

- [ ] Schemas added to `WIRE_SCHEMAS` under their exact spec names, strictness pinned, request schemas
      registered in the `requests` array; seven operations added following `listCases`/`createNote`
      verbatim in shape; all seven in `IMPLEMENTED_OPERATIONS`; `contract.test.ts` green, which is the
      proof the adapter and the spec agree

### Task 2: The in-memory mock

`libs/deed-poll-api-client/src/mock/server.ts`. The unit suites and `yarn dev` both drive this, so an
operation the mock does not answer cannot be developed against.

Routing is a single `handle(req, res)` (line 130) of `if (method === "X" && pathname === "/y")` guards, in a
deliberate order. Add the saved-query routes **after** the reachability gate at line 174 — they are contract
routes, not `__mock` control routes — and put the **literal** `/caseworker/saved-queries` collection path
**before** any `{id}` regex, for the reason recorded at lines 178-179.

State goes beside `const cases = new Map(...)` (line 118) as a `Map` of saved queries, plus a set of
selected ids. Validate every body with `WIRE_SCHEMAS.X.safeParse(await readJsonBody(req))` and turn a
failure into `send(res, 400, fieldErrorsFrom(parsed.error.issues))`. Unknown method on a known path is
**405**; unknown path **404**.

**The mock cannot model the permission rules, and must not pretend to.** `auditName(req)` (line 630) decodes
the bearer token's `sub` without verifying it and there is no role in it — the mock comments at lines
400-403 say a 403 is not a state it can produce, which is why the witness delete's Administrator gate is
unmodelled. So: the mock sets `editable: true` **[PROVISIONAL]** on everything and answers every write. Put a
comment saying so, in the shape of the existing one, or someone will later read the mock as evidence that
the UI's permission handling is tested.

- [ ] Saved-query routes added after the reachability gate with the collection path before the `{id}` regex;
      state held beside `cases`; bodies validated through `WIRE_SCHEMAS` with `fieldErrorsFrom` on failure;
      405/404 as the existing routes do; a comment recording that permissions are not modelled and why

### Task 3: The domain service and its view model

New directory `libs/deed-poll/src/saved-queries/`, following `libs/deed-poll/src/notes/` exactly.

`service.ts` — thin functions, one per operation, each `callApi(caller, (config) => …)`. Copy
`notes/service.ts:34-75` in shape; there is nothing to add. Signatures take `(…, caller: Caller)` last, as
every service function does.

`view.ts` — turns wire saved queries into what the nav and the library page render. **This is where the
query's stored form becomes a URL**: use `caseListSearch({ filter, conditions, sort })` from
`case-query.ts:137`, so a saved query's link is built by the same function every other list link on the page
uses and cannot carry a different subset. `parseConditions` (`case-query.ts:93`) turns the stored `where`
strings back into `CaseCondition[]`.

Export both from `libs/deed-poll/src/index.ts` with `export *`, in alphabetical position among the existing
lines. **Do not export `callApi`** — see the comment at lines 9-14.

Types live in the file that uses them, per the repo's conventions; no `types.ts`.

- [ ] `libs/deed-poll/src/saved-queries/service.ts` with one thin `callApi` function per operation, shaped
      like `notes/service.ts`; `view.ts` building links through `caseListSearch` and reading conditions
      through `parseConditions`; both `export *`d from the package index; colocated `*.test.ts` for each,
      stubbing `@hmcts/deed-poll-api-client` and returning `ApiResult` unions as
      `.claude/rules/testing.md` shows

### Task 4: Generalise the filter nav to groups

Decision 4. `src/pages/deed-polls/index.ts` and `index.njk`, plus the two plan-10 tests that pin the current
shape.

In the handler's `render()` (line 200): replace `filters` and `activeFilter` with a single
`filterGroups: { label: string; entries: NavEntry[] }[]`, each entry
`{ key: string; label: string; href: string; current: boolean }`. Compute `current` in the handler rather
than comparing keys in the template — a saved query's identity is not its label, and `f.key == activeFilter`
in the template only worked while every entry was a status. `filterTabs()`
(`libs/deed-poll/src/deed-poll/list-filters.ts:71`) still supplies the first group; build its hrefs with
`listHref` (`index.ts:266`) exactly as now.

In the content objects (`index.ts:53`): `filterLabel` becomes wording true of every group — *"Filter
cases"*. Keep `"Status"` as the first group's label. `cy = { ...en }` as the page already does.

In `index.njk:27-43`: loop the groups, rendering the existing `<div>`/`<h2>`/`<ul>` per group. The markup per
entry does not change — `aria-current="page"` on a `<span class="app-filter-nav__current">`,
`govuk-link--no-visited-state` on the links, no `govuk-!-` utilities.

**This task deliberately ships one group.** The second is task 5. Doing the shape change on its own keeps a
data-model refactor separate from a feature, so if a nav test breaks it is obvious which change did it.

**Two plan-10 tests will fail and both must be updated, not deleted** — `src/pages/deed-polls/index.njk.test.ts`
`describe("the filter bar")`: the group-label test at ~line 334 asserts `aria-label="Filter by status"`,
and the list test at ~line 305 asserts exactly five `<li class="app-filter-nav__item">` **within the whole
`<nav>`**, which is the assertion that will break in task 5 once a saved query renders as a sixth. Update
the label assertion here; in task 5, scope the count to the first group rather than raising the number.

- [ ] `filterGroups` replaces flat `filters` plus scalar `filterGroupLabel`; `current` computed in the
      handler not the template; `filterLabel` no longer claims "by status"; template loops groups with the
      per-entry markup unchanged; the two plan-10 nav tests updated to match with their intent intact; still
      exactly one group rendered

### Task 5: Selected queries as the nav's second group

`src/pages/deed-polls/index.ts`, reading through task 3's service.

The list handler fetches the caller's selected saved queries and appends a second group — label something
like *"Saved queries"* — whose entries link to each query's list URL from `view.ts`. An entry is `current`
when the request's own filter, conditions and sort match that query's. Compare the **serialised** forms
(`serialiseConditions`, `serialiseSort`), not object identity.

**A failure to load saved queries must not break the case list.** The list is the page's job; the nav is
navigation. `callApi` throws a domain error on failure, so catch it here and render the first group alone —
a caseworker whose saved queries are briefly unavailable still gets their cases. This is the same reasoning
as the adapter never throwing: an unreachable api is a state a page renders.

With no selected queries, render **no second group** — an empty labelled group is a heading over nothing.

Now scope the five-item count in `index.njk.test.ts` to the first group, per task 4's note.

- [ ] Second group rendered from the caller's selected queries, entries linking to each query's list URL;
      `current` decided on serialised filter/conditions/sort; a saved-query load failure degrades to the
      status group alone with the case list intact and a test covering it; no group rendered when the
      selection is empty; the five-item assertion scoped to the first group rather than renumbered

### Task 6: Save a query, and the library

New pages under `src/pages/deed-polls/queries/`, per decision 9. `simple-router` maps the file path to the
URL (`libs/simple-router/src/route-discovery.ts:44-52`), so `queries/index.ts` is `/deed-polls/queries` and
`queries/new.ts` is `/deed-polls/queries/new`.

- **`new.ts` + a template** — name (required, bounded), description (optional), and a "publish to the
  library" checkbox. It arrives carrying the current query in its URL, so the form posts the name plus the
  serialised query it was opened with. Validate with zod as the other forms do, render errors through
  `govukErrorSummary` with anchors to the controls, and on success redirect to the list with the new query
  selected. **api bounds name and description too** (its decision 14); the UI's limits must not exceed the
  spec's.
- **`index.ts` + a template** — the library: shared queries plus the caller's own, each showing name,
  description, `ownerName` (decision 2 — display only), whether it is in the caller's list, and a control to
  add or remove it. Add/remove are `PUT`/`DELETE` on the selection sub-resource and are idempotent, so a
  double-submit is harmless.
- **Edit and delete**, shown only when api says `editable` **[PROVISIONAL]** (decision 3). Follow the
  existing shape for *rendering* a permissioned control — a named `canX` value passed into the template and
  `{% if %}`'d, hidden rather than disabled (`witness-edit.njk:79`, and the comment there on why a disabled
  button has no value to read). **Unlike witnesses, the flag comes from api, not from a local policy
  function** — do not add a `delete-policy.ts` here, because there is no local decision to make.

Every page needs `callerFromRequest(req)` (`src/auth/current-user.ts:35`).

- [ ] `queries/new.ts` saving a named query from the query it was opened with, validated, errors summarised
      and anchored; `queries/index.ts` listing shared plus own with idempotent add/remove; edit and delete
      rendered on api's `editable` and hidden not disabled; no local policy function; colocated tests for
      each page asserting the render model

### Task 7: The delete confirmation

Decision 5, and **read the correction above: there is no interstitial in this repo to copy.** This is new.

Deleting a **shared** query goes to a confirmation page stating that other people may have it in their list,
with a warning-styled confirm and a cancel that returns without acting. Deleting an **unshared** query needs
no interstitial — nobody else can see it, so there is nothing to warn about.

Wording states uncertainty. **Do not write a number**: api exposes no subscriber count, and *"3 people"*
would be invented.

- [ ] Confirmation page for a shared query's delete, warning-styled confirm and a cancel that acts on
      nothing; unshared queries delete without one; wording claims no count; tests covering both paths and
      that cancel deletes nothing

### Task 8: An e2e journey, and full validation

`e2e-tests/tests/deed-polls.spec.ts` — one happy path only, per the repo's e2e rules: build a query, save it
with a name, see it in the nav, follow it, see the conditions restored in the builder. Run the axe check the
existing specs run.

Then the full validation from a `/tmp` copy:

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
yarn test:e2e --workers=1
```

Record the unit total against the baseline taken at the branch point. **Re-run once before believing any
worker-startup failure.** Confirm `yarn welsh:check` is no worse than at the branch point.

- [ ] One e2e happy path with an axe check; lint exit 0 with no new warnings; unit total up from the
      recorded baseline with no suite lost; build green; e2e green; `welsh:check` no worse; the measured
      numbers written into this task's log rather than estimated

## Deliberately not in this plan

- **The case search** — `q`, the `referenceMatch` redirect to a single case, and `newSurname` in the list
  table. Plan 12. `newSurname` needs api's `CaseSummary` to carry it (its decision 13).
- **Named recipients / sharing with a person.** api has no user directory — eleven paths, no whoami, no
  account schema. The library plus a pasted link delivers the outcome with no cross-team dependency.
- **A subscriber count**, and therefore a delete warning that quotes one. Decision 5.
- **Reordering a caseworker's saved queries.** Needs a position column on api's side.
- **A one-click duplicate.** Decision 6 — duplication stays deliberate.
- **A "modified — save or reset?" indicator.** Still deferred, as plan 10 deferred it.
- **Any change to `CurrentUser`, `userFromClaims`, `signIn` or `src/express-doubles.ts`.** Decision 1 means
  no user id is needed here, which is the whole reason that option was chosen.
- **Welsh translation of the new strings.** Page-wide work, unchanged.
- **`@ministryofjustice/frontend`.** Plan 10 rejected it on the evidence; nothing here changes that.
