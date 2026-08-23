# Migration progress — handover

Last updated: 2026-08-23. Plan: [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md).

**Next thing to pick up: Phase 3, the 29 route handlers.** The Phase 3 foundations they depend on are
already in. Start at ["Phase 3 — the JSON API"](#phase-3--the-json-api-in-progress); read
["Phase 3 foundations"](#phase-3-foundations-done-caf4e03) before writing a handler, because two
decisions there change how a handler is written.

**Four questions are open with Steve** — see "Questions waiting on Steve" below. Each has a stated
default, so none of them blocks starting.

## State

Branch `feat/deed-poll-migration`, 13 commits, pushed and tracking
`origin/feat/deed-poll-migration`. 127 files, +10,648 lines against master. No PR, deliberately —
see "Branch state". Working tree clean as of 2026-08-23.

```
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
counts, so a regression is obvious: `libs/deed-poll` **450**, `apps/api` **71**, `apps/postgres` 11
skipped (no database in CI — `docker compose up -d` to run them).

**Before running anything, Yarn needs sideloading** — Corepack cannot reach `repo.yarnpkg.com` from
the devcontainer. See the bullet under "Things a future session should not have to rediscover"; it
cost a chunk of a session to rediscover once already.

## Questions waiting on Steve

Raised at the end of the 2026-08-23 session and **not yet answered**. Each has a default so nothing
is blocked; ask, but proceed on the default if there is no answer.

1. **Confirm the CNP product code with Platform Operations.** Open item 1 in
   [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) — the oldest open item and the one with external lead
   time, so it wants starting well before Phase 6 rather than at it. Offered to draft the question for
   Steve to send. *Default: raise it at the start of Phase 6 work, which is late but not fatal.*
2. **Renovate PR #31 (`applicationinsights` 3.16.0)** would clear 11 of the remaining 18 alerts in one
   go — the whole `protobufjs` cluster. It is open and unreviewed. *Default: check it merges cleanly
   and say so, do not merge it unasked.*
3. **How to slice Phase 3.** Recommendation was: `deed-polls` first (7 handlers, and it contains
   `field-rules` and `validate`, the conditional-rule surface and the riskiest part), then
   notes and witnesses, then documents last because they need the Multer wiring. The alternative is
   one pass over all 29 for a single review. *Default: the sliced order above.*
4. **Prisma query logging is now live under `yarn dev`** — see Loose ends 3. Believed an improvement,
   since the line was dead before, but it is new noise Steve did not have yesterday.
   *Default: leave it on.*

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

**Foundations are done** (`caf4e03`); the 29 handlers themselves are not. See "Phase 3 foundations"
below for what landed and the two decisions it embeds.

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

1. ✅ **Error mapping.** Done — see below.
2. ⬅ **Validation per route.** Replace the global `ValidationPipe` with `safeParse` against the Zod
   schemas from `@hmcts/deed-poll`. Follow `libs/onboarding/src/onboarding/validation.ts` and the
   existing `apps/api/src/routes/onboarding/` handlers for shape. `zodErrorToFieldErrors` and the
   400 mapping are in place, so a handler can simply `throw result.error` on a failed `safeParse`.
   **This is per-handler work and is the bulk of what remains.**
3. ✅ **`RolesGuard` → Express middleware.** Done — see below.
4. ⬅ **Multer.** `uploadDocument` now takes a plain `UploadedFile` (`buffer`, `originalname`,
   `mimetype`, `size`) rather than `Express.Multer.File`. The app maps its upload middleware onto it.

Verification: `yarn test` must show at least 450 in `libs/deed-poll` and 67 in `apps/api` plus
whatever the new route tests add; `yarn lint` and `yarn build` clean; and exercise the handlers
against a running app (`docker compose up -d && yarn dev`), including
`GET /api/deed-polls/field-rules` and `POST /api/deed-polls/:id/validate`, which are the
conditional-rule surface. **Send `x-user-roles: deedpoll-admin` when exercising guarded routes** —
`yarn dev` sets `NODE_ENV=development`, so the header is honoured; under any other `NODE_ENV` it is
ignored and guarded routes 403.

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

## Branch state

[`feat/deed-poll-migration`](https://github.com/hmcts/deed-poll-admin/tree/feat/deed-poll-migration)
is published with upstream tracking configured; 127 files, +10,648 lines. The diff was scanned for
secrets before publishing — no `.env`, keys or credential-shaped strings. The only hits were the
template's `SESSION_SECRET` placeholder and Helm `secretRef` names, which are references, not values.

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
