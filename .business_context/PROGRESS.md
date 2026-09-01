# Migration progress — handover

Last updated: 2026-09-01. Plan: [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md).

**Next thing to pick up: Phase 3, the documents handlers (12 of the 29).** `deed-polls` (7) and
notes + witnesses (10) are done — 17 of 29. Documents were left last because they are the only ones
needing the Multer wiring, which is the remaining unsolved piece; `document-types` (5 of the 12) has
no upload in it and can go first. Read ["Phase 3 foundations"](#phase-3-foundations-done-caf4e03),
["Phase 3 slice 1"](#phase-3-slice-1-deed-polls-done) and
["Phase 3 slice 2"](#phase-3-slice-2-notes-and-witnesses-done) before writing a handler — between
them they settle every decision a handler should not be making for itself, and the documents service
has already been brought in line with the child-scoping rule in slice 2.

**Two tasks are parked, not questions** — see "Parked tasks" below. Neither blocks Phase 3.

## State

Branch `feat/deed-poll-migration`, 20 commits, pushed and tracking
`origin/feat/deed-poll-migration`. No PR, deliberately — see "Branch state".

```
(this session)  404 a child list when its parent case does not exist
2e41014  Scope the nested child writes to their parent case
14d3936  Port the notes and witnesses JSON handlers
1c23f72  Port the deed-polls JSON handlers and fix the reference-number error class
b1ef30c  Capture the four open questions as open questions
8ec90f2  Refresh the handover for the next session
31f290e  Make the header-auth bypass opt-in by environment rather than opt-out
290e5cf  Record the Phase 3 foundations in the handover docs
caf4e03  Add the Phase 3 foundations: error mapping and role middleware
0132bd4  Record PR #36 as merged and narrow the open item to the residue
ce73cc5  Merge master to pick up the refreshed lockfile
2b42a14  Point the dependency-alert note at the remediation PR
ae51462  Correct the dependency-alert note in the handover docs
9754a8d  Record the migration plan and progress in .business_context
94e1715  Complete Phase 2: move the Prisma-backed services and conformance harness
4c81c16  Convert the class-validator DTOs to Zod schemas
c58e161  Move deed-poll domain logic into libs/deed-poll (part 1: pure modules)
a5e0d6e  Add the CCD decentralised-persistence ccd schema, vendored from the SDK
b17fac5  Port the deed-poll case model into the shared Prisma schema
```

`yarn lint`, `yarn build` and `yarn test` are all clean across the workspace (11 tasks). Current test
counts, so a regression is obvious: `libs/deed-poll` **465**, `apps/api` **152**, `apps/postgres` 11
(they **pass** with `docker compose up -d`, and skip without it — CI has no database).

**Before running anything, Yarn needs sideloading** — Corepack cannot reach `repo.yarnpkg.com` from
the devcontainer. See the bullet under "Things a future session should not have to rediscover"; it
cost a chunk of a session to rediscover once already.

## Parked tasks

Answered by Steve on 2026-09-01: do these later, but **do not lose them**. Neither is a question
any more — the decision is "yes, just not now".

1. **Draft the CNP product-code question for Platform Operations.** Open item 1 in
   [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) — the oldest open item and the one with external lead
   time, so it wants sending well before Phase 6 rather than at it. The re-scaffold assumed team
   `deed-poll`, product `admin`; the old `Jenkinsfile_CNP` said `rpe` and was never updated, so
   there is no reliable source. It drives the ACR namespace, `aadIdentityName`, key vault names and
   `flexibleserver: deed-poll-preview`. **Deliverable: a drafted message for Steve to send**, not a
   code change.
2. **Check Renovate PR #31 (`applicationinsights` 3.16.0) merges cleanly and report.** It should
   carry `protobufjs@8.0.1` and so clear 11 of the 20 remaining advisories in one go. **Do not merge
   it unasked** — report only.

Decided and closed, recorded so they are not reopened:

- **Phase 3 is sliced**, not one pass: `deed-polls` (done) → notes + witnesses (done) → documents.
- **Prisma query logging stays on** under `yarn dev`. See Loose ends 3 for where to turn it off if
  it proves noisy.

## Done

### Phase 0 — hygiene

- `power_app_nest/` gitignored while it is staged in-tree. Its `node_modules` (498M), `dist`, `.env`
  and 57 document blobs were all committable before this.
- Bare `.env` and `.DS_Store` added to `.gitignore` — the template covered only `.env.local` and
  `.env.*.local`.
- `.business_context/dataverse_tables/` committed. These are the source-of-truth Dataverse exports;
  without them the schema-conformance suite cannot run. **Note they are alphabetically truncated**
  (A–R only, ending at "Refund Reference") despite declaring "Total columns: 70", so the harness
  asserts forward coverage only — every column present must map to a Prisma field — and must never
  be treated as a complete column set.

### Phase 1 — schema

`libs/postgres-prisma/prisma/schema/deed-poll.prisma`. Migrations re-baselined into one
(`apps/postgres/prisma/migrations/20260821194029_add_deed_poll_case_model`) rather than porting the
prototype's six, which were authored against Prisma 6 standalone.

Verified against local Postgres — 5 tables, 11 enums, 7 indexes — including the three things most
likely to have broken silently:

- `signaturerecieveddate`: the source column's misspelling is deliberate and is still mapped from the
  corrected TS name `signatureReceivedDate`.
- `Int[]` (`iShall`, `iHaveSubscribed`, `andAlsoMyOld`) round-trips through the `PrismaPg` adapter.
- `refundAmount` is `numeric(12,2)` and returns a `Decimal`.

### `ccd` schema (Track B groundwork)

`apps/postgres/ccd-runtime/` — the CCD decentralised-persistence runtime, **vendored verbatim** from
`ccd-config-generator` (upstream `b6bdfcde`, 2026-08-17). 25 SQL files, not the 4 the docs describe.
Read that directory's README before touching it. Two traps documented there and pinned by tests:

1. **`search_path` must include `ccd`.** The audit trigger inserts into `case_event_audit`
   *unqualified*, and plpgsql resolves that at execution time. A normal connection fails with
   `relation "case_event_audit" does not exist`. It only bites on `data` UPDATEs to `case_event`,
   never inserts — so it passes casual testing.
2. **`ccd.user_idam_id` must be set** in the transaction, or the trigger cannot attribute the row.

`migrate:reset` also drops the `ccd` schema now; Prisma only resets schemas in its own datasource, so
a reset previously left `ccd` populated with its history intact while `public` was empty.

### Phase 2 — domain layer

`libs/deed-poll/` — **25 suites, 441 tests**. The count reconciles exactly:

| | |
|---|---|
| Prototype | 17 suites / 269 tests |
| Not migrated: `auth/roles.guard.spec` | 6 tests — a Nest guard being replaced by Express middleware, rewritten in Phase 3 |
| Domain tests migrated | **263** |
| New Zod schema tests | 37 |
| Conformance | 141 |
| **Total** | **441** |

No domain test was dropped and **the assertions are unchanged** — the mocked Prisma client is aliased
back to `prisma` so every spec body still verifies what it did under Nest DI. In the deed-poll service
only the database is mocked; the four helper modules are the real implementations, as they were when
registered as DI providers.

What changed in the move:

- Nest removed. Stateless `@Injectable()` classes became modules of exported functions.
- CommonJS → ESM (`.js` specifiers), Jest → Vitest, `@prisma/client` → `@hmcts/postgres-prisma`.
- HTTP concerns out of the domain: `NotFoundException` / `BadRequestException` → `NotFoundError` /
  `InvalidInputError` in `libs/deed-poll/src/errors.ts`. The route layer maps them to status codes —
  **that mapping is Phase 3 work and does not exist yet.**
- 10 class-validator DTOs → 4 Zod schema modules with `.partial()` counterparts.

## Things a future session should not have to rediscover

- **`libs/deed-poll` exports entity-specific names**, not `create`/`findAll`/`findOne`. Those
  collided across five modules once barrel-exported. It is `createWitness`, `findNotes`,
  `updateDeedPoll`, `getCaseFieldRules`, and so on.
- **`InvalidInputError` carries `FieldError[]`**, not just a message. The prototype threw
  `BadRequestException({ message, errors })` and the SSR forms render those errors against individual
  inputs. Phase 3/4 must surface them, or field-level validation silently becomes unattributed.
- **Zod nullability is deliberate.** Nullable columns use `.nullish()` so a PATCH can clear a value;
  the eight with Prisma defaults (`privacy`, `urgency`, the three `int[]` multiselects, the three
  booleans) use `.optional()`, so `null` fails validation instead of reaching Prisma. Tests assert
  both directions.
- **Dates stay ISO strings through validation.** The domain coerces them to `Date` immediately before
  Prisma, and the SSR forms submit `YYYY-MM-DD`. The schema accepts bare dates, UTC, offset and
  local-without-zone; it rejects `01/03/2026`.
- **`createNoteSchema` trims and delegates to `validateNoteText`.** Both are load-bearing: without
  the trim, `"   "` is accepted as a note and whitespace is stored.
- **Corepack cannot reach `repo.yarnpkg.com` from the devcontainer.** Yarn 4.17.0 has to be
  sideloaded: `npm pack @yarnpkg/cli-dist@4.17.0`, extract, then run
  `node <extracted>/bin/yarn.js`. Also `enableScripts` defaults to false here, so `YARN_ENABLE_SCRIPTS=true`
  is needed for Prisma's postinstall.
- **The `ccd` schema tests skip when no database is reachable** — CI has no Postgres. Run
  `docker compose up -d` locally to exercise them.

## Phase 3 — the JSON API (in progress)

**Foundations are done** (`caf4e03`), **the `deed-polls` slice is done** (7 handlers) and **notes +
witnesses are done** (10). 12 remain, all of them documents. See "Phase 3 foundations", "Phase 3
slice 1" and "Phase 3 slice 2" below.

Move the 29 JSON handlers from the prototype's controllers into `apps/api/src/routes/` as
`simple-router` files. The domain functions they need all exist and are tested.

```
routes/deed-polls/index.ts                        ✅ GET list, POST create
routes/deed-polls/field-rules.ts                  ✅ GET
routes/deed-polls/[id].ts                         ✅ GET, PATCH, DELETE
routes/deed-polls/[id]/validate.ts                ✅ POST
routes/deed-polls/[id]/notes/{index,[noteId]}.ts       ✅ GET/POST, GET/PATCH/DELETE
routes/deed-polls/[id]/witnesses/{index,[witnessId]}.ts ✅ GET/POST, GET/PATCH/DELETE
routes/deed-polls/[id]/documents/{index,[documentId]}.ts
routes/document-types/{index,[id]}.ts
```

**Note the nested paths use `[id]`, not the `[deedPollId]` earlier revisions of this table showed.**
See slice 2 below for why.

Source controllers to port (then delete):

| Prototype file | Handlers | |
|---|---|---|
| `deed-poll/deed-poll.controller.ts` | 7 | ✅ ported |
| `notes/notes.controller.ts` | 5 | ✅ ported |
| `witnesses/witnesses.controller.ts` | 5 | ✅ ported |
| `documents/document-types.controller.ts` | 5 | ⬅ next — no upload, so no Multer dependency |
| `documents/documents.controller.ts` | 7 | ⬅ last — needs the Multer wiring |

None of the ported controllers are deleted yet; `power_app_nest/` goes as a whole at the end of
Phase 4.

Specific work:

1. ✅ **Error mapping.** Done — see below.
2. ⬅ **Validation per route.** Replace the global `ValidationPipe` with `safeParse` against the Zod
   schemas from `@hmcts/deed-poll`. `zodErrorToFieldErrors` and the 400 mapping are in place, so a
   handler can simply `throw parsed.error` on a failed `safeParse`. **Copy the four `deed-polls`
   route files for shape** — they are the worked example now, and they are a better guide than
   `routes/onboarding/`, which try/catches per handler and predates the error middleware.
3. ✅ **`RolesGuard` → Express middleware.** Done — see below.
4. ⬅ **Multer.** `uploadDocument` now takes a plain `UploadedFile` (`buffer`, `originalname`,
   `mimetype`, `size`) rather than `Express.Multer.File`. The app maps its upload middleware onto it.

Verification: `yarn test` must show at least 465 in `libs/deed-poll` and 152 in `apps/api` plus
whatever the new route tests add; `yarn lint` and `yarn build` clean; and exercise the handlers
against a running app — see the recipe under "Exercising the API locally" below, which is worth
following rather than improvising, because two of the four things in it cost time to work out.

### Exercising the API locally

```
docker compose up -d                                   # Postgres; also un-skips apps/postgres tests
YARN_ENABLE_SCRIPTS=true <yarn> db:migrate             # sideloaded yarn — see the note above
cd apps/api && NODE_ENV=development ../../node_modules/.bin/tsx src/server.ts
```

- **The paths have no `/api` prefix.** It is `GET /deed-polls`, not `GET /api/deed-polls` — see
  slice 1 below for why. Earlier revisions of this file said `/api/...` throughout and were wrong.
- **Startup takes ~20 seconds**, nearly all of it one Azure Key Vault DNS lookup timing out
  (`getaddrinfo EAI_AGAIN deed-poll-aat.vault.azure.net`). Two `Warning:` lines about the vault and
  `/mnt/secrets` are expected and harmless. Poll `/health` rather than guessing a sleep.
- **Send `x-user-roles: deedpoll-admin`** to act as an admin. `NODE_ENV=development` is what makes
  the header honoured at all; under any other value every caller has no roles.
- Local writes consume reference-number serials permanently, so `KBDP2026-…` will not start at
  00001 on a database that has been exercised. That is the counter working, not a bug.

### Phase 3 foundations (done, `caf4e03`)

| File | What |
|---|---|
| `libs/deed-poll/src/errors.ts` | adds `ForbiddenError` and `zodErrorToFieldErrors` |
| `apps/api/src/errors.ts` | `errorHandler()`, mounted last in `app.ts` |
| `apps/api/src/auth/current-user.ts` | `userFromRequest` — header extraction, the Phase 5 seam |
| `apps/api/src/auth/require-roles.ts` | `requireRoles(...)`, replacing `RolesGuard` |

Two decisions worth not relitigating:

- **Error mapping is app-level middleware, not try/catch per route**, which is what
  `.claude/rules/backend.md` illustrates. `app.ts` already had a catch-all error handler, so this
  extends it rather than adding a pattern. It means the 29 handlers cannot disagree about what a
  missing case returns, and a handler that forgets to catch cannot leak a stack trace as a 500.
  Handlers may still catch locally for bespoke cases. **A guarded route restricts itself by exporting
  an array** — `export const DELETE = [requireRoles(DEEDPOLL_ADMIN), handler]` — which is how
  `simple-router`'s `normalizeHandlers` expects a multi-handler route.

  This depends on Express 5 forwarding a rejected handler promise to error middleware, which Express
  4 did not. `apps/api/src/errors.wiring.test.ts` drives that through a real router with `supertest`
  so a regression cannot hide behind unit tests that call `errorHandler` directly. **Do not delete
  that file** on the grounds that it duplicates `errors.test.ts` — it is testing the framework
  contract, not the mapper.

- **Header auth is opt-in by environment and fails closed.** It is honoured only when `NODE_ENV` is
  `development` or `test` (`HEADER_AUTH_ENVIRONMENTS` in `current-user.ts`). Anywhere else the
  `x-user-roles` and `x-user-name` headers are ignored, every caller resolves to no roles, and
  guarded routes return 403 — with one log line naming the `NODE_ENV` actually seen, since an
  unexpected or absent value is the likeliest cause.

  **The allowlist polarity is deliberate and should not be "corrected" to match the codebase.**
  Everything else here asks `NODE_ENV === "production"` and treats all other values as development.
  That default-open reading is right for a log level and wrong for an authorisation bypass: it would
  leave the bypass live for anything that merely is not the literal string `production` — an unset
  variable, a Helm `env:` override, `node dist/server.js` run outside the image, or a deployed
  environment named `aat`. Tests pin all four cases.

  `apps/api` and `apps/web` now set `NODE_ENV=development` in their `dev` scripts, mirroring the
  root's `start:api` / `start:web` which already state `production`. Previously dev relied on the
  variable being unset, which an allowlist cannot read as consent. Side benefit: it revives
  `libs/postgres-prisma/src/index.ts:34`, whose `=== "development"` query logging never fired.

  None of this makes the service deployable — Phase 5 still gates that, and **unguarded routes remain
  open regardless**, since the check only runs where `requireRoles` is mounted. It removes the worst
  failure mode: deployed early, appears to work, anyone is an admin. Phase 5 replaces
  `current-user.ts` wholesale.

The 6 tests dropped from `roles.guard.spec` are rewritten and accounted for. The guard's two
"open route" cases (no `@Roles` metadata, empty roles array) collapse into one: in Express an
unguarded route is simply one that does not mount the middleware, so only `requireRoles()` with no
arguments remains testable.

### Phase 3 slice 1: deed-polls (done)

Seven handlers across four files, plus `apps/api/src/express-doubles.ts`. `apps/api` went 71 → 110
tests; `libs/deed-poll` 450 → 452 (the reference-number fix below).

Five decisions the remaining 22 handlers should follow rather than re-derive:

- **The routes are `/deed-polls`, not `/api/deed-polls`.** Earlier revisions of this file said
  `/api/...`; that was carried over from the prototype's `@Controller('api/deed-polls')` and is
  wrong here. `apps/api/src/app.ts` mounts `createSimpleRouter({ path: .../routes })` with no
  prefix, matching the template's own `/users` and `/onboarding`. The prototype needed the prefix
  because one Nest app served both the API and the SSR pages; here `apps/api` and `apps/web` are
  separate apps on separate ports, so prefixing every route with `/api` inside the app called `api`
  says nothing. Verified against a running server: `/api/deed-polls` 404s, `/deed-polls` 200s.

- **No role middleware, deliberately.** `RolesGuard` was registered globally in the prototype but
  **no handler anywhere carried `@Roles(...)`** — checked across all five controllers — so every
  ported route is open, exactly as it was. The real privilege check is `isAdmin` inside
  `createDeedPoll`/`updateDeedPoll`, which decides whether a `privacy` value is honoured or silently
  dropped. Do not add `requireRoles` to a ported route without deciding that as a policy change:
  it would be new behaviour, not a port. **Whether `DELETE` should be admin-only is a real question
  and the prototype does not answer it** — see Loose ends 5.

- **`userFromRequest(req)` is the whole of the user plumbing.** It returns `{ roles, isAdmin, name }`.
  `deed-polls` passes `{ isAdmin, userName: name }`; `notes` needs only `{ userName: name }`
  (`notes.controller.ts:27,50`); `witnesses` and `documents` take no user context at all. There is
  no wrapper helper and there should not be one — the shapes genuinely differ.

- **Query parameters get validated too, not just bodies.** `field-rules.ts` parses `req.query`
  against a small local `z.object`. The prototype's `@Query('type')` was *typed* `DeedPollType` but
  never validated, so `?type=nonsense` — or a repeated `?type=a&type=b`, which Express parses as an
  array — reached the rule matrix, fell through its `default:` branch, and answered **200 with the
  rules for no type at all**. A wrong answer presented as a right one. It is a 400 now.

- **Route-ordering and mounting are pinned by a wiring test**, `routes.wiring.test.ts`, which builds
  a real `createSimpleRouter` over the real directory. `/deed-polls/field-rules` and
  `/deed-polls/:id` both match `GET /deed-polls/field-rules`; it resolves correctly only because
  `sortRoutes` orders by parameter count, which nothing in `field-rules.ts` can state. Every unit
  test in the directory would still pass if that ordering changed while the live endpoint began
  reading the string "field-rules" as a case id. **Add to that file rather than duplicating it** when
  the notes/witnesses/documents routes land — they nest two parameters deep and are more exposed to
  the same class of problem, not less.

`express-doubles.ts` holds the shared `requestDouble`/`responseDouble`. It models `req.header(name)`
as a function rather than a `headers` object, because `userFromRequest` reads headers that way and a
naive double would let a test pass while the real thing found nothing. It is **excluded from the
build in `apps/api/tsconfig.json`** — it imports `vitest`, so it must not reach `dist`.

#### One defect found, in the domain rather than the routes

`yearFromDateReceived` in `libs/deed-poll/src/deed-poll/reference-number.ts` threw a **bare `Error`**
when `dateReceived` was absent. `errorHandler` cannot recognise a bare `Error`, so it fell through to
the generic 500 — meaning `POST /deed-polls` with no Date Received, which is the single most obvious
request anyone makes of this API, answered `{"error":"Internal server error"}`. Now an
`InvalidInputError` carrying a `dateReceived` field error, so it is a 400 the Phase 4 forms can
render against the right input. Pinned in both places: `reference-number.test.ts` for the type and
the attribution, and `routes.wiring.test.ts` for the status a caller actually sees.

This was invisible to unit tests on both sides — the domain tests asserted a bare untyped
`toThrow()`, and the error-mapping tests only ever fed the handler errors it already knew. **Only
running the thing found it**, which is the argument for keeping the "exercise against a running app"
step in the verification list for each remaining slice.

Its docstring also claimed the year fell "back to created-now", which the code has never done. The
throw is right — inventing a year from the clock would put a case in the wrong year's permanent,
external-facing serial sequence — so the comment was corrected to match the code, not the reverse.

### Phase 3 slice 2: notes and witnesses (done)

Ten handlers across four files, under `apps/api/src/routes/deed-polls/[id]/{notes,witnesses}/`.
`apps/api` 110 → 149 tests. No domain change was needed — both services were already
parent-scoped and already threw `NotFoundError`, so the handlers are genuinely thin.

- **Nested under `[id]/`, not `[deedPollId]/`.** Earlier revisions of the route table above said
  `[deedPollId]`, copied from the prototype's `@Controller('api/deed-polls/:deedPollId/notes')`. Nest
  needed a distinct name because the parent segment is part of the controller's own path string;
  here the parent segment *is* the directory, and `[id]/` already existed for `validate.ts`. Two
  sibling parameter directories naming the same URL position would both work — `discoverRoutes` keys
  on the URL path, so there is no conflict raised — but it would read as an accident by whoever
  arrives next. So it is `req.params.id` for the case and `req.params.noteId` /
  `req.params.witnessId` for the child, everywhere.

- **Both ids go into every child call.** `findNote`/`findWitness` match on `{ id, deedPollId }`, so
  a child id belonging to another case answers 404. Passing only the child id would compile and
  would quietly make every note in the database reachable through any case's URL. Verified against
  a running app on all three verbs: reading, patching and deleting a note through the wrong case's
  URL all 404, and the note was still intact afterwards. **The write paths are scoped twice** — see
  below.

- **Notes take `{ userName }` only; witnesses take no user context at all.** Notes have
  `createdBy`/`modifiedBy` columns to stamp; `DeedPollWitness` has neither, and `createWitness`
  accordingly has no author parameter. Neither takes `isAdmin` — there is no privileged field on
  either, so passing it would imply a rule that does not exist. Pinned by tests in both directions,
  because "we forgot to pass the user" and "there is deliberately no user here" look identical in a
  diff.

- **Witnesses reject an empty body where cases accept one.** `createWitnessSchema` requires all four
  fields; `createDeedPollSchema` requires none. Not an inconsistency — a case is logged
  incrementally through its lifecycle, a witness is entered once from a form that has all of it.

- **`routes.wiring.test.ts` gained a second `describe` block** rather than a second file. The case
  routes' trap is route *ordering*; the nested routes' trap is parameter *binding*, which the unit
  tests structurally cannot catch because the request double supplies whatever params the test names.
  A handler that read the parent's id for the child, or swapped the two, passes its own unit test.

#### Child scoping: the write paths carry `deedPollId` too

**There was never a traversal hole here** — reads have always filtered on `{ id, deedPollId }`, and
the write paths have always run a scoped `findNote`/`findWitness`/`findDocument` guard first. Do not
read the change below as a fix for a vulnerability; nothing was exploitable, and cross-case access
was verified closed on all three verbs before it.

What it changes is where the safety *lives*. The writes used to be:

```ts
await findNote(deedPollId, id);                     // scoped guard
prisma.deedPollNote.update({ where: { id }, ... })  // write scoped by nothing
```

Correct, but by convention: one guard line, repeated in six places across three services. A seventh
`updateX` that omitted it would be an unscoped write, and **no existing test would have failed** —
which is the actual risk, since two more slices of nested handlers were about to be written against
this pattern. The writes now carry the parent as well:

```ts
prisma.deedPollNote.update({ where: { id, deedPollId }, ... })
```

Prisma allows a non-unique filter alongside the unique `id` (`DeedPollNoteWhereUniqueInput` accepts
`deedPollId`), so this costs nothing and does not change the return shape the way `updateMany` would.
Applied to all three services — notes, witnesses **and documents**, so the documents slice inherits
it rather than repeating the argument.

**Verified that Prisma enforces the filter rather than ignoring it**, because if it ignored it the
change would be theatre and the guard would still be the only defence. Driven directly against
Postgres with no guard in front: `update` and `delete` with a mismatched `deedPollId` both fail
`P2025` and the row is untouched. The happy path was re-checked too — that was the way this change
could have broken everything, if Prisma had rejected the extended `where` at runtime.

The guard stays, and is still what produces the clean 404: `P2025` is not a domain error, so
`errorHandler` would map it to a generic 500. That is deliberate rather than a gap — the guard always
runs first, so a `P2025` reaching the mapper means a missing guard or a genuine race, and a loud 500
with a logged stack is the honest answer to a bug. Mapping `P2025` to 404 would hide exactly the
mistake this is meant to catch.

Domain tests went 452 → 456: the four that asserted `where: { id }` exactly now assert both ids, and
`updateWitness`/`updateDocument` gained the scoped-write and wrong-parent cases they never had.

#### Child lists 404 for a missing parent

`findNotes`/`findWitnesses`/`findDocuments` filtered by `deedPollId` without checking the parent
existed — exactly as the prototype's `findAll` did, since only the create paths called
`assertCaseExists`. So `GET /deed-polls/<typo>/notes` answered `[]` with 200.

That conflates two different facts: **"there is no such case"** and **"this case has no notes"**. Only
one of them is true, the response is identical either way, and the caller has no way to tell them
apart — so a mistyped case id reads as a case with no notes. A child collection has no meaning
without its parent, so the parent's absence is the more important fact and the one to report.

All three list functions now `await assertCaseExists(deedPollId)` first. That is the same check every
create in the same files already made, so the fix is consistency rather than a new pattern — the cost
is one indexed primary-key lookup per list.

Considered and rejected: checking the parent *only when the list comes back empty*, which is free in
the common case because the `onDelete: Cascade` FK means rows existing proves the parent exists. It
is correct, but it makes three functions behave differently from the six creates beside them to save
a sub-millisecond lookup on a page load. Not worth the inconsistency.

Both directions are pinned by tests and were verified live, because a fix like this is one careless
`if` away from 404ing every legitimately-empty list: a missing case 404s with the case id in the
message, and a real case with no children still answers `[]` with 200. `documents` has no HTTP route
yet, so it is covered by domain tests only until that slice lands.

Phase 4 then moves the 12 SSR page handlers and 9 Nunjucks templates into `apps/web`, replacing
`nunjucks.setup.ts` entirely with `configureGovuk` from `@hmcts-cft/express-govuk-starter`.
`power_app_nest/` is deleted at the end of Phase 4, not before.

## Loose ends

Small, real, and deliberately not done. None blocks Phase 3.

1. **Upstream the async-handler wrap into the template, once Phase 3's handlers exist.** The error
   mapping depends on Express 5 forwarding a rejected handler promise to error middleware.
   `normalizeHandlers` in `@hmcts-cft/simple-router` is the natural chokepoint to guarantee it
   instead of relying on framework behaviour — it is currently just
   `Array.isArray(x) ? x : [x]`, and upstream's copy at `hmcts/expressjs-monorepo-template` is
   byte-identical, so a patch applies cleanly.

   **Do not patch it locally.** `libs/simple-router` is template-provided (`@hmcts-cft/` scope,
   arrived wholesale in the re-scaffold `82e8b0d`). This repo was re-scaffolded on 2026-08-21 and
   will be again; a local patch would either be silently dropped or land as a conflict. Contribute it
   upstream so every service on the template benefits. Deferred until the 29 handlers are written,
   because they are the argument for the change.

   One trap for whoever writes it: **Express distinguishes error middleware by `fn.length`**, so a
   naive variadic wrapper (arity 0) would silently reclassify every 4-arg error handler as a normal
   one. `simple-router` already arity-checks (`>= 2 && <= 4`) for this reason. The wrapper must
   declare parameters explicitly and branch on the original's arity.

   The risk this mitigates is currently low: `apps/api` and `apps/web` pin `express` **exactly** at
   `5.2.1`, so the behaviour cannot drift away via semver or a lockfile refresh — it needs a
   deliberate major bump, which `errors.wiring.test.ts` would fail on. That is the intended signal.

2. **`libs/deed-poll/package.json` declares `"tsx": "*"` and `"vitest": "*"`.** Wildcards, which
   `CLAUDE.md` forbids ("Pinned dependencies: specific versions only"). Pre-existing on this branch,
   unrelated to any of the above. Root pins `vitest` at `4.1.10`; match it.

3. **Prisma query logging is now live under `yarn dev`.** Setting `NODE_ENV=development` revived
   `libs/postgres-prisma/src/index.ts:34`, which had never fired. If it proves noisy that line is the
   place to look, and `CLAUDE.md`'s `DEBUG=prisma:query` suggestion is now redundant rather than
   necessary.

4. **`power_app_nest/` is untracked but *not* ignored on master.** The Phase 0 `.gitignore` entry
   exists only on this branch. Harmless while working here, but on master a stray `git add -A` would
   try to commit ~498M of `node_modules` and 57 document blobs. Cherry-picking that one `.gitignore`
   line to master would close it.

5. **Nothing restricts who can delete a case, and the delete cascades.** `DELETE /deed-polls/:id` is
   open — faithfully, because the prototype guarded nothing. **The cascade is confirmed, not assumed:**
   deleting a case with a note left zero rows in `deedpoll_notes`, checked directly against Postgres.
   So one unauthenticated request destroys a case and all its children. Raised as a question, not a
   fix: `requireRoles(DEEDPOLL_ADMIN)` would be one line
   (`export const DELETE = [requireRoles(DEEDPOLL_ADMIN), handler]`), but whether a caseworker may
   delete a case, and whether deletion should be soft given `retainPermanently` exists in the schema,
   is a business decision. Worth settling before Phase 5, since after Phase 5 the answer becomes an
   IDAM role mapping rather than a code change. The same question applies to the nested
   `DELETE .../notes/:noteId` and `.../witnesses/:witnessId`.

6. **A create can never succeed without `dateReceived`, but the schema calls it optional.**
   `createDeedPollSchema` marks every field optional on the stated grounds that a case is logged
   incrementally — yet `allocateForCreate` cannot derive a reference-number year without
   `dateReceived`, so a create omitting it now fails with a 400 (see slice 1). That is honest, but
   the constraint is discovered a transaction late rather than declared. Making `dateReceived`
   required on `createDeedPollSchema` — and only there, leaving the update schema partial — would
   surface it at parse time and make the API self-documenting. Not done unasked: it changes a schema
   the conformance harness and the Phase 4 forms both read, so it wants a deliberate look rather than
   being smuggled in with a route port.

7. ~~**A child list under a non-existent case answers `[]` with 200, not 404.**~~ **Fixed
   2026-09-01** — see "Child lists 404 for a missing parent" under Phase 3 slice 2.

## Branch state

[`feat/deed-poll-migration`](https://github.com/hmcts/deed-poll-admin/tree/feat/deed-poll-migration)
is published with upstream tracking configured; 138 files, +12,060 lines against master as of
2026-09-01. The diff was scanned for secrets before publishing — no `.env`, keys or credential-shaped
strings. The only hits were the template's `SESSION_SECRET` placeholder and Helm `secretRef` names,
which are references, not values.

**No PR is open, deliberately.** This is work in progress through Phase 2 of 6, so a PR would sit
open for weeks. Revisit once Track A is green.

## Dependency alerts on master

**Resolved 2026-08-23** — [PR #36](https://github.com/hmcts/deed-poll-admin/pull/36) is merged
(`8bf8563`) and this branch has merged master to pick it up (`ce73cc5`). Kept for the reasoning, and
because the residue below is still live. History, in case the numbers are ever questioned again:

**Do not repeat the mistake this section replaces.** An earlier note in this file claimed the 97
Dependabot alerts were an artefact of the migration branch adding dependencies "to a tree that still
contains the old lockfile entries on master", and would "drop sharply once `power_app_nest/` is
deleted at the end of Phase 4". That is wrong in three ways, checked on 2026-08-23:

- **`power_app_nest/` has never been tracked.** Zero files on `origin/master`, and no commit on any
  branch has ever touched the path. Its dependencies were never in the tracked lockfile, so deleting
  the directory at the end of Phase 4 cannot change the alert count.
- **There is one tracked lockfile**, root `yarn.lock`, on both master and this branch.
- **Alerts are computed against the default branch.** This branch's lockfile change is not on
  master, so the count is master's and is unaffected by the migration either way.

The real cause of the 82 → 97 jump is the re-scaffold itself. `82e8b0d` (PR #23) replaced master's
`yarn.lock` wholesale with the template's, and it is the only change to that file on master since the
2026-08-20 Renovate bumps. The template pulls in `applicationinsights` (`libs/cloud-native-platform`),
and with it `@opentelemetry/otlp-transformer` → `@grpc/proto-loader` → `protobufjs`, plus
`@grpc/grpc-js`. That cluster alone accounts for 11 of the 41 high alerts and one of the two criticals.

Composition: 2 critical, 41 high, 49 medium, 5 low. Concentrated in a handful of transitive roots —
`protobufjs` 11, `tar` 5, `fast-uri` 5, `brace-expansion` 3.

Most of it is a stale-lockfile artefact rather than a dependency the workspace actually pins, because
the declared ranges already admit the patched versions:

| Package | Locked | First patched | Range in lockfile |
|---|---|---|---|
| `protobufjs` | 7.5.4 | 7.5.5 | `^7.5.3` — a refresh resolves it |
| `tar` | 7.5.9 | 7.5.21 | `^7.4.3` — a refresh resolves it |
| `@grpc/grpc-js` | 1.14.3 | 1.14.4 | `^1.14.3` — a refresh resolves it |
| `protobufjs` | 8.0.1 | 8.6.6 | pinned exact; needs its dependent bumped |

So this was fixable with a targeted `yarn up -R` and no manifest changes — it was **not** work to
defer to Phase 4.

**Remediated in [PR #36](https://github.com/hmcts/deed-poll-admin/pull/36)**, merged to master on
2026-08-23 from `chore/refresh-lockfile-security` — deliberately kept out of the re-platforming diff.
`yarn npm audit --all --recursive` went from 99 advisories (2 critical, 41 high, 51 moderate, 5 low) to
20 (0 critical, 7 high, 13 moderate), lockfile-only, with lint, build and test clean. This branch
merged master at `ce73cc5` and audits at the same 20; `libs/deed-poll` is unchanged at 441 tests.

The 20 that remain are pinned by their dependents rather than by us, so each needs the dependent
bumped. **11 of them are a single `protobufjs@8.0.1`**, pinned exactly by the OpenTelemetry stack under
`applicationinsights`; Renovate PR #31 (`applicationinsights` 3.16.0) should carry it. Two are not
vulnerabilities at all — `@types/config` is a stub package that `config` supersedes (delete the
dependency from `apps/api` to clear it), and `tsconfck` is merely flagged unmaintained.
