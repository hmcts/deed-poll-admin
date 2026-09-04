# Phase 3 — the JSON API, slice by slice

Archived from `PROGRESS.md` on 2026-09-04. Phase 3 is complete (29/29 handlers) and this detail has
done its job: it exists so that the decisions inside each slice are recoverable, not because anyone
needs to read it to work on the service now.

**Read this only if you are changing one of the `apps/api` route files it describes.** The three
defects recorded here were each found by running the app rather than by writing a test, and each one
would be easy to reintroduce. `PROGRESS.md` keeps the summary and the live "Exercising the API
locally" recipe.

---

### Phase 3 foundations (done, `caf4e03`)

| File | What |
|---|---|
| `libs/deed-poll/src/errors.ts` | adds `ForbiddenError` and `zodErrorToFieldErrors`; `ConflictError` followed in slice 3 |
| `apps/api/src/errors.ts` | `errorHandler()`, mounted last in `app.ts` |
| `apps/api/src/auth/current-user.ts` | `userFromRequest` — header extraction then; **the headers are gone, see Phase 5** |
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

- **Header auth is opt-in by environment and fails closed.** *(History — Phase 5 deleted the header
  scheme outright. The polarity argument below outlived it and now lives in `plain-http.ts`.)* It is
  honoured only when `NODE_ENV` is
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

### Phase 3 slice 4: documents (done)

Seven handlers across four files, plus `apps/api/src/documents/upload.ts`. `apps/api` 175 → 219
tests, `libs/deed-poll` 475 → 477. **Phase 3 is complete: 29 of 29.**

#### What Multer actually does here

It is a body parser for **one** route. `app.ts` mounts `express.json()` and `express.urlencoded()`,
and neither parses `multipart/form-data`, so without it `POST .../documents/upload` would see an
empty `req.body` and no file. Multer puts the bytes on `req.file` and the accompanying text fields
(`documentTypeId`, `name`, `direction`) on `req.body`. The other six handlers are ordinary JSON.

- **Mounted per-route, as an array** — `export const POST = [uploadSingleFile(), handler]`, the shape
  `requireRoles` established. A global multipart parser would inspect bodies it can never be given.
- **Memory storage, not disk**, because `saveFile(buffer)` takes a `Buffer`. Disk storage would write
  a temp file for us to read straight back and write again, and would strand it on a failure path.
- **The `UploadedFile` mapping is the whole point.** `uploadDocument` takes a plain
  `{ buffer, originalname, mimetype, size }`, deliberately not `Express.Multer.File`, so the domain
  does not know Multer exists. Phase 2 built that seam; this slice is the four-field map onto it.

#### Two limits the prototype did not have

`FileInterceptor('file')` took no options: **any file, any size, buffered in memory**. Ported
faithfully that is a memory-exhaustion hole in a service that currently has no authentication, so it
was not ported.

- **10 MB** (`MAX_BYTES`), agreed with Steve on 2026-09-01. There was no existing limit anywhere in
  the repo or the prototype to inherit. **It is a defensible guess, not a researched number —
  confirm against real file sizes with the service team.** It matters more than it looks: the file is
  buffered in memory, so the worst case is 10 MB × concurrent uploads against the pod's limit.
- **An accepted-type list** — PDF, JPEG, PNG, TIFF, Word. **This is hygiene, not security:** it reads
  the `Content-Type` the client puts on the part, which a client can simply lie about. It stops
  accidents and obvious executables. Real inspection and virus scanning belong with CDAM in Phase 10.

Both refusals are translated at the source. Multer signals them with a `MulterError`, which is not a
domain error and would have become a 500 — the third instance of that trap, so `mapMulterError`
converts it to an `InvalidInputError` attributed to the `file` field.

#### Download hardening

`GET .../documents/:documentId/file` is the only route that does not answer JSON. Two changes over
the prototype:

- **The filename is sanitised, not just de-quoted.** `originalName` is whatever the uploading client
  called the file, so it lands on a response header as attacker-controlled text. The prototype
  stripped `"` and nothing else; a name containing `\r\n` would have produced an invalid header,
  which Node rejects by throwing mid-response — a 500 on a working download. Only a conservative
  character set survives, with a `document` fallback when nothing does. Pinned by a test that feeds
  `evil".pdf\r\nX-Injected: yes` and asserts no such header appears.
- **The stream's `error` event is forwarded to `next`.** Without it a mid-stream failure leaves the
  request hanging until it times out. Once bytes are sent no status change is possible, so
  `errorHandler` hands back to Express and the connection is destroyed — correct, because a truncated
  download is visible to the client where a 200 with half a file is not.

#### A third 500, exactly as predicted

The handover said to assume one, and there was one. `removeDocument`'s comment claimed *"Best-effort
blob cleanup"* while `await deleteFile(...)` propagated: the row was already deleted, so a failed
`unlink` turned a **completed** delete into a 500. The caller retries, gets a 404, and has no way to
tell the delete had in fact worked. Now genuinely best-effort — caught and logged with the document
id and storage key so the orphan is findable. An orphaned blob is recoverable and cheap; a status
code that contradicts what happened is neither.

That is three defects of one shape across four slices — an expected, caller-caused condition
reaching the error middleware as something it did not recognise. **All three were invisible to unit
tests on both sides and were found only by running the app.** Keep the "exercise it live" step.

#### Verified live, end to end

A real 41-byte PDF uploaded through multipart, written to `DATA_DIR/documents/<uuid>`, and downloaded
back **byte-identical** (sha256 match) with `Content-Type: application/pdf`,
`Content-Disposition: attachment; filename="birth.pdf"` and `Cache-Control: no-store`. Then: an 11 MB
file 400s naming the limit; an `.exe` 400s; no file at all 400s with the domain's own
`Select a file to upload`; a malformed `documentTypeId` 400s and a valid-but-absent one 404s; the
document's type could not be deleted while it referenced it (409, from slice 3); and deleting the
document removed both the row and the blob from disk, after which the download 404s.

### Phase 3 slice 3: document-types (done)

Five handlers in `apps/api/src/routes/document-types/`. `apps/api` 152 → 175 tests,
`libs/deed-poll` 465 → 475.

- **The only Phase 3 resource outside `routes/deed-polls/`.** Document types are global reference
  data — the list of things a supporting document can *be*, plus the marital statuses and case types
  each applies to — so they mount at the top level, while the documents referencing them will live
  under `/deed-polls/:id/documents`. There is no parent to scope against; the type's own id
  identifies it.

- **`DELETE` can answer 409, the only one in the phase.** Everything else in Phase 3 answers 200,
  201, 204, 400, 403 or 404.

- **`document-types.ts` had no unit tests before this**, only its Zod schemas. A Phase 2 gap rather
  than anything introduced here — the five domain functions were never covered. Now they are.

#### A second 500 for an ordinary action, same shape as slice 1's

`removeDocumentType` deleted straight through to Prisma. The `documentType` relation is required and
declares no `onDelete`, so Postgres refuses to orphan documents — but that refusal arrives through
the `PrismaPg` adapter as a **`DriverAdapterError`** carrying SQLSTATE **23001** on `err.cause.code`,
which is not a domain error, so `errorHandler` fell through to a generic 500. A caseworker deleting a
type that happened to be in use was told the server had broken.

The module's own docstring claimed this "surfaces as a 409-style failure". Nothing implemented that.
It does now:

- **`ConflictError`** added to `libs/deed-poll/src/errors.ts`, mapped to **409** in `apps/api`.
  Deliberately not `InvalidInputError`/400 — nothing about the input is wrong, and the same request
  succeeds unchanged once the references are gone. There is no field to blame, so no `errors` array.
- **`removeDocumentType` counts referencing documents itself** rather than catching the driver error.
  A count gives a message naming the number, which is actionable, and it does not depend on the
  driver's internal error shape — that would be fragile across a Prisma upgrade and would fail by
  silently reverting to 500.
- **Known, accepted gap:** a document created between the count and the delete still hits the FK and
  yields that 500. The window is tiny, the database refuses either way so integrity holds, and
  closing it would mean parsing the driver internals the check exists to avoid.

Verified live, both directions: deleting an in-use type answers
`409 {"error":"Cannot delete this document type: 1 document(s) still reference it"}` and the type
survives; once the referencing document is gone the same request answers 204; and a second delete
answers 404 rather than 409, so "already gone" and "still in use" stay distinct.

**This is the second defect of exactly this shape** — after slice 1's bare `Error` from
`yearFromDateReceived`. Both were expected, caller-caused conditions that reached the error
middleware as something it did not recognise, and both were invisible to unit tests on either side.
**When porting the `documents` handlers, assume there is a third**: check what every domain function
on that path throws, and confirm each one maps to a status a caller should see.

Phase 4 then moves the 12 SSR page handlers and 9 Nunjucks templates into `apps/web`, replacing
`nunjucks.setup.ts` entirely with `configureGovuk` from `@hmcts-cft/express-govuk-starter`.
`power_app_nest/` is deleted at the end of Phase 4, not before.

