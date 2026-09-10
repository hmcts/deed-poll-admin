# Plan: Cut the data access layer over to deed-poll-api

## Overview

Make this repo a presentation layer with **no data access layer at all**. Every read and write of case
data goes to `deed-poll-api` over HTTP; Prisma, the migrations and the pg pool leave the repo entirely.

This is the cutover `DEED_POLL_API_PLAN.md` describes, brought forward: Steve's call, 2026-09-07, on the
principle that admin should own no DAL. Sessions are **not** part of it — they move to Redis in
`01-jenkins-and-session-schema.md`, and the reasoning for keeping them local is recorded at the call site
there. Read that before assuming consistency argues for moving them too.

### The file count is misleading — read this first

21 files in `libs/deed-poll` and `apps/web` import `@hmcts/postgres-prisma`. They are **two different
jobs**, and conflating them makes this look three times bigger than it is:

| | Files | What the cutover does |
|---|---|---|
| **Query layer** — actually reads or writes the database | `deed-poll/service.ts`, `notes/service.ts`, `witnesses/service.ts`, `documents/service.ts`, `documents/document-types.ts`, `deed-poll/reference-number.ts`, `health.ts`, and the pool in `apps/web/src/app.ts` | **Replaced** by adapter calls |
| **Type-only imports** — import `DeedPoll`, `DeedPollNote` etc. as *types* for view models, validation and enums | `case-header.ts`, `case-state.ts`, `computed.ts`, `deed-poll-validation.ts`, `edit-view.ts`, `enums/dynamics-values.ts`, `form-presentation.ts`, `list-filters.ts`, `list-view.ts`, `schemas.ts`, `documents-view.ts`, `notes-view.ts`, `documents/schemas.ts` | **Re-pointed** at types the adapter owns. No logic changes |

The second group is the bulk and the least interesting. Do not rewrite view models or validation: they are
tested, they encode Dynamics behaviour that was expensive to establish, and none of them touches the
database. They just need somewhere other than Prisma to get a type from.

### Prerequisite in another repo

**`deed-poll-api` has no note DELETE endpoint**, and this app's note form has a delete button — a second
submit branching on `action`. Steve's call, 2026-09-07: **add it to api.**

`NoteService.removeNote(deedPollId, id)` already exists, so it is a controller method, a test, and the
published spec. Note that api's `CLAUDE.md` states "12 operations, no thirteenth" as an invariant and there
is a test asserting the route count — both have to move to 13 deliberately, not be worked around.

**Merged, 2026-09-08** — api commit `847933a`, "Expose the note delete as the thirteenth caseworker
operation (#4)". The route count invariant moved to 13 deliberately, as this section asked. Nothing in this
plan is blocked on another repo any more, and task 6 can be done whenever its turn comes.

### Source material — read these, do not re-derive them

| What | Where |
|---|---|
| Why this cutover exists, what moves and what stays | `.business_context/DEED_POLL_API_PLAN.md` — especially "What moves, what stays, what goes" |
| The working example of a frontend consuming api | `../deed-poll-web/libs/deed-poll-api-client/` — `openapi.yaml`, one adapter, an in-memory mock |
| api's actual caseworker surface | `../deed-poll-api/src/main/java/uk/gov/hmcts/reform/deedpoll/api/caseworker/` and its published `/v3/api-docs` |
| Why sessions are excluded | `docs/plans/completed/01-jenkins-and-session-schema.md`, task 2 |

### Architecture decisions already taken — implement these, do not revisit

1. **One adapter, and nothing above it knows api exists.** `deed-poll-web`'s shape: the wire types and the
   mock are deliberately not exported from the package index. Copy that discipline.
2. **The adapter never throws on a failed call.** Web returns `ApiResult<T>`, a discriminated union, so an
   unreachable or refusing api is an ordinary state a page renders rather than a 500. Do the same — this app
   is a caseworker's whole working day and "the backend blinked" must not lose their form.
3. **Take api's real spec.** Web hand-wrote `openapi.yaml` because api did not exist yet. It does now, so
   generate from api's published document and treat divergence as a bug in one of them, not as licence to
   invent.
4. **Sessions stay in Redis, locally.** Not negotiable in this plan; see the call-site comment.
5. **No CCD and no CDAM.** They are api's plans 02 and 03. This app talks to api and knows nothing about
   what is behind it.

### Constraints

- **api must be reachable for local development and tests.** It is not deployed. Follow web: an in-memory
  mock implementing the contract, started alongside the app. Do **not** make the test suite depend on a
  running Java service.
- **Do not delete the conformance harness.** `libs/deed-poll/src/conformance` is the proof the port did not
  silently drop Dataverse columns, and `DEED_POLL_API_PLAN.md` says to re-point it rather than let it lapse.
  Task 7 decides its home; until then leave it alone even though it reads the Prisma schema.
- **`apps/api` goes, and its 261 route tests with it.** Nothing consumes it — verified in
  `DEED_POLL_API_PLAN.md`. Deleting a large test suite is correct here and should not be argued with.
- Every task must leave `yarn lint`, `yarn build` and `yarn test` green.

## Validation Commands
- `yarn lint`
- `yarn build`
- `yarn test`

> All three, every task. `yarn test` runs vitest, which transpiles without type-checking — it passes on code
> `yarn build` rejects. This plan changes types across 13 files, so `build` is the one that matters most.

### Task 1: Generate the api client and its mock

- [x] Create `libs/deed-poll-api-client/`, mirroring `../deed-poll-web/libs/deed-poll-api-client/`'s layout: the spec, a `src/api/client.ts` adapter, a `src/api/wire.ts` for the wire shape, and `src/mock/`
- [x] Take the spec from api's published document rather than writing one. Record which api commit it was taken from, so a later divergence is dateable — `openapi.json`, from api `847933a`, recorded in `SPEC-PROVENANCE.md`
- [x] The adapter returns `ApiResult<T>` and never throws. Model the union on web's — plus `unauthorized` and `forbidden`, which web has no use for and this app's `errors.ts` already maps
- [x] Do not export `wire` or `mock` from the package index
- [x] Add an in-memory mock implementing every operation this app uses, and a script to run it, as web has `yarn mock:api`
- [x] Mark completed

Two things worth knowing before task 2 uses this:

- **The wire keys are camelCase**, unlike web's client. api is Spring with Jackson's defaults, so nothing is
  renamed at the boundary and the adapter's domain types are aliases of the wire types rather than
  restatements. What IS converted is two value types, both documented at the code that does it: date-times
  become `Date` (pinned to UTC — api's `LocalDateTime` is zoneless and `new Date()` would read it as local,
  shifting every date-only column by a timezone), and `refundAmount` stays a `number` where Prisma gave a
  `Decimal`.
- **`STRICT_RESPONSE_PROPERTIES` is a decision, not a derivation.** springdoc publishes no nullability for a
  response, so which properties reject null had to be chosen; `contract.test.ts` pins the list so it cannot
  drift into rejecting an ordinary half-logged case. The note-delete endpoint the prerequisite asked for is
  in the document, so **task 6 is unblocked** — the adapter already wires it.

### Task 2: Re-point the type-only imports

Do this **before** touching any query, because it is mechanical and it makes the query work reviewable.

- [x] For each of the 13 type-only files listed above, replace `import type { … } from "@hmcts/postgres-prisma"` with the equivalent type from the api client
- [x] Where a Prisma type and the api type genuinely differ — dates as `Date` versus ISO strings, `Decimal` versus `number` — **do not paper over it with a cast.** Record the difference and convert at the adapter boundary, which is the only place that should know about the wire format
- [x] Change no logic. The diff for this task should be imports and type annotations only
- [x] Mark completed

Three things the re-point turned up, all recorded at the code that deals with them:

- **The enums needed a home.** Prisma's generated enums were a type AND a value under one name, and seven
  of the 13 files use `DeedPollState.Returned` rather than a bare string. The client publishes member
  ARRAYS (pinned against the spec by `contract.test.ts`) and union types, so
  `deed-poll/enums/option-sets.ts` turns each array back into the named-member object those rules were
  written against. The members are never restated — every object is BUILT from the client's array — so a
  member added at api's end reaches the Dynamics label maps without an edit.
- **`storageKey` became `hasFile`.** `documents-view.ts` derived "is this row downloadable" from the local
  storage key; api publishes the fact and not the key, deliberately. This is the one place where the
  re-point could not be an annotation, and the difference is at both ends: the wire module and the row
  builder.
- **The still-Prisma query layer converts at its own edge.** `service.ts` gained two four-line functions
  turning a `Decimal` into a number and adding `hasFile` to a document row, because the view models above
  it now describe api's shape while the query below it is still Prisma's. They go with the queries around
  them in tasks 3 and 4 — they are the seam, not a permanent adapter.

`list-filters.ts` also lost `Prisma.DeedPollWhereInput`, restated as a two-member `ListFilterWhere` so the
"Open by exclusion" rule survives task 5. Task 3 is what stops the service reading it at all: api resolves
a filter KEY.

### Task 3: Replace the case query layer

- [x] `deed-poll/service.ts` — every function becomes an adapter call: list, create, read, patch. `GET/POST /caseworker/cases`, `GET/PATCH /caseworker/cases/{id}`
- [x] `deed-poll/reference-number.ts` — **delete the allocation logic.** api owns reference numbers now; it allocates them from a sequential counter and returns one on create. This app must not generate them, and a second allocator against the same counter is a correctness bug, not a duplication — the whole file went, nothing outside the service read it
- [x] Field rules come from `GET /caseworker/cases/field-rules`, not from a local table
- [x] Keep the error mapping in `apps/web/src/errors.ts`. `NotFoundError` → 404 and `ForbiddenError` → 403 still apply; they now originate from an adapter result rather than a domain throw
- [x] Mark completed

Five things the replacement settled, each recorded at the code that deals with it:

- **The write context became a token.** Every function takes a `Caller` — `{ accessToken }` — in place of
  `{ isAdmin, userName }`, because api authenticates each call and derives BOTH the audit author and the
  admin status from the token. Sending either alongside it would let this app assert an identity api never
  verified. `apps/web` reads it from the session (`callerFromRequest`); `apps/api` forwards the bearer
  token it arrived with. `apiConfig()` stays private to `libs/deed-poll/src/api/deed-poll-api.ts`, so no
  page sees a base URL.
- **The adapter's `ApiResult` becomes a domain throw at the service, not at the page.** That is what the
  fourth box above asks for: `not-found` → `NotFoundError`, `validation` → `InvalidInputError` with api's
  field errors, and `unavailable`/`timeout`/`invalid-response` → a plain `Error` on the 500 page, which is
  where a database outage went before. `unauthorized` maps to `UnauthorizedError`, which `errors.ts` does
  **not** render — an expired token reaching a page is a 500. Left alone deliberately: `requireAuth` and
  `refreshMiddleware` own re-authentication, and a redirect to `/login` from an error handler loops when
  the session is valid and only api rejected the token.
- **`computed.ts` went with the query.** api publishes `daysReceivedToEnroled` and
  `daysReceivedToReturned` on every case it returns, so attaching them again on the read path was the same
  second-opinion problem as a second reference-number allocator. `DeedPollWithComputed` and
  `DeedPollWithChildren` are `SavedCase` and `CaseDetail` now.
- **`removeDeedPoll` and `apps/api`'s `DELETE /deed-polls/:id` are gone.** api has no case delete — it is
  in this plan's "out of scope" — so the alternative was a route that could only fail. Its admin-only
  guard (Steve, 2026-09-03) goes with it; restoring the operation is a change in api first. `validate` has
  no endpoint either but `validateCaseForSubmit` survives, because it is the local matrix applied to a
  record api supplies, and it reads no database.
- **The local field-rule matrix stays.** `deed-poll-validation.ts` still holds it and `edit-view.ts` still
  reads it directly, because the plan keeps the validation and the view models as they are and the
  conformance harness pins that matrix against the Dataverse exports. What changed is that
  `getCaseFieldRules` — the function a page asks — is api's answer now. Both ends carrying the rules is
  the arrangement `upload-policy.ts` already has, on purpose.

### Task 4: Replace the notes, witnesses and documents query layers

- [x] `notes/service.ts` — list, create, read, patch against `/caseworker/cases/{id}/notes`. **Leave the delete unported for now**; it is the prerequisite above, and task 6 completes it
- [x] `witnesses/service.ts` — **read-only.** Witnesses arrive inside `GET /caseworker/cases/{id}`, and api has no witness write endpoints, deliberately. This app's edit form renders witnesses as a managed list with zero editable fields, so nothing is lost
- [x] `documents/service.ts` — upload via the multipart `POST /caseworker/cases/{id}/documents`, download via `GET …/documents/{documentId}/file`. **Delete `file-storage.ts`**: local disk was always a development story, pods are ephemeral and replicas share no volume, and api owns storage now
- [x] `documents/document-types.ts` — `GET /caseworker/document-types`, read-only. api has no document-type writes, also deliberate
- [x] Keep `upload-policy.ts` where it is. The 10 MB limit and the accepted-type list are enforced by both sides on purpose; a client that rejects early gives a better error than a 400 from api
- [x] Mark completed

Five things the child-entity replacement settled, each recorded at the code that deals with it:

- **The per-call scoping guard went, and the guarantee did not.** Every function in these three files
  used to run `assertCaseExists` and then carry `{ id, deedPollId }` in its own `where` — belt and
  braces, so an unscoped write was not expressible. api's note routes are nested under the case, and
  its witnesses and documents arrive INSIDE the case, so another case's child is not in the list this
  app looks at. Re-checking here would mean a second round trip to learn what the first call already
  said. The 404-not-`[]` distinction survives with it: a mistyped case id and a real case with no notes
  are still different answers.
- **Nine operations went, and none of them is a regression.** api publishes no witness writes, no
  document metadata-only create, no document patch, no document delete and no document-type writes —
  all recorded in `DEED_POLL_API_PLAN.md` as not rebuilt until something asks, and nothing in this app
  asks. `createWitnessSchema`, `updateWitnessSchema`, `createDocumentSchema`, `updateDocumentSchema`
  and both document-type schemas went with them, along with `apps/api`'s eight routes and
  `routes/document-types/[id].ts` entirely. A route that could only fail is worse than a 404, and the
  wiring tests assert the 404s so the change is not provable only by absence. The in-use check that
  made the document-type delete a 409 rather than a foreign-key 500 was a real defect fix: the
  constraint it protected is api's database now, and enforcing it belongs with whoever rebuilds that
  delete.
- **`downloadDocument` streams and composes nothing.** api decides the filename and the disposition,
  so both download routes forward its headers instead of building one — which retires `safeFilename`
  and the header-injection guard around it, because the value is a server's output rather than an
  uploading client's text. The conversion from `fetch`'s web stream to a Node one is in the adapter,
  not in the two routes: `lib.dom`'s `ReadableStream` and `node:stream/web`'s are different types for
  the same runtime object, and that cast belongs where HTTP is already known about.
- **`upload-policy.ts` is untouched and is now load-bearing at both ends.** The 25 MB limit rejects a
  body before it goes on the wire, which is a better error than a 400 after the upload — and the
  missing-file rejection stays local too, because a form with no file part is a form the caseworker has
  not finished. What went is the local defaulting: api names the row from the file and defaults the
  direction to Incoming, so neither is sent unless the form supplied it.
- **The note form lost its delete button, temporarily and deliberately.** Task 6 restores the branch,
  the button and the e2e leg together; wiring one without the others leaves a control that saves when
  the caseworker asked to delete. The behaviour to restore exactly is recorded at the handler, and the
  test asserting that a missing `action` is never destructive is still there — it is the half of the
  rule that must hold either way.

### Task 5: Remove Prisma, the pool and the migrations

- [x] Delete `apps/api` and its tests. Nothing consumes it
- [x] Delete `apps/postgres`, `libs/postgres-prisma`, and the migrations under `apps/postgres/prisma/migrations/`
- [x] Remove the pg pool from `apps/web/src/app.ts` and the `@hmcts/postgres-prisma` dependency from every `package.json` that names it
- [x] **Re-point the readiness check.** `deedPollDatabaseChecks()` goes; what replaces it is Redis — already added in plan 01 — plus a check that api answers. A probe that goes green while api is unreachable is worse than no probe, because Kubernetes will send traffic to a pod that cannot serve a single case page
- [x] `yarn install --immutable` afterwards
- [x] Mark completed

Five things the removal settled, each recorded at the code that deals with it:

- **`libs/onboarding` and its pages went too, and this plan did not ask for it.**
  `03-collapse-to-single-app.md` names this as a defect in plan 02 and it is right: onboarding's
  `queries.ts` called `prisma.onboardingSubmission`, so `libs/postgres-prisma` could not be deleted
  while it existed and the "leave every task green" constraint left no third option. Plan 03's own
  decision 3 — template demo content, unreachable by navigation, deletion rather than migration — is
  what was carried out, early: `libs/onboarding/`, the eight pages under
  `apps/web/src/pages/onboarding/`, their two asset entries, and
  `e2e-tests/tests/onboarding-happy-path.spec.ts`. **Plan 03 task 1 is therefore already done**, and
  its test arithmetic needs revising: the drop landed here instead.
- **`health.ts` went in full rather than being edited down.** Every part of it existed for a fault
  `pgPool` could produce and api cannot — `DEED_POLL_TABLES` for an unmigrated database, and the
  `guarded`/shared-attempt/staleness machinery for a query that neither resolves nor rejects because
  `connectionTimeoutMillis` was `0`. Every call through `client.ts` carries an `AbortSignal.timeout`,
  so the replacement settles by construction. `deedPollApiStatus` is 4 lines and lives in
  `libs/deed-poll/src/api/deed-poll-api.ts`, next to the private `apiConfig` it needs — with the
  argument for dropping the machinery written at it, so nobody reinstates it by analogy.
- **The probe's timeout is fixed at 2s and is deliberately not `DEED_POLL_API_TIMEOUT_MS`.** A probe
  must answer on its own terms: `runChecks` is a bare `Promise.all`, so a probe that waited the
  application's patience out would report nothing at all and take the Redis result with it. Both halves
  are pinned by `deed-poll-api.test.ts`, against a real socket — a server that accepts and never answers
  is the case a stubbed `fetch` would define away, and it is the one that matters.
- **Three OSV ignores went with Prisma.** Two `mysql2` advisories and one `deepmerge-ts`, all ignored
  only because the Prisma CLI pinned them exactly. Neither package is in `yarn.lock` any more, and an
  ignore for an absent dependency would silently suppress the same advisory if it returned for an
  unrelated reason.
- **`libs/deed-poll` had to state `"types": ["node"]`.** Node's globals reached it transitively through
  `@hmcts/postgres-prisma`'s own `@types/node`; `apps/web` was getting `multer` the same way, from
  `apps/api`. Both are declared now. This is the sort of breakage `yarn test` cannot see and `yarn build`
  can, which is what the note under Validation Commands is about.

Left for the tasks that own them: `DATABASE_URL` and `postgres-url` are still in the four `values.yaml`
and in `apps/crons`' `omit` list — task 8. `scripts/progress-dashboard.mjs` now reports zero ported
handlers because it counted `apps/api`'s route files; its Phase 3 model died with them, and the record
is task 8's. The conformance harness compiles and passes: it reads the Dataverse artifacts, not the
Prisma schema, and its three enum imports were re-pointed at `enums/option-sets.ts` — a one-line change
each, leaving task 7's decision about its home genuinely open.

**Test arithmetic, so a deliberate deletion is not mistaken for a regression:** 1,608 unit tests →
**1,261**, and 21 e2e → **16**. The drop is `apps/api` (211 declarations, more once `it.each` expands),
`apps/postgres` (15), `libs/onboarding` (72), the onboarding pages (32) and `health.test.ts` (14), less
the 7 added for `deedPollApiStatus`. No other suite lost a test.

### Task 6: Note deletion, once api has the endpoint

- [x] Confirm `DELETE /caseworker/cases/{id}/notes/{noteId}` exists in api and is in its published spec
- [x] Wire it through the adapter and restore the note form's delete branch
- [x] Keep the existing behaviour exactly: delete is checked **before** validation, so a note whose text would fail validation can still be deleted, and only the literal `"delete"` deletes — a missing `action` falls through to save and is never destructive. All three are pinned by tests today; they must still be
- [x] Mark completed

Three things worth recording:

- **The adapter needed nothing.** Task 1 took the spec from api `847933a`, which is the commit that added
  the endpoint, so `deleteNote` and the mock's `DELETE` branch have been there since — pinned by
  `contract.test.ts`'s route list and by two `client.test.ts` cases against the mock. The first box was a
  confirmation, not work. What task 6 actually restored is the three things above the adapter that task 4
  removed together: `removeNote`, the handler branch, and the button.
- **`removeNote` lost its pre-read and kept its guarantee.** The Prisma version read the note before
  deleting on `{ id, deedPollId }` — the read so a wrong parent was a `NotFoundError` rather than a delete
  that quietly matched no rows. api's nested route answers 404 for a note that is not under this case, and
  `callApi` maps that to the same `NotFoundError`, so the second round trip went and the outcome did not.
  This is the same argument task 4 made for the other child entities, applied to the operation it deferred.
- **The behaviour is pinned from both sides now.** The task 4 test asserting that a missing `action` saves
  is unchanged — it is the half of the rule that holds either way — and it gained `removeNote` not being
  called. Three joined it: `"Delete"` is not `"delete"`, a delete of an over-long note succeeds without a
  400, and a delete of another case's note throws rather than reporting success. The e2e journey is
  `"caseworker adds, amends and deletes a note"` again, driving the button rather than the service, because
  the button and the branch are only correct together.

**Test arithmetic:** 1,261 → **1,266**, and e2e stays at **16** — the delete leg rejoined the existing note
journey rather than becoming a test of its own.

### Task 7: Decide the conformance harness's home

- [x] `libs/deed-poll/src/conformance` proves the Dataverse columns were not silently dropped, and it reads the Prisma schema — which task 5 deleted. It cannot stay as it is
- [x] Two options, and this is a decision to record rather than guess: **re-point it at api's schema** (it belongs with the thing that owns the columns, and api already has its own conformance suite it could join), or **retire it here** and rely on api's
- [x] Whichever is chosen, carry its caveat: the Dataverse exports are **alphabetically truncated (A–R)**, so it asserts forward coverage only and must never be read as a complete column set
- [x] Do not silently delete it. It is the correctness argument for the whole migration
- [x] Mark completed

**The decision: one layer of five moves, four stay.** Recorded in full at
`libs/deed-poll/src/conformance/README.md` — the record the third and fourth boxes asked for, and the
thing to read before touching either half. In short:

- **The structural layer is retired here because it is already re-pointed, in api.** `schema.conformance.test.ts`
  and `artifacts.ts` (the fixture loader, which only that layer used) went. api commit `9db5fe3` ported
  them, vendoring the Dataverse exports at `src/test/resources/reference/dataverse_tables/` and this
  directory's originals alongside them, so "re-point at api's schema" and "retire it here" turned out to be
  the same option with the work already done. api's version is also strictly stronger, in a way worth
  knowing: the TypeScript layer only asserted its map *had a key* for each source column and never checked
  the field name it claimed existed, so a rename left a column looking accounted for while nothing carried
  it. `everyMappedFieldExistsInTheReferenceModel()` closes that, and `db.SchemaConformanceTest` continues
  the chain to the live Flyway schema — source → schema → database, which this repo could not complete.
- **The local alternative was considered and rejected on the merits, not on effort.** Asserting the columns
  against `libs/deed-poll-api-client/openapi.json` is right here and looks equivalent. It is not: api
  deliberately does not publish everything it stores — the document storage key is the worked example, the
  wire carrying `hasFile` instead — so absence from the wire is not absence from the store, and such a
  harness would have had to encode api's *publication* policy to stop failing on columns that are in fact
  carried. That is a test of the wrong thing.
- **The four rule layers stay, and this is not sentiment.** `state-cascade`, `field-rules`,
  `conditional-gates` and `enum-values` assert against `case-state.ts`, `deed-poll-validation.ts` and
  `enums/dynamics-values.ts`, all still here and all still applied — `edit-view.ts` reads the field-rule
  matrix directly, exactly as task 3 recorded. api enforcing the same rules is the `upload-policy.ts`
  arrangement again: a rule applied at both ends needs pinning at both ends. Retire them here when the local
  matrix goes, not before.
- **The A–R caveat, and a thing it turns out to imply.** api carries it in
  `DataverseSchemaConformanceTest`'s docblock and asserts the truncation directly, so a fuller export trips
  a test instead of passing unnoticed. What is worth stating and was not obvious: the columns the truncation
  hides are `Type`, `State` and `Urgency` — precisely the ones the four remaining layers drive their rules
  from. The structural half never covered them, so the two halves were always complementary rather than
  overlapping, and keeping the rule layers here is not a duplicate of what api now runs.
- **Four stale comments went with it, and the grep is not silent yet.** `prisma` in `apps/` and `libs/`
  now returns historical prose only — "the Prisma version read the note first, api's nested route answers
  404" and similar, which is rationale for a deliberate difference and is worth keeping — plus one live
  item that is **task 8's**: `apps/web/helm/values.yaml` still comments that removing the database
  credential would break every case page. What was corrected here is the four comments that described
  *current* code in Prisma's terms and were therefore false: `refundAmount` is a number not a `Decimal`
  (`detail-view.ts`), `FieldDef.name` is api's field name (`form-fields.ts`, twice), and
  `schema-primitives.ts` rejects `null` to pre-empt a 400 from api rather than a database error.

**Test arithmetic:** 1,266 → **1,188**; the conformance directory 141 → **63**. All 78 are layer 1, 72 of
them one `it()` per artifact column. e2e stays at **16** — the harness has no e2e leg.

### Task 8: Charts, config and the record

- [x] Remove `postgres-url` / `DATABASE_URL` from all four `values.yaml`. This app no longer has a database
- [x] Add whatever api's base URL and S2S credential require. **This is a real outstanding dependency, not an optional one** — see `deed-poll-web/docs/external-dependencies.md`, which tracks the same requirement for the other frontend
- [x] Update `CLAUDE.md`: no Prisma, no database, no migrations. The Database Operations commands go
- [x] Update `.business_context/PROGRESS.md` and `DEED_POLL_API_PLAN.md` to record the cutover as done
- [x] Mark completed

Five things this task settled, each recorded at the file that carries it:

- **The S2S credential is nothing to add, and that is a finding rather than a deferral.** api authenticates
  a **forwarded IDAM access token and nothing else** — `SecurityConfiguration` is an OAuth2 resource server
  with no `ServiceAuthorization` filter, and `bearerAuth` is the only security scheme in `openapi.json`. So
  the caseworker's own token, out of the session, is the whole credential and there is no vault entry for
  this chart to name. This differs from `deed-poll-web`, whose hand-written contract *required* a
  `ServiceAuthorization` header, which is why that repo tracks it as outstanding: web's spec was written
  before api existed, and api chose differently. Recorded at the `keyVaults` block and in
  `docs/DEPLOYMENT.md`, with the argument that if api ever gains S2S the answer is a token provider minting
  one per call plus a microservice name for *this* app — **not** a static token in an environment variable.
- **The base URL is the subchart's, resolved per environment, and preview is the exception.**
  `DEED_POLL_API_URL` is `http://deed-poll-api-{{ .Values.global.environment }}.service.core-compute-…`
  in `apps/web/helm/values.yaml` — api's CNP internal host, not an ingress. The root AAT template
  deliberately does **not** restate it (unlike `IDAM_REDIRECT_URI`, which it must, because that chart
  overrides the `ingressHost` the two have to agree on). Preview overrides it to AAT's api because api's
  preview deploys are per-PR hosts with no stable name — so **preview writes land in AAT's data**, stated at
  the value rather than discovered later.
- **Three chart dependencies had to go, not just two config lines.** `Chart.yaml` still declared
  `deed-poll-admin-postgres` and `deed-poll-admin-api` as `file://` dependencies on directories task 5
  deleted, which fails `helm dependency build` — so the chart could not resolve at all, a bigger breakage
  than the `DATABASE_URL` this task was named for. `postgresql` went with them. Removed rather than
  commented out, for the same reason.
- **`apps/crons` lost its `omit: ["DATABASE_URL"]`.** It filtered a key the chart no longer maps.
  `apps/web`'s `omit: ["REDIS_URL"]` stays and is not the same thing: it stops a developer running against
  a real vault having the deployed session store replace their local one.
- **`scripts/progress-dashboard.mjs`'s Phase 3 model is replaced rather than deleted.** It counted
  `export const GET` under `apps/api/src/routes/**` against a hardcoded 29, so after task 5 it reported
  0/29 — a deliberate deletion rendered as a total regression. What it counts now is api's published
  caseworker operations (13, grouped by path) against the adapter's exported functions (14, the extra being
  `checkApiReachable`), both derived, with `contract.test.ts` named as the thing that actually proves they
  correspond. **No progress bar and no percentage**, deliberately: api publishes what it publishes, and the
  writes it has no endpoint for are out of scope rather than outstanding.

Also corrected, because they described current code in the terms of a deleted layer: `README.md`,
`docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` and `docs/PIPELINES.md` (which now lists **six** blockers, not
four — platform onboarding and api not being deployed), `.claude/rules/backend.md` (which instructed
contributors to write `prisma.*` calls in `apps/api/src/routes/`, both deleted) and
`.claude/rules/testing.md` (whose unit-test example mocked `@hmcts/postgres-prisma`). Four stale test
comments in `libs/deed-poll` went the same way. `grep -ri prisma apps/ libs/` is now historical rationale
only — deliberate differences from the Prisma version, worth keeping, as task 7 recorded.

**Test arithmetic: unchanged at 1,188**, verified by `yarn progress:write`, which now records that figure in
`PROGRESS.md` rather than a stale one. This task changed configuration and prose, not behaviour — the one
code change, dropping crons' `omit`, is covered by the existing `objectContaining` assertion.

**A trap for whoever ran the suite by hand, since fixed:** an exported `REDIS_URL` in your shell failed
`app.test.ts`'s "connects a Redis client at the configured URL", which asserts `config/default.json`'s
default. `yarn test` passed because turbo does not pass the variable through; a bare `vitest run` in
`apps/web` inherited it, and the README recommends exporting it for `yarn test:e2e` in the devcontainer, so
the two instructions conflicted. The test now sets `REDIS_URL` itself in a `vi.hoisted` block — before the
imports, because `auth/settings.ts` imports `config` at module scope and `config` reads the environment
once — so it pins the mapping instead of depending on the absence of a variable.

### Post-review corrections

Recorded here rather than folded into the tasks, because they are the review's findings and not the plan's
boxes. Five were behaviour, and the first is the one that mattered:

- **The download route dropped the two headers that make api's `inline` disposition safe.** api serves PDFs,
  JPEGs and PNGs `inline` — its call, so a caseworker checking a birth certificate does not have to download
  it — and pairs that with `Content-Security-Policy: default-src 'none'; sandbox` and
  `X-Content-Type-Options: nosniff`, because a PDF viewer executes script embedded in the document. Task 4's "forward its headers instead of building one" was implemented as
  `Content-Type` and `Content-Disposition` only, so an applicant's upload rendered in this app's origin under
  helmet's `default-src 'self'`. `master` always sent `attachment`, so inline rendering was **new** here and
  the argument for it was left behind in api. `DocumentDownload` carries all four now, the route forwards
  them, and the mock sends what api sends — it was answering `attachment` for everything, so no test could
  have caught the difference.
- **A download's timeout covered the whole exchange, including the body.** `AbortSignal.timeout` is not
  scoped to the response headers, so a 25 MB scan on anything but a fast link aborted mid-stream — and the
  headers were already sent, so `domainErrorHandler` delegates and the caseworker silently saves a truncated
  file. `send` now takes a `streaming` flag: the timer is cancellable and is cleared once the response is in
  hand, while a JSON call stays bounded end to end because its body is small and read there. Both rules are
  pinned against a real dripping server.
  **Clearing that timer does not leave the body unbounded, which a later review read it as.** `bounded`
  re-applies the same patience to each READ of the download: bytes that keep arriving keep a slow transfer
  alive, and a silence longer than the timeout ends it. The timer covers only an outstanding read, so a
  caseworker on a slow connection back-pressuring the stream is not mistaken for api going quiet, and a
  stall errors rather than closing the stream — cancelling would end it cleanly and serve a short file under
  the 200 already sent. Without it the floor was Node's own `bodyTimeout`, five minutes of a held `undici`
  socket and a held response per stalled download, which the second dripping-server test now pins.
- **A body read the timeout cut short was classified `invalid-response`.** That kind means "a bug at one end
  or the other" and is the one an operator is meant to investigate, so reporting a stall as one sent them
  hunting a contract defect. It is a `timeout` now.
- **The note forms did not catch the `InvalidInputError` api can now throw.** Before the cutover the note
  services could not reject text the local schema had accepted; now any rule api applies that this form does
  not mirror reached the 500 page and discarded what the caseworker had typed. Both forms catch it and
  re-render, as the upload page and the edit tab already did.
- **`requestNoContent` left `/health`'s body unread**, which keeps the connection out of `undici`'s pool
  until it is collected — socket churn on a readiness probe that runs for the life of the pod.

A later pass found three more, all of them the download fix's arguments applied where they had not been:

- **The upload was bounded by the JSON default, which is the mistake the download had already had fixed.**
  `DEFAULT_TIMEOUT_MS` is ten seconds and is really measuring api's thinking time, because a JSON request
  body is a few hundred bytes. A multipart upload is up to `MAX_UPLOAD_BYTES` — 25 MB — and the same clock
  covered pushing all of it across the wire *and* api storing it: a sustained 2.5 MB/s with nothing left
  over. The download's answer is not available here, because a per-read bound needs a body being READ and
  `fetch` exposes no upload progress, so the lever is patience: `UPLOAD_TIMEOUT_MS`, sixty seconds, still
  overridden by `DEED_POLL_API_TIMEOUT_MS` so an operator sets one number. And the failure avoided is worse
  than a slow page — an abort lands after api may already have committed the row, leaving a document the
  caseworker was told failed and, since api has no document delete, nothing to remove it with.
- **api's developer-facing wording reached the error summary on the edit tab and the new-case form.** Both
  rendered `error.message` when a rejection named no field, and that message is `failureFromResponse`'s
  fallback — literally "deed-poll-api answered 400" — whenever api's failure body does not parse, which a
  proxy's HTML 400 guarantees. `.claude/rules/backend.md` forbids exactly this. Both now do what the upload
  page already did: log api's wording, render their own copy. Naming no field is what identifies the
  refusal as api's, since every local rejection attributes itself.
- **`callApi` was on `@hmcts/deed-poll`'s public surface**, via `export *`. It hands its caller an
  `ApiConfig` and lets it invoke any adapter function directly — the one seam the rules say nothing outside
  `api/deed-poll-api.ts` crosses — so a page could have reached api bypassing the domain layer and its
  error mapping. The index exports `Caller` and `deedPollApiStatus` by name now, which is all `apps/web`
  ever imported from that module.

Three test gaps the deletions opened, all closed:

- **The download route had no test at all**, and the nine assertions that covered the same logic went with
  `apps/api`'s wiring tests. Dropping the caller, the `no-store`, the disposition or the stream error handler
  would all have shipped green.
- **The multipart parser was the repo's only one and was untested** (25% statements), its twin's nine tests
  having gone the same way. The uncovered branch is exactly the one whose docblock records that propagating
  instead of stashing on `res.locals` produced a 500.
- **The zoneless date-time conversion was exercised by nothing.** `toUtcDate` exists because api's
  `LocalDateTime` carries no offset, and the mock serialised with `toISOString()` — so every test took the
  pass-through branch and deleting the conversion would have passed the suite while shifting every date by
  the local offset in a deployed non-UTC environment. The mock emits api's format now, and `wire.test.ts`
  pins the conversion directly.

Also: one assertion read `expect(result.ok && ….visible).toBe(false)`, which passes for a call that failed;
`client.test.ts` now resets the mock between tests rather than accumulating cases and reference serials; and
Playwright waits on the mock's `/health` instead of racing a backgrounded `yarn mock:api`.

**Test arithmetic: 1,188 → 1,229**, all additions. e2e unchanged at **16**.

The stale-prose sweep task 7 started went further: `apps/api` and `apps/postgres` are now referred to only in
the past tense, and the `.claude/` instruction files — which *generate* code rather than describing it — no
longer teach Prisma. `full-stack-engineer.md` had a Prisma data-access section and a schema-design section,
`module-scaffold` shipped a `schema.prisma.template`, `optimize.md` was a Prisma/PostgreSQL tuning guide, and
`infrastructure-engineer.md` still showed the three chart dependencies task 8 deleted along with
`postgres-url`. A stale doc misleads a reader; a stale instruction file writes the code back.

## Success criteria

- `yarn lint`, `yarn build` and `yarn test` all pass.
- No `@hmcts/postgres-prisma` anywhere. No `apps/api`, no `apps/postgres`, no `libs/postgres-prisma`, no
  Prisma migrations, no pg pool, no `DATABASE_URL`.
- Grepping for `prisma` in `apps/` and `libs/` returns nothing outside the conformance decision in task 7.
- Every case, note, witness and document operation goes through the single adapter, and nothing above it
  imports the wire types or the mock.
- Sessions are still in Redis, still local, and the call-site comment explaining why is still there.
- The readiness check names Redis and api, and no database.
- `yarn test:e2e` passes when run by hand against the mock.

## Out of scope for this plan

- **CCD and CDAM.** api's plans 02 and 03.
- **The deletes api still does not have** beyond notes: case delete, document delete, document-type writes,
  witness writes, and `validate`. `DEED_POLL_API_PLAN.md` records them as not rebuilt until something asks,
  and this app's UI does not offer them.
- **Sessions.** Redis, in plan 01, deliberately.
- **The pipeline cutover.** `01-jenkins-and-session-schema.md`.
- **Deploying anything.** This plan can be built and tested entirely against the mock; api being deployed is
  a separate dependency and does not gate the code.
