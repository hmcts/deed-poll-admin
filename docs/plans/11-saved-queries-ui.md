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

**Statements about api paths, parameters and response fields are now checked rather than provisional.** Task 0
has since run against the spec on disk and **no `[PROVISIONAL]` marker remains** — the findings are recorded
under task 0. The one thing task 2 must still not overclaim is the mock's `editable: true`, which is a
limitation of the mock rather than an open question about api's contract, and is now stated as such at the
mock. Where the spec and this plan disagree, **the spec still wins and this plan is still wrong** — that rule
does not expire.

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

**Re-measured after tasks 1 and 0, at commit `76ae7ac`: 1,709**, 8 of 8 tasks successful, 0 failures, 0
worker errors; the whole rise is `@hmcts/deed-poll-api-client` 192 → 199, which is task 1's seven operations.
`yarn build` 8 of 8 in 12.2s. Later tasks compare against **1,709**, not 1,702.

**Re-measured after task 2: 1,731**, 8 of 8, 0 failures; the rise is again all
`@hmcts/deed-poll-api-client`, 199 → 221. Tasks 3 onward compare against **1,731**.

**Re-measured after task 3: 1,771**, 8 of 8, 0 failures; the rise is all `@hmcts/deed-poll`, 684 → 724.
Tasks 4 onward compare against **1,771**.

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

#### Findings — run 2026-09-17 against `libs/deed-poll-api-client/openapi.json` as committed in `f08ccd2`

**No divergence. Every claim in this plan holds.** 14 paths, 26 operations; 13 of the paths and 25 of the
operations are `/caseworker/*`, exactly as the table at the top of this document says.

All seven saved-query operations are present, with the methods, paths and success statuses task 1's table
names:

| Operation | Status | Request body |
|---|---|---|
| `GET /caseworker/saved-queries` | 200 | — |
| `POST /caseworker/saved-queries` | 201 | `CreateSavedQueryRequest` |
| `GET /caseworker/saved-queries/{id}` | 200 | — |
| `PATCH /caseworker/saved-queries/{id}` | 200 | `UpdateSavedQueryRequest` |
| `DELETE /caseworker/saved-queries/{id}` | 204 | — |
| `PUT /caseworker/saved-queries/{id}/selection` | 204 | — |
| `DELETE /caseworker/saved-queries/{id}/selection` | 204 | — |

The selection sub-resource is therefore `PUT`/`DELETE` on `…/{id}/selection` as api's plan describes, and
**both answer 204 with no body** — so the adapter reaches them with `requestNoContent`, and neither returns the
query, which matters for task 6: after an add or remove, re-read or redirect, do not expect a fresh flag back.

Three new schemas, named exactly `SavedQueryResponse`, `CreateSavedQueryRequest`, `UpdateSavedQueryRequest`
(19 schemas in total, up from 16).

- **`SavedQueryResponse` — 17 properties, `required: []`.** `id`, `name`, `description`, `filter`,
  `searchTerm`, `conditions` (`string[]`), `sortField`, `sortDirection`, `shared` (boolean), `selected`
  (boolean), **`editable` (boolean — confirmed present, and it is `editable`, not `canEdit`)**, `ownerId`,
  `ownerName`, `createdBy`, `createdOn` (`date-time`), `modifiedBy`, `modifiedOn` (`date-time`). Nothing is
  required, which is springdoc's usual silence on a response body rather than a statement about nullability.
- **`CreateSavedQueryRequest` — 8 properties, `required: ["name"]`.** `name` (`maxLength: 100`,
  `minLength: 1`), `description` (`maxLength: 500`), `filter` (**enum**: `all`, `open`, `received`, `enroled`,
  `returned`), `searchTerm` (`maxLength: 100`), `conditions` (`string[]`, `maxItems: 20`), `sortField`,
  `sortDirection` (**enum**: `asc`, `desc`), `shared`. Not an empty schema — `hmcts/deed-poll-api#17` holds.
- **`UpdateSavedQueryRequest` — the same 8 properties with the same bounds, `required: []`**, so a PATCH may
  send any subset.

The bounds are the ones task 6 must not exceed: **name ≤ 100 and ≥ 1 character, description ≤ 500,
conditions ≤ 20, searchTerm ≤ 100.**

`GET /caseworker/saved-queries` **takes no parameters at all** — no filter, no paging — and returns a bare
`SavedQueryResponse[]`. So the shared/own/selected split is the client's to make from `shared`, `selected` and
`editable` on each item; there is no server-side "just my selection" call, which is worth knowing before task
5 goes looking for one. Note also that the response is published under `*/*` rather than
`application/json`, springdoc's default where no `produces` is declared; that is a documentation artefact, not
a content-type the client should send or expect.

Per `SPEC-PROVENANCE.md`'s fourth note, the vocabularies that arrive **only as prose** in a parameter
description and are pinned by nothing:

- **`where`** — `field:operator:value`, repeated per condition, ANDed with no OR, split on the first two
  colons so a colon inside a value survives. Operators: `is`, `contains`, `startsWith`, `before`, `after`,
  `gt`, `lt` (one value each), `between` (two comma-separated, low first), `isOneOf` (at least one
  comma-separated), `isEmpty`, `isNotEmpty` (no value). A bad field or a bad operator for that field's kind is
  a 400 naming **every** unreadable condition, not just the first.
- **`sort`** — `field:asc|desc`, direction optional and defaulting to ascending. The sortable field list is
  prose in the description and deliberately not enumerated in `CreateSavedQueryRequest.sortField`, api's note
  saying there are more than sixty and a frozen copy would drift. **Do not build a select of sort fields from
  the spec** — the list is not machine-readable, and `case-query.ts` is where this repo's copy of the sortable
  set already lives.
- **`q`** — plan 12's, recorded only so nobody re-derives it: exact-ish reference match (tolerant of case,
  hyphens, spaces) ORed with a case-insensitive substring over `newForename`, `newSurname`, `oldForename`,
  `oldSurname`, `parents`, `representativeName`; over 100 characters is truncated, not refused.

Proof the adapter and the spec agree, re-run as part of this task:
`cd libs/deed-poll-api-client && yarn vitest run src/api/contract.test.ts` — **57 assertions, 57 passed.**

- [x] Spec confirmed to carry the saved-query surface; every path, schema name and property recorded in the
      task log; `editable` confirmed present on `SavedQueryResponse`; the two request bodies confirmed to
      publish their eight properties rather than an empty schema; every **[PROVISIONAL]** marker in this plan
      either corrected or the run stopped with a report

### Task 1: The wire schemas and the adapter operations

**DONE BY HAND before the run, commit `18ba54a` — do not redo it.** The gate had to be green before task 2
could mean anything: `contract.test.ts` asserts exact set equality against the spec, so the refreshed document
made two assertions fail, and they were red *for this task*. A run starting here would have had every task
reporting a red gate it did not cause. Two corrections worth knowing, both of which the contract test caught:
`filter` and `sortDirection` are **enums** in the spec, not plain strings, and are now `LIST_FILTER` and
`SORT_DIRECTION` exported beside the other published vocabularies. Verify with
`cd libs/deed-poll-api-client && yarn vitest run src/api/contract.test.ts` — 57 assertions, all green.

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

- [x] Schemas added to `WIRE_SCHEMAS` under their exact spec names, strictness pinned, request schemas
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
unmodelled. So: the mock sets `editable: true` on everything and answers every write — a deliberate
divergence from api, which computes the flag from `SavedQueryPermissions.editableBy`. Put a
comment saying so, in the shape of the existing one, or someone will later read the mock as evidence that
the UI's permission handling is tested.

- [x] Saved-query routes added after the reachability gate with the collection path before the `{id}` regex;
      state held beside `cases`; bodies validated through `WIRE_SCHEMAS` with `fieldErrorsFrom` on failure;
      405/404 as the existing routes do; a comment recording that permissions are not modelled and why

#### What was built, and the two things it deliberately does not do

Routes added immediately after the reachability gate, so the whole surface 503s under `api-unavailable`
alongside the case routes — asserted, because a saved-query route reachable during a modelled outage would
make the nav's degradation path (task 5) untestable. State is a `Map` of queries plus a `Set` of selected
ids beside `cases`, and `reset()` clears both: without that, `POST /__mock/reset` would leave a library
behind and any assertion on its length would depend on what ran before it.

Two divergences from api, both commented at the code and worth knowing before tasks 5-7 read the mock as
evidence of anything:

- **`editable` is the constant `true` and every write is answered.** api computes the flag from
  `SavedQueryPermissions.editableBy`; `auditName` decodes an unverified token for a `sub` and there is no
  role in it, so a 403 is not a state this mock can produce — the same reason the witness delete's
  Administrator gate is unmodelled. Task 6 must therefore give the flag **both** values in its page tests;
  driving the mock will only ever show it the true branch.
- **Selection is one `Set`, not per-caller.** api keys the row by the caller's subject, so two people can
  select one shared query independently. A per-subject map would look like it modelled two users while still
  reading no roles out of a token, so the plan's "a set of selected ids" was taken literally.

The asymmetry task 0 recorded **is** modelled, because a page depends on it: `PUT …/selection` 404s for a
query that is not there, `DELETE …/selection` answers 204 regardless. A delete of a query also drops its
selections, as api's foreign key cascades them. Ownership comes from the token — `ownerId`, `ownerName` and
`createdBy` are all `auditName(req)` — which is the one thing about identity the mock already modelled.

**A create does not select the new query for its creator.** The spec does not say api does, so a mock that
did would let task 6 ship relying on it; that page issues the `PUT` itself, which is idempotent either way.

Tests split the way this package already splits them: the seven operations are driven **through the adapter**
in `src/api/client.test.ts` (14 cases — the round trip, the null-clears-a-column patch that distinguishes
this from a note's, the bounds refusal, idempotent select, deselect-what-you-cannot-see, the delete), and
what the adapter cannot reach is in `src/mock/server.test.ts` (11 cases — name ordering, the `editable`
constant, token-derived ownership, the two schema refusals, the cascade, reset, three 405s and a 404).

Measured from a `/tmp` copy, all three commands green: `yarn lint` exit 0 with the two known
`noUndeclaredEnvVars` warnings and no new ones — note the count is **3 warnings and 2 infos**, the third
being `biome.json`'s deprecated `recommended` field, which is pre-existing drift in this plan's baseline
note rather than anything this task added. **1,731 tests**, 8 of 8 tasks successful, 0 failures — up from
1,709, the whole rise being `@hmcts/deed-poll-api-client` 199 → 221. `yarn build` 8 of 8 in 10.3s. Later
tasks compare against **1,731**.

### Task 3: The domain service and its view model

New directory `libs/deed-poll/src/saved-queries/`, following `libs/deed-poll/src/notes/` exactly.

`service.ts` — thin functions, one per operation, each `callApi(caller, (config) => …)`. Copy
`notes/service.ts:34-75` in shape; there is nothing to add. Signatures take `(…, caller: Caller)` last, as
every service function does.

`view.ts` — turns wire saved queries into what the nav and the library page render. **This is where the
query's stored form becomes a URL**: use `caseListSearch({ filter, conditions, sort })` from
`case-query.ts:137`, so a saved query's link is built by the same function every other list link on the page
uses and cannot carry a different subset. `parseConditions` (`case-query.ts:93`) turns the stored condition
strings back into `CaseCondition[]`. **On the wire the field is `conditions`, not `where`** — task 0 confirmed
it — carrying the same `field:operator:value` strings the `where` *query parameter* takes; a request body with
a `where` key would be dropped in silence.

Export both from `libs/deed-poll/src/index.ts` with `export *`, in alphabetical position among the existing
lines. **Do not export `callApi`** — see the comment at lines 9-14.

Types live in the file that uses them, per the repo's conventions; no `types.ts`.

- [x] `libs/deed-poll/src/saved-queries/service.ts` with one thin `callApi` function per operation, shaped
      like `notes/service.ts`; `view.ts` building links through `caseListSearch` and reading conditions
      through `parseConditions`; both `export *`d from the package index; colocated `*.test.ts` for each,
      stubbing `@hmcts/deed-poll-api-client` and returning `ApiResult` unions as
      `.claude/rules/testing.md` shows

#### What was built, and one thing task 1 had left undone

`service.ts` is seven one-line `callApi` functions named as `notes/service.ts` names its five —
`findSavedQueries`, `findSavedQuery`, `createSavedQuery`, `updateSavedQuery`, `removeSavedQuery`, plus
`selectSavedQuery` and `deselectSavedQuery` for the selection sub-resource. The three whose names collide
with the adapter's are imported aliased (`apiCreateSavedQuery`, …), exactly as `createNote` is. **No
`delete-policy.ts`**, unlike `notes/` and `witnesses/`: those decide a rule this app owns and this one has
none to decide — `editable` is api's statement (decision 3).

**Task 1 typed its seven operations in terms of `WireSavedQuery*` directly**, where every other operation
in `client.ts` is typed with a domain alias (`Witness`, `WitnessCreate`, `WitnessPatch`). Since `wire.ts` is
deliberately not re-exported from the package index, a domain service could infer the type but could not
name it. Fixed here rather than worked around: `SavedQuery`, `SavedQueryCreate` and `SavedQueryPatch` join
the alias block at `client.ts:690`, and the seven signatures now use them. Types only — no call, no schema
and no assertion changed, and `contract.test.ts` stays at 57.

The DTO parameters are those aliases rather than a schema's inferred type, because **there is no
`saved-queries/schemas.ts` yet**: task 6 owns the form, so its zod schema, its bounds messages and its
checkbox coercion arrive with the page that needs them rather than being guessed at here.

`view.ts` holds four exported functions and no policy:

- `savedQueryLink(query)` → the `CaseListLink` a stored query stands for. `parseConditions` reads the
  stored `conditions` strings; `filterFor` falls back for a filter key api no longer publishes; the order
  is round-tripped through **`parseSort`**, so a query saved by `applicantEmail` opens in api's own order
  rather than reordering the rows by a cell the table does not show. No `page`, per decision 8.
- `savedQueryHref(query, listPath)` → the URL, built by `caseListSearch`. The path is a parameter because
  only a page knows where the list lives, which is the same division `CaseListLink` already draws.
- `buildSavedQueryNav(queries, { listPath, current })` → task 5's second group: the `selected` subset, in
  api's order and deliberately not re-sorted, each entry keyed on the query's **id** rather than its name.
- `buildSavedQueryLibrary(queries, listPath)` → task 6's rows, carrying `shared`, `selected` and
  `editable` through untouched.

One judgement worth flagging because task 5 inherits it: **`current` ignores `page`.** A caseworker on
page 2 of a saved query is still looking at that query, so the comparison is of the serialised
filter/conditions/sort with the page dropped from both sides. Everything else about it is a plain string
comparison of what `caseListSearch` produces, per task 5's instruction to compare serialised forms.

Measured from a `/tmp` copy of the working tree (`git ls-files -co`, not `git archive`, because the change
was uncommitted), all three commands green: `yarn lint` **exit 0** with the same 3 warnings and 2 infos
task 2 recorded and no new ones. **1,771 tests**, 8 of 8 tasks successful, 0 failures, 0 worker errors —
up 40 from 1,731, the whole rise being `@hmcts/deed-poll` 684 → 724 (15 service cases, 25 view cases).
`yarn build` 8 of 8 in 12.8s. Tasks 4 onward compare against **1,771**.

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

- [x] `filterGroups` replaces flat `filters` plus scalar `filterGroupLabel`; `current` computed in the
      handler not the template; `filterLabel` no longer claims "by status"; template loops groups with the
      per-entry markup unchanged; the two plan-10 nav tests updated to match with their intent intact; still
      exactly one group rendered

#### What was built, and one name this task had to add rather than remove

`filterGroups: [statusGroup(view, content)]` is the whole of the nav's model, one
`{ label, entries: NavEntry[] }` per group with `NavEntry` as `{ key, label, href, current }` — structurally
task 3's `SavedQueryNavEntry`, so task 5 appends its group with no shape to convert. Both interfaces are at
the bottom of `index.ts` per the repo's conventions rather than in the domain: a group is the page's layout
decision, and `view.ts` already declines to make it.

**`activeFilter` could not simply go, because it was doing two jobs.** The template read it twice — once to
decide which tab was current, and once as the builder's `<input type="hidden" name="filter">`. Only the first
is the nav's. The second is now `filterValue`, named beside the `sortValue` it sits next to in the form, so
the bar's "you are here" and the GET form's transport are two values that can no longer drift into each
other. The `en` key `filterGroupLabel` became `statusGroupLabel` for the same reason: a scalar named for the
whole bar, holding the first group's label, is the shape this task exists to remove.

`filterLabel` is now **"Filter cases"**, and the plan-10 test that asserted `aria-label="Filter by status"`
asserts the new wording plus `not.toContain("Filter by status")` — the old string is the regression worth
pinning, since it reappears silently and only a screen-reader user is told the lie. The five-item count at
`index.njk.test.ts:309` is **left scoped to the whole `<nav>`**, per task 4's note that task 5 scopes it to
the first group rather than renumbering it. A third `index.test.ts` reference to `model.filters` was at line
357 and not caught by grepping for the property alone.

Measured from a `/tmp` copy (`git ls-files -co`, the change being uncommitted), all three green: `yarn lint`
**exit 0**, 3 warnings and 2 infos, the same set tasks 2 and 3 recorded. **1,774 tests**, 8 of 8 tasks
successful, 0 failures — up 3 from 1,771, all of it the app (488 → 491): one template test that one group
renders, and the handler's single `activeFilter` assertion replaced by three (current entry, `filterValue`,
the group's label and size). `yarn build` 8 of 8 in 13.8s. Task 5 onward compares against **1,774**.

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

- [x] Second group rendered from the caller's selected queries, entries linking to each query's list URL;
      `current` decided on serialised filter/conditions/sort; a saved-query load failure degrades to the
      status group alone with the case list intact and a test covering it; no group rendered when the
      selection is empty; the five-item assertion scoped to the first group rather than renumbered

#### What was built, and the one shape decision inside it

`savedQueryEntries(caller, view)` is the whole of it: one call to `findSavedQueries`, handed to task 3's
`buildSavedQueryNav` with `LIST_PATH` and the request's own link as `current`, and **returning `NavEntry[]`
rather than the domain's `SavedQueryNavEntry[]`** — the two are structurally identical by task 4's design, so
the page names its own interface and no wire or view type crosses into `src/pages/`.

**The call is started before the list call and awaited after it.** `render` stayed synchronous; what changed
is that `runQuery` holds the promise across its `try`, so the table and the nav cost one round trip's latency
between them rather than two. It also means the `InvalidInputError` branch renders the same nav as the happy
one — asserted, because a refused query is exactly when a caseworker reaches for a saved one.

**Failure is caught for every kind, not for a named one.** `callApi` maps `unavailable`, `timeout` and
`invalid-response` to a plain `Error`, so a catch naming domain errors would let the commonest outage through
as a 500 — the opposite of this task's point. The log line is `saved queries unavailable: …` with no caller
and no query in it, per `client.ts`'s no-PII rule: what the logs must answer is whether the nav is degrading,
not whose it was.

The empty case renders **one** group. `filterGroups()` appends nothing for an empty selection rather than a
group with no items, because a heading is a promise of content to a screen-reader user.

`index.njk.test.ts`'s five-item count is now scoped to the first group through a `group(nav, index)` helper,
per task 4's note — the whole-`<nav>` count would have been satisfied by five items spread across two groups,
which is the assertion silently going quiet rather than failing.

Measured from a `/tmp` copy (`git ls-files -co`, the change being uncommitted), all three green: `yarn lint`
**exit 0**, the same 3 warnings and 2 infos tasks 2-4 recorded. **1,783 tests**, 8 of 8 tasks successful, 0
failures, 0 worker errors — up 9 from 1,774, all of it the app (491 → 500): 7 handler cases and 2 template
cases. `yarn build` 8 of 8 in 13.3s. Task 6 onward compares against **1,783**.

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
- **Edit and delete**, shown only when api says `editable` — confirmed present on `SavedQueryResponse` by
  task 0 (decision 3). Follow the
  existing shape for *rendering* a permissioned control — a named `canX` value passed into the template and
  `{% if %}`'d, hidden rather than disabled (`witness-edit.njk:79`, and the comment there on why a disabled
  button has no value to read). **Unlike witnesses, the flag comes from api, not from a local policy
  function** — do not add a `delete-policy.ts` here, because there is no local decision to make.

Every page needs `callerFromRequest(req)` (`src/auth/current-user.ts:35`).

- [x] `queries/new.ts` saving a named query from the query it was opened with, validated, errors summarised
      and anchored; `queries/index.ts` listing shared plus own with idempotent add/remove; edit and delete
      rendered on api's `editable` and hidden not disabled; no local policy function; colocated tests for
      each page asserting the render model

#### What was built, and the three things it had to add that the task did not list

Four pages' worth of files under `src/pages/deed-polls/queries/`: `new.ts` + `new.njk`, `index.ts` +
`index.njk` (the library), and `[queryId]/edit.ts` + `edit.njk`. The amend page is the addition the task
implies rather than names: "edit … rendered on api's `editable`" needs somewhere for the link to go, and a
library offering a link to a 404 is not a delivered feature.

**The query being saved travels in the form's `action`, not in hidden inputs.** A list URL *is* the query, so
`new.njk` posts back to the query string it was opened with and `case-query.ts` reads it exactly as the list
does — asserted in `new.njk.test.ts` by the *absence* of `name="where"` and `name="filter"`. Hidden inputs
would have been a second copy of state the URL already carries, and the first place a caseworker's conditions
get quietly re-serialised into something else.

Three additions the task's bullets did not list, each because the feature is unreachable or untypeable
without it:

- **`libs/deed-poll/src/saved-queries/schemas.ts`**, which task 3 deliberately deferred to here. One schema
  for both forms rather than a create/update pair, because both offer the same three controls and both post
  all three every time — a `.partial()` would accept a body missing a field the form always sends, which is
  why the witness *amend* page validates against its *create* schema. The messages are in the schema
  (`../notes/note-form.ts`'s precedent, not `../witnesses/schemas.ts`') because a blank name and an over-long
  name are two different things to say about one field and a page mapping one message per field can only say
  one. `MAX_SAVED_QUERY_NAME` and `MAX_SAVED_QUERY_DESCRIPTION` are api's published bounds, and a test pins
  that they may only ever be *lowered*.
- **`savedQueryStored(link)` in `view.ts`**, the inverse of `savedQueryLink`, placed beside it so the two
  cannot drift and round-tripped in the test. It stores **only the complete conditions** (`caseQueryWhere`,
  not `serialiseConditions`): a half-filled row is what "Add condition" leaves behind, it is left off the wire
  when the list is queried, and storing it would save a query that finds something other than what was on
  screen when it was named. It also splits the order into api's `sortField`/`sortDirection`.
- **`LIST_FILTER` and `SORT_DIRECTION` re-exported from `client.ts`**, beside the option-set arrays already
  there. Task 1 recorded them as exported and they were not — only from `wire.ts`, which the package index
  deliberately does not re-export — so a domain function could not *name* api's filter enum. Narrowing
  through the published array rather than casting is what fails to compile on the day api's five filters are
  not this app's five.

**Two links out of the list page**, after the builder's form and outside it: "Save this query", carrying
`caseListSearch` of the request's own query, and "All saved queries". Links rather than controls in the form,
per decision 9, and the template test reads them from after the last `</form>` so one drifting inside the GET
form fails rather than passing on a substring match. One consequence worth stating: the save link carries the
query **as applied**, so a caseworker who edits the builder without applying saves what produced the rows on
screen, which is what the save page's own first sentence says.

Two judgement calls inside the pages:

- **A failed *selection* does not lose a saved query.** `new.ts` creates then `PUT`s the selection, and a
  failure of the second is logged and the redirect stands: the query exists by then, and a 500 saying the save
  failed invites a caseworker to save it again. The library is still where they can add it by hand.
- **The library's api failure is a 500, deliberately unlike the nav's.** Task 5 degrades to the status group
  because there the saved queries sit beside the rows a caseworker came for. Here they *are* the page, and
  there is nothing else to render.

The write branches are ungated, as the witness delete is: with the controls hidden, reaching them takes a
hand-crafted POST and api refuses one — a local refusal as well would put one rule's authority in two places.
Both `editable` branches are covered in the page tests because the mock only ever answers `true`, exactly as
task 2 warned.

Measured from a `/tmp` copy (`git ls-files -co`, the change being uncommitted), all three green: `yarn lint`
**exit 0**, the same 3 warnings and 2 infos tasks 2-5 recorded and no new ones. **1,872 tests**, 8 of 8 tasks
successful, 0 failures, 0 worker errors — up 89 from 1,783: the app 500 → 573 (55 handler cases across the
three pages, 14 template cases, 4 on the list page's two new links) and `@hmcts/deed-poll` 724 → 740 (10
schema cases, 6 on `savedQueryStored`). `yarn build` 8 of 8 in 12.4s. Task 7 onward compares against
**1,872**.

### Task 7: The delete confirmation

Decision 5, and **read the correction above: there is no interstitial in this repo to copy.** This is new.

Deleting a **shared** query goes to a confirmation page stating that other people may have it in their list,
with a warning-styled confirm and a cancel that returns without acting. Deleting an **unshared** query needs
no interstitial — nobody else can see it, so there is nothing to warn about.

Wording states uncertainty. **Do not write a number**: api exposes no subscriber count, and *"3 people"*
would be invented.

- [x] Confirmation page for a shared query's delete, warning-styled confirm and a cancel that acts on
      nothing; unshared queries delete without one; wording claims no count; tests covering both paths and
      that cancel deletes nothing

#### What was built, and the one thing it had to decide that the task did not name

`src/pages/deed-polls/queries/[queryId]/delete.ts` plus `queries/delete.njk`, and the amend form's delete
branch now routes rather than acting: it reads the query and redirects a **published** one to the
confirmation, deleting an unshared one where it stands.

**The branch reads the *stored* `shared`, not the checkbox's.** That is the decision the task left open, and
the alternatives are not equivalent: a caseworker who unticks "publish" and then hits Delete without saving
has not unpublished anything, so everybody holding the query in their filter bar still holds it and the
warning is still owed. Deciding from `values.shared` would have skipped the interstitial on exactly the form
state that looks like it should. It costs one extra read on a delete — not a permission pre-check, which
decision 1 forbids, but the one fact the page cannot otherwise know.

**A typed URL for an unshared query's confirmation redirects to the amend form** rather than rendering. The
page's own sentence — "Other people may have this query in their filter bar" — is untrue of a query nobody
else can see, and a `GET` may not delete, so there is nothing honest for it to render.

Three properties the tests pin that the code alone does not state:

- **The wording carries no digit.** `expect(warning).not.toMatch(/\d/)` — decision 5 said no count, and a
  string assertion on the current sentence would not notice one arriving.
- **Cancel is a link, so the page has exactly one thing that can act.** The template test counts `<button>`
  and finds **one**, which is what makes "cancel deletes nothing" a property of the markup rather than of a
  handler branch. `POST` still refuses anything but the literal `action=delete`, because a body this page
  did not produce is not a confirmation.
- **`POST` does not re-read the query**, asserted rather than assumed: the confirmation was for the
  caseworker, not a lock, and a re-read would only invite a second opinion on api's rule. The confirm
  control still hangs off `editable` and is absent rather than disabled, as the amend form's is.

Measured from a `/tmp` copy (`git ls-files -co`, the change being uncommitted), all three green: `yarn lint`
**exit 0**, the same 3 warnings and 2 infos tasks 2-6 recorded and no new ones. **1,894 tests**, 8 of 8 tasks
successful, 0 failures, 0 worker errors — up 22 from 1,872, all of it the app (573 → 595): 15 handler cases
on the new page, 5 template cases, and 2 net on the amend form's rerouted delete. `yarn build` 8 of 8 in
14.2s. Task 8 compares against **1,894**.

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

- [x] One e2e happy path with an axe check; lint exit 0 with no new warnings; unit total up from the
      recorded baseline with no suite lost; build green; e2e green; `welsh:check` no worse; the measured
      numbers written into this task's log rather than estimated

#### What was built, and what the numbers actually say

One test in `e2e-tests/tests/deed-polls.spec.ts` — *"caseworker saves the query they built, follows it from
the filter bar, and takes it out again"* — placed after the two builder journeys and before the
scripts-disabled `describe`. It builds one condition with a script running (driven, not asserted: the builder
is the journeys above), follows **Save this query**, is refused for a blank name and checks the summary's
anchor resolves to `#name`, saves, and then reads the filter bar's second group. Four axe checks along it: the
save form, the same form carrying its error summary, the list page with the new group, and the library.

**The journey leaves and comes back, and that is not padding.** The entry for the query a caseworker is
already looking at renders as a `<span aria-current="page">`, so following it from where it was saved is
impossible by construction — the test goes to the Enroled tab, which carries the conditions and therefore is
not the saved query, and returns through the bar. That is the only way the *link* branch of task 5's `current`
is exercised at all, and it is the branch that navigates.

Three properties the assertions pin that no unit test can:

- **The stored query and the URL are one object.** The conditions come back in the *builder's controls*, not
  merely in the query string — `newForename` / `is` / the forename — which is decision 7's whole point and
  what a stub cannot catch: a `conditions` array that survives `savedQueryStored` and comes back as something
  `parseConditions` cannot read would still produce a plausible URL.
- **The second group exists only because something is in it.** Its presence is the assertion that the `PUT`
  on the selection sub-resource reached api, since task 5 renders no group for an empty selection.
- **Removing from the filter bar does not delete the query.** After the remove the row is still in the
  library offering **Add to my filter bar**, and the bar no longer names it.

Two helpers were added rather than inlined, both for reasons the existing file already documents elsewhere:
`savedQueryGroup` addresses the group by position because a group has no accessible name of its own (the
`<nav>` carries the label), and `libraryRow` scopes to one row because the mock's saved queries outlive a run
and are shared with every spec, so every row carries a button of the same name. The query's **name is unique
per run**, exactly as `seedForename` is and for the same reason.

Deliberately not asserted here: that `editable` gates anything. The mock sets it to the constant `true` and
can produce no 403 — task 2 recorded why — so what this journey shows is only that the control the flag gates
points at a URL that resolves. Both branches are covered in the page tests.

**Measured, from `/tmp/dpa-t8` (`git ls-files -co`, the change being uncommitted), all four commands:**

| Command | Result |
|---|---|
| `yarn lint` | **exit 0**, 3 warnings and 2 infos — the same set tasks 2-7 recorded, no new ones |
| `yarn turbo test test:app --concurrency=1` | **1,894 tests**, 8 of 8 tasks successful, 0 failures, 0 worker errors |
| `yarn build` | 8 of 8, 12.3s |
| `yarn test:e2e --workers=1` | **27 passed**, 0 failed, in 2.0m — 26 before, the new journey 7.9s |

**The unit total is 1,894 and did not move, which is correct rather than a lost suite.** Task 7's baseline was
1,894 and an e2e spec contributes nothing to the vitest run; per package, `//` 595, `@hmcts/deed-poll` 740,
`@hmcts/deed-poll-api-client` 221, `cloud-native-platform` 140, `express-govuk-starter` 127, `simple-router`
41, `express-session-postgres` 23, `express-session-redis` 7. Against the branch point (`d430d50`, 1,702) the
plan added **192**. The spec was type-checked separately (`tsc --noEmit --strict` over it), since Playwright
transpiles without checking and nothing else covers `e2e-tests/`.

**`welsh:check` is in the same state as at the branch point, and the honest statement is narrower than "no
worse".** Both exit **1** — it fails on any `cy` value identical to `en`, which is this repo's documented
pre-existing condition, not this plan's. Measured on a `git archive d430d50` copy against the working tree:

| | Strings | Identical in cy | of which not prose |
|---|---|---|---|
| Branch point `d430d50` | 170 | 145 | 7 |
| After task 8 | 225 | 200 | 7 |

So the *count* of untranslated strings rose by 55 — every string this plan added, all following the page's
`cy = { ...en }` pattern that the open question above sanctions — while the verdict, the failure mode and the
non-prose count are unchanged. Nothing previously translated was un-translated. Read that as the open
question still being open at a larger size, not as this task having improved or degraded it.

**Running the e2e suite needs the local stack, and two of its pieces are not the config's to start.** Redis
and `rse-idam-simulator` come from `docker compose` with fixed `container_name`s, so a second copy of the repo
under `/tmp` cannot run `yarn dev:up` — Compose refuses the name already in use. Start the containers from the
clone once, run `yarn idam:users` to seed the two fixtures (in-memory, gone on restart), then start
`yarn mock:api` and the app in the `/tmp` copy and let `reuseExistingServer` pick them up. `webServer`'s own
commands work in the clone and only there.

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
