# Migrate `power_app_nest` into `deed-poll-admin`

## Context

`power_app_nest` is a NestJS prototype that re-implements the DeedPoll Dynamics 365 caseworker
back-office: ~9,600 lines of TypeScript, 41 HTTP handlers, 9 Nunjucks templates, and a Prisma
schema that is a careful port of the Dynamics `deedpoll_deedpoll` entity and its four child tables.
It is a genuinely good prototype — the state cascade, validation rules and conformance harness pin
the port to the source Dataverse spec, and the author already designed the production seams
(`FileStorageService` documents the object-storage swap; `current-user.ts` documents the IdP swap).

It now needs to become a production HMCTS service inside `deed-poll-admin`, which was re-scaffolded
onto `hmcts/expressjs-monorepo-template` (Express 5 + `simple-router`, ESM-only, Biome, Vitest,
Prisma 7, Turbo). The prototype is NestJS + CommonJS + decorators + Jest + Prisma 6, so this is a
re-platforming, not a copy.

**Verified baseline** (run before planning, so we know what "still works" means):

| Suite | Result |
|---|---|
| `npx jest` (unit) | **17 suites / 269 tests pass** |
| `npx jest --config test/jest-conformance.json` | 4 of 5 suites pass, **63 tests**; `schema.conformance.spec.ts` fails |

`schema.conformance.spec.ts` fails because `test/conformance/artifacts.ts` resolves
`.business_context/dataverse_tables/` as a *sibling of the prototype root*, and that directory is
not on this machine. Preserving those 332 passing tests is the safety net for the whole migration.

## Decisions taken

| Area | Decision |
|---|---|
| Framework | Staged: pure domain → `libs/`, then rebuild the HTTP layer, delete Nest last |
| Auth | Real IDAM/Entra in scope now — replaces the `x-user-roles` header stub |
| Documents | CDAM, adopting CCD properly (case type + jurisdiction + events) |
| Welsh | Build the `en`/`cy` shape; populate English content only |

## Scope warning — read before approving

The document-storage decision makes this **two pieces of work, not one**. Adopting CCD to get CDAM
is a re-platforming programme layered on top of the migration, and the evidence says it is
pioneering work for a Node service:

- **The decentralised CCD SDK is Java-only.** `apps/ccd/docs/how-to/decentralise-a-service.md`
  lists as a hard prerequisite: *"Spring Boot 3 service using `ccd-config-generator` SDK"*, with a
  `CCDConfig<T,S,R>` entry point and a Gradle `ccd { decentralised = true }` opt-in. Events are
  typed Java `Submit<T,S>` handlers. `libs/ccd-config-generator` is a Java SDK.
- **The only adopters are Java.** PCS (`pcs-api`, Spring Boot) and CIC.
- **A TypeScript service must hand-build the contract**: five `/ccd-persistence/*` endpoints plus
  idempotency (`FOR UPDATE` lock + `Idempotency-Key`, stable replay bodies), monotonic `revision`,
  message publishing to `ccd.message_queue_candidates`, Elasticsearch indexing, and a
  retain-and-dispose reaper. CCD **does not retry** failed `/ccd-persistence/cases` calls.
- **Flyway/Prisma conflict**: the SDK's migrations own schema `ccd`; this repo migrates with Prisma.

The plan therefore splits into **Track A** (productionise in the monorepo — no CCD dependency) and
**Track B** (CCD adoption). Track A delivers a deployable service on its own and is worth doing
regardless. Track B is separable, so it can be descoped without wasting Track A.

**Off-ramp:** if Track B is deferred or abandoned, reimplement `FileStorageService` against Azure
Blob Storage instead. It is a single narrow seam (`save` / `createReadStream` / `delete`), so this
is a one-class change plus a storage account in `infrastructure/`.

---

## Phase 0 — Hygiene and blocked inputs (do first)

`power_app_nest/` currently sits **untracked and not gitignored** inside `deed-poll-admin`,
alongside `node_modules/` (498M), `dist/`, `.env` and 57 document blobs. A stray `git add -A`
commits all of it.

- Add `power_app_nest/` to `.gitignore` while it is a staging area.
- `.env` holds only `DATABASE_URL` and `PORT` (local dev values) — nothing to migrate to a vault,
  but confirm before deleting.

**Two inputs must be retrieved from the original prototype repo — both are blocking:**

1. `.business_context/dataverse_tables/` — the Dataverse source-of-truth exports.
   Without them `schema.conformance.spec.ts` cannot run, and the schema-coverage assertions that
   pin the port to the source spec are lost. Note the artifact is *alphabetically truncated*
   (A–R only) per the comment in `artifacts.ts`, so it only ever asserts forward coverage.
2. **`deed_poll_public_web` and its `DECISIONS.md`.** The schema comments state this sibling app
   shares the database and that *"power_app_nest is the sole owner of migrations — the public app
   runs `prisma generate` only and must never run `prisma migrate`."* Moving schema ownership into
   `libs/postgres-prisma` changes that contract. We need to know whether the public app also
   migrates here, points at this repo's generated client, or is abandoned.

## Phase 1 — Schema into the monorepo

- Port `power_app_nest/prisma/schema.prisma` → `libs/postgres-prisma/prisma/schema/deed-poll.prisma`.
  Prisma 7 uses a multi-file schema directory, so this drops in alongside `base.prisma` and
  `onboarding.prisma`. Strip the prototype's own `generator`/`datasource` blocks — `base.prisma`
  owns them, and `prisma.config.ts` supplies the URL.
- Both sides use `provider = "prisma-client-js"`, so the generator needs no change.
- **Re-baseline migrations**: generate one init migration via `yarn db:migrate:dev` rather than
  porting the prototype's six. The prototype DB is throwaway and the originals were authored
  against Prisma 6 standalone. Keep the six in `docs/` for provenance — the fifth and sixth
  encode real decisions (public-journey fields, dropping `deedpoll_NoteID`).
- Verify the driver adapter (`PrismaPg`) handles `Int[]` (`iShall`, `iHaveSubscribed`,
  `andAlsoMyOld`, `applicableTypes`) and `Decimal @db.Decimal(12,2)` (`refundAmount`).
- Keep every `@map`/`@@map`, notably the deliberate `signaturerecieveddate` misspelling mapping.

## Phase 2 — Domain logic → `libs/deed-poll/`

This is the bulk of the value and nearly all of the 332 tests. These modules are already
framework-agnostic; they move close to as-is.

Move from `power_app_nest/src/deed-poll/` and `src/notes/`:
`case-state.service.ts`, `deed-poll-validation.service.ts`, `computed.ts`, `form-fields.ts`,
`form-payload.ts`, `form-validation.ts`, `form-presentation.service.ts`, `card-layout.ts`,
`case-header.ts`, `detail-view.ts`, `reference-number.service.ts`, `notes-view.ts`,
`note-form.ts`, `enums/dynamics-values.ts`, and `auth/roles.ts` — each with its co-located
`*.spec.ts` → `*.test.ts`.

Transformations, applied uniformly:

- **Drop Nest**: remove `@Injectable()`; per this repo's CLAUDE.md prefer plain exported functions
  over classes unless there is shared state.
- **CJS → ESM**: add `.js` extensions to relative imports; `"type": "module"` in the lib's
  `package.json`.
- **Prisma access**: replace the injected `PrismaService` with
  `import { prisma } from "@hmcts/postgres-prisma"`. Delete `src/prisma/` — the shared singleton
  and its pool replace it (`libs/postgres-prisma/src/index.ts`).
- **Jest → Vitest**: 22 spec files. Mechanical — `jest.fn()`→`vi.fn()`, `jest.mock`→`vi.mock`,
  explicit imports from `vitest`. The specs use plain `new Service()` with no Nest DI container,
  which is why this stays cheap.
- Register `@hmcts/deed-poll` in the root `tsconfig.json` `paths` and as a `workspace:*` dependency
  of `apps/api` and `apps/web`. Follow `libs/onboarding/` as the structural template.

Also move `test/conformance/` here, retargeting `artifacts.ts` at the artifacts' new home
(the `nest-cli.json` probe must go — that file will not exist).

## Phase 3 — JSON API → `apps/api/src/routes/`

29 handlers across five controllers become `simple-router` files:

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

- **DTOs → Zod.** The repo standardises on Zod 4.4.3, not `class-validator`. Convert the eight
  `dto/*.ts` files, following the existing pattern in
  `libs/onboarding/src/onboarding/validation.ts`. This replaces the global `ValidationPipe` with a
  per-route `safeParse`.
- **`RolesGuard` → Express middleware.** Keep the `Role` / `DEEDPOLL_ADMIN` model unchanged so the
  authorisation semantics are preserved; only the extraction mechanism changes (Phase 5).
- `@Roles(...)` metadata becomes a middleware array on the exported handler — `simple-router`
  supports handler arrays.

## Phase 4 — SSR pages → `apps/web/src/pages/`

12 page handlers and 9 templates.

- Pages become `apps/web/src/pages/deed-polls/**` with `(group)` directories where a segment
  should not appear in the URL; templates sit colocated as `.njk`.
- **Delete `nunjucks.setup.ts` entirely.** `configureGovuk` from `@hmcts-cft/express-govuk-starter`
  replaces all of it: view resolution, the govuk-frontend search path, static asset mounts and
  locale middleware. This removes three prototype workarounds that only existed because it was
  standalone — the `nest-cli.json` `PROJECT_ROOT` probe, the manual `useStaticAssets` govuk mounts,
  and the `JEST_WORKER_ID` watch guard that stopped e2e runs hanging.
- Port the two custom Nunjucks filters, `govdate` and `label` (the latter reads the `LABELS`
  registry from `enums/dynamics-values.ts`), into the starter's configuration.
- `src/assets/css/app.css` → `apps/web/src/assets/css/deed-poll.scss`, built by Vite; register the
  entry in `apps/web/src/app.ts`'s `assetOptions`.
- Templates currently extend the prototype's own `layouts/base.njk`; reparent them onto the
  starter's layout.
- Add `en`/`cy` content objects per page as the repo requires, with English content and `cy`
  structured but not translated.

## Phase 5 — Authentication (IDAM/Entra)

The current scheme reads roles from the `x-user-roles` header, so **any caller can send
`x-user-roles: deedpoll-admin` and gain admin**. This must land before the service is reachable
outside localhost.

- Replace `userFromRequest` with an OIDC login flow and server-side session lookup. Sessions are
  already Postgres-backed via `@hmcts-cft/express-session-postgres` (wired during the re-scaffold),
  so there is no new session infrastructure.
- Keep the `Role` model and the guard's call sites identical — the blast radius is one function.
- Populate `createdBy` / `modifiedBy` from the authenticated principal rather than the spoofable
  `x-user-name`. Retain `SERVICE_ACCOUNT_NAME` (`# svc_HMCTS_LCPT_Dev`) as the unattributed-write
  fallback so audit text stays consistent with the source system.
- Register the client and secrets: `infrastructure/keyvault.tf`, and `keyVaults:` in
  `apps/web/helm/values.yaml`.

## Phase 6 — Config, Helm, deployment

- Add service config to `apps/web/config/` and `apps/api/config/` (`default.json` +
  `custom-environment-variables.json`), following the existing shape.
- Helm values for the new environment variables and key vault secrets.
- App Insights and health checks are already wired by the re-scaffold; add a readiness check that
  covers the deed-poll tables.

---

## Track B — CCD adoption (separable)

Only start once Track A is green.

- **Phase 7 — Spike and decide.** Time-boxed spike to hand-implement the five
  `/ccd-persistence/*` endpoints in TypeScript against
  `apps/ccd/docs/reference/decentralised-callbacks.md`. Exit criteria: idempotent replay returns
  stable bodies, `revision` increments monotonically, and the `ccd` schema coexists with Prisma
  migrations. If the spike fails, take the Azure Blob off-ramp.
- **Phase 8 — Case type definition.** Hand-author JSON (`ccd-config-generator` is Java), following
  `apps/ccd/docs/tutorials/first-case-type-json.md` and
  `apps/ccd/docs/reference/json-definition-format.md`. Map the Dynamics-derived enums to CCD fixed
  lists, preserving the integer values the schema comments record.
- **Phase 9 — Persistence endpoints** in `apps/api`, plus the retain-and-dispose reaper.
- **Phase 10 — CDAM documents.** Reimplement `FileStorageService` against
  `POST /cases/documents` and `GET /cases/documents/{id}/binary`, threading `caseTypeId` and
  `jurisdictionId`. Downloads need both S2S and a user JWT, so this depends on Phase 5.
- **Phase 11 — Platform onboarding** (all external PRs/requests, start early — these have lead time):
  S2S whitelist in `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES` (cnp-flux-config); CDAM
  `service_config.json` entry; `ccd.decentralised.case-type-service-urls[DEED_POLL]` against
  `ccd-data-store-api`; definition-store publish; Elasticsearch indexing; Work Allocation
  message publishing.

---

## Verification

Per phase, and at the end:

1. **Tests** — `yarn test` from the repo root. The gate is that the migrated suites still total
   **269 unit + 63 conformance tests passing**; any drop is a regression to explain, not accept.
   `schema.conformance.spec.ts` should move from failing to passing once Phase 0 supplies the
   artifacts.
2. **Lint and build** — `yarn lint` and `yarn build` (Biome + `tsc` + Vite) must be clean; the repo
   forbids `any` and CommonJS, both of which the prototype currently uses.
3. **Migrations** — `yarn db:migrate:dev` against the local Compose Postgres, then `yarn db:studio`
   to confirm all five tables, enums and indexes materialise.
4. **Run it** — `yarn dev`, then walk the caseworker journey end to end on
   `http://localhost:3000/deed-polls`: create a case, confirm the reference number allocates,
   add a note, add a witness, upload a document, edit each tab, and check the state cascade
   derives the expected state. This exercises all 12 page handlers.
5. **API** — exercise the 29 JSON handlers, including `GET /api/deed-polls/field-rules` and
   `POST /api/deed-polls/:id/validate`, which are the conditional-rule surface.
6. **Auth** — confirm `x-user-roles: deedpoll-admin` no longer grants anything, and that an
   unauthenticated request to a guarded route is rejected.
7. **E2E** — port `test/case-pages.e2e-spec.ts` to Playwright in `e2e-tests/`, and add an axe pass
   (the prototype had no accessibility testing).

## Known risks

| Risk | Handling |
|---|---|
| CCD decentralisation is unproven for Node | Track B is separable; Azure Blob off-ramp preserved |
| `.business_context/` artifacts missing | Phase 0 blocker; otherwise schema conformance is lost |
| `deed_poll_public_web` shares the DB | Phase 0 — establish the migration-ownership contract |
| Header auth is an admin bypass | Phase 5; hard gate before any non-local deploy |
| Two known rule gaps documented in `CONFORMANCE_HARNESS_PLAN.md` (migrated-record relaxation unimplemented; Gazette-date gate only on the relinquishment branch) | Carry across as failing tests, fix in Track A — do not silently lose them |
| Prototype has no Welsh, no a11y tests | Structure added in Phase 4; axe in verification step 7 |
