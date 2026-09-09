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
| Why sessions are excluded | `docs/plans/01-jenkins-and-session-schema.md`, task 2 |

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

- [ ] Delete `apps/api` and its tests. Nothing consumes it
- [ ] Delete `apps/postgres`, `libs/postgres-prisma`, and the migrations under `apps/postgres/prisma/migrations/`
- [ ] Remove the pg pool from `apps/web/src/app.ts` and the `@hmcts/postgres-prisma` dependency from every `package.json` that names it
- [ ] **Re-point the readiness check.** `deedPollDatabaseChecks()` goes; what replaces it is Redis — already added in plan 01 — plus a check that api answers. A probe that goes green while api is unreachable is worse than no probe, because Kubernetes will send traffic to a pod that cannot serve a single case page
- [ ] `yarn install --immutable` afterwards
- [ ] Mark completed

### Task 6: Note deletion, once api has the endpoint

- [ ] Confirm `DELETE /caseworker/cases/{id}/notes/{noteId}` exists in api and is in its published spec
- [ ] Wire it through the adapter and restore the note form's delete branch
- [ ] Keep the existing behaviour exactly: delete is checked **before** validation, so a note whose text would fail validation can still be deleted, and only the literal `"delete"` deletes — a missing `action` falls through to save and is never destructive. All three are pinned by tests today; they must still be
- [ ] Mark completed

### Task 7: Decide the conformance harness's home

- [ ] `libs/deed-poll/src/conformance` proves the Dataverse columns were not silently dropped, and it reads the Prisma schema — which task 5 deleted. It cannot stay as it is
- [ ] Two options, and this is a decision to record rather than guess: **re-point it at api's schema** (it belongs with the thing that owns the columns, and api already has its own conformance suite it could join), or **retire it here** and rely on api's
- [ ] Whichever is chosen, carry its caveat: the Dataverse exports are **alphabetically truncated (A–R)**, so it asserts forward coverage only and must never be read as a complete column set
- [ ] Do not silently delete it. It is the correctness argument for the whole migration
- [ ] Mark completed

### Task 8: Charts, config and the record

- [ ] Remove `postgres-url` / `DATABASE_URL` from all four `values.yaml`. This app no longer has a database
- [ ] Add whatever api's base URL and S2S credential require. **This is a real outstanding dependency, not an optional one** — see `deed-poll-web/docs/external-dependencies.md`, which tracks the same requirement for the other frontend
- [ ] Update `CLAUDE.md`: no Prisma, no database, no migrations. The Database Operations commands go
- [ ] Update `.business_context/PROGRESS.md` and `DEED_POLL_API_PLAN.md` to record the cutover as done
- [ ] Mark completed

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
