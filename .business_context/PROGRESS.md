# Migration progress — handover

Last updated: 2026-08-23. Plan: [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md).

**Next thing to pick up: Phase 3 — the JSON API.** Detail at the bottom.

## State

Branch `feat/deed-poll-migration`, 5 commits, **not yet pushed** and no upstream configured.

```
94e1715  Complete Phase 2: move the Prisma-backed services and conformance harness
4c81c16  Convert the class-validator DTOs to Zod schemas
c58e161  Move deed-poll domain logic into libs/deed-poll (part 1: pure modules)
a5e0d6e  Add the CCD decentralised-persistence ccd schema, vendored from the SDK
b17fac5  Port the deed-poll case model into the shared Prisma schema
```

`yarn lint`, `yarn build` and `yarn test` are all clean across the workspace (11 tasks).

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

## Phase 3 — the JSON API (next)

Move the 29 JSON handlers from the prototype's controllers into `apps/api/src/routes/` as
`simple-router` files. The domain functions they need all exist and are tested.

```
routes/deed-polls/index.ts            GET list, POST create
routes/deed-polls/field-rules.ts      GET
routes/deed-polls/[id].ts             GET, PATCH, DELETE
routes/deed-polls/[id]/validate.ts    POST
routes/deed-polls/[deedPollId]/notes/{index,[noteId]}.ts
routes/deed-polls/[deedPollId]/witnesses/{index,[witnessId]}.ts
routes/deed-polls/[deedPollId]/documents/{index,[documentId]}.ts
routes/document-types/{index,[id]}.ts
```

Source controllers to port (then delete):

| Prototype file | Handlers |
|---|---|
| `deed-poll/deed-poll.controller.ts` | 7 |
| `notes/notes.controller.ts` | 5 |
| `witnesses/witnesses.controller.ts` | 5 |
| `documents/documents.controller.ts` | 7 |
| `documents/document-types.controller.ts` | 5 |

Specific work:

1. **Error mapping.** `NotFoundError` → 404, `InvalidInputError` → 400 with its `errors` array in the
   body. This is new code; nothing does it yet.
2. **Validation per route.** Replace the global `ValidationPipe` with `safeParse` against the Zod
   schemas from `@hmcts/deed-poll`. Follow `libs/onboarding/src/onboarding/validation.ts` and the
   existing `apps/api/src/routes/onboarding/` handlers for shape.
3. **`RolesGuard` → Express middleware.** Keep the `Role` / `DEEDPOLL_ADMIN` model unchanged; only
   the extraction mechanism changes. `simple-router` supports handler arrays, so `@Roles(...)`
   becomes a middleware entry. Rewrite the 6 dropped `roles.guard.spec` tests against it.
   **The current scheme reads roles from the `x-user-roles` header — anyone can send
   `x-user-roles: deedpoll-admin` and become an admin.** Phase 3 should not entrench that; Phase 5
   replaces it with IDAM, and nothing should be deployed outside localhost until it has.
4. **Multer.** `uploadDocument` now takes a plain `UploadedFile` (`buffer`, `originalname`,
   `mimetype`, `size`) rather than `Express.Multer.File`. The app maps its upload middleware onto it.

Verification: `yarn test` must still show 441 in `libs/deed-poll` plus whatever the new route tests
add; `yarn lint` and `yarn build` clean; and exercise the handlers against a running app
(`docker compose up -d && yarn dev`), including `GET /api/deed-polls/field-rules` and
`POST /api/deed-polls/:id/validate`, which are the conditional-rule surface.

Phase 4 then moves the 12 SSR page handlers and 9 Nunjucks templates into `apps/web`, replacing
`nunjucks.setup.ts` entirely with `configureGovuk` from `@hmcts-cft/express-govuk-starter`.
`power_app_nest/` is deleted at the end of Phase 4, not before.

## Branch state

[`feat/deed-poll-migration`](https://github.com/hmcts/deed-poll-admin/tree/feat/deed-poll-migration)
is published with upstream tracking configured; 116 files, +9,800 lines. The diff was scanned for
secrets before publishing — no `.env`, keys or credential-shaped strings. The only hits were the
template's `SESSION_SECRET` placeholder and Helm `secretRef` names, which are references, not values.

**No PR is open, deliberately.** This is work in progress through Phase 2 of 6, so a PR would sit
open for weeks. Revisit once Track A is green.

## Dependency alerts on master

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

So this is fixable now with a targeted `yarn up -R` and no manifest changes — it is **not** work to
defer to Phase 4. Being remediated on a separate branch off master, deliberately kept out of the
re-platforming diff; this branch picks it up on its next rebase. Renovate PR #31
(`applicationinsights` 3.16.0) covers the largest cluster.
