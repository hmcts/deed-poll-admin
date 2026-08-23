# Migrating `power_app_nest` into `deed-poll-admin`

Working document. Supersedes the original plan agreed on 2026-08-21 — several decisions changed
during execution and this reflects what was actually decided and done.

## Context

`power_app_nest` is a NestJS prototype re-implementing the DeedPoll Dynamics 365 caseworker
back-office: ~9,600 lines of TypeScript, 41 HTTP handlers, 9 Nunjucks templates, and a Prisma
schema that is a careful port of the Dynamics `deedpoll_deedpoll` entity and its four child tables.

It is a good prototype. The state cascade, validation rules and conformance harness pin the port to
the source Dataverse spec, and the author designed the production seams deliberately
(`file-storage` documents the object-storage swap; `current-user` documents the IdP swap).

It is being turned into a production HMCTS service inside `deed-poll-admin`, which was re-scaffolded
onto `hmcts/expressjs-monorepo-template` (Express 5 + `simple-router`, ESM-only, Biome, Vitest,
Prisma 7, Turbo). The prototype is NestJS + CommonJS + decorators + Jest + Prisma 6, so this is a
re-platforming, not a copy.

## Decisions taken

| Area | Decision | Notes |
|---|---|---|
| Framework | Staged: pure domain → `libs/`, then rebuild the HTTP layer, delete Nest last | Keeps tests green throughout |
| Auth | Real IDAM/Entra, in scope | The header stub is an admin bypass — hard gate before any non-local deploy |
| Documents | CDAM, via **decentralised** CCD | See "Why decentralised" below |
| Persistence | Relational Prisma model retained | Not CCD case JSON |
| Welsh | Build the `en`/`cy` shape, English content only | |
| `deed_poll_public_web` | Out of scope; references stripped from the schema | |

### Why decentralised, and why CDAM works

An earlier concern — that CDAM evicts documents no CCD event attaches, and `attachToCase` is
restricted to `ccd_data` — **does not apply on the decentralised path**. From
`apps/ccd/docs/explanation/decentralisation.md`: *"The decentralised branches attach documents, call
`submitDecentralisedEvent`, and stop."* So `attachToCase` does fire and uploads are not TTL-evicted.
That was the main risk to the CDAM decision and it is retired.

Decentralisation was chosen for reasons beyond data shape: **organisational resilience** (the service
owns its data rather than depending on CCD's database) and **field-level constraints at the database
level** — `NOT NULL`, `CHECK`, `VarChar` limits and FK integrity, none of which a JSON blob can give
you. That is why the relational model is kept rather than collapsing into CCD case data.

### What decentralisation actually entails

More than mapping at the boundary. The CCD-shaped projection is **persisted**, not just
transformed on the wire:

| What | Where it lives | Shape |
|---|---|---|
| Domain tables (source of truth) | our DB, `public` schema | Dataverse-derived Prisma |
| `ccd.case_event.data` — snapshot per event | **our DB, `ccd` schema** | CCD-shaped |
| `ccd.case_data.data` — legacy JSON blob | our DB, `ccd` schema | CCD-shaped, legacy path only |
| Case pointer | CCD's DB | empty (`data = {}`, `state = ''`) |

CCD writes **no rows at all** to its own `case_event` for a decentralised case type. A read
projection (`CaseView`, cf. `PCSCaseView.java:54-97`) is built from our own data.

**The SDK is Java-only.** `apps/ccd/docs/how-to/decentralise-a-service.md` lists as a hard
prerequisite *"Spring Boot 3 service using `ccd-config-generator` SDK"*, with a `CCDConfig<T,S,R>`
entry point and typed Java `Submit<T,S>` handlers. Both adopters (PCS, CIC) are Spring Boot. A
TypeScript service must hand-build the five `/ccd-persistence/*` endpoints plus idempotency,
monotonic `revision`, ES indexing, WA message publishing and a retain-and-dispose reaper. **CCD does
not retry** a failed `/ccd-persistence/cases` call.

## Track A — productionise in the monorepo

No CCD dependency. Deployable on its own.

- **Phase 0 — hygiene and blocked inputs.** ✅ Done.
- **Phase 1 — schema into the monorepo.** ✅ Done.
- **Phase 2 — domain logic → `libs/deed-poll/`.** ✅ Done. Includes the DTO→Zod conversion, which
  was originally Phase 3 but moved forward because Phase 2 could not compile without it.
- **Phase 3 — JSON API → `apps/api/src/routes/`.** ⬅ **in progress.** Foundations (error mapping,
  role middleware) done; the 29 handlers remain.
- **Phase 4 — SSR pages → `apps/web/src/pages/`.**
- **Phase 5 — authentication (IDAM/Entra).**
- **Phase 6 — config, Helm, deployment.**

See `PROGRESS.md` for detail on what is done and what Phase 3 involves.

## Track B — CCD adoption

Separable. Start only once Track A is green.

- **Phase 7 — spike and decide.** Time-boxed: hand-implement the five `/ccd-persistence/*` endpoints
  in TypeScript against `apps/ccd/docs/reference/decentralised-callbacks.md`. Exit criteria:
  idempotent replay returns stable bodies, `revision` increments monotonically, and the `ccd` schema
  coexists with Prisma migrations. The `ccd` schema itself is already in place (see
  `apps/postgres/ccd-runtime/`).
- **Phase 8 — case type definition.** Hand-authored JSON (`ccd-config-generator` is Java), following
  `apps/ccd/docs/tutorials/first-case-type-json.md`. Map the Dynamics-derived enums to CCD fixed
  lists, preserving the integer values the schema comments record.
- **Phase 9 — persistence endpoints** in `apps/api`, plus the retain-and-dispose reaper.
- **Phase 10 — CDAM documents.** Reimplement `file-storage.ts` against `POST /cases/documents` and
  `GET /cases/documents/{id}/binary`, threading `caseTypeId` and `jurisdictionId`. Downloads need
  both S2S and a user JWT, so this depends on Phase 5.
- **Phase 11 — platform onboarding.** All external, all with lead time, so start early: S2S
  whitelist in `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES` (cnp-flux-config); CDAM
  `service_config.json`; `ccd.decentralised.case-type-service-urls[DEED_POLL]` against
  `ccd-data-store-api`; definition-store publish; Elasticsearch indexing; WA message publishing.

**Off-ramp.** If Track B is abandoned, reimplement `file-storage.ts` against Azure Blob Storage —
a single narrow seam (`saveFile` / `createFileReadStream` / `deleteFile`) plus a storage account in
`infrastructure/`.

## Open items needing a human

1. **The CNP product code is unverified.** The re-scaffold used team `deed-poll`, product `admin`.
   The old `Jenkinsfile_CNP` said `rpe` and was never updated, so there was no reliable source. This
   drives the ACR namespace (`hmctsprod.azurecr.io/deed-poll/...`), `aadIdentityName`, key vault
   names, and `flexibleserver: deed-poll-preview` — a shared preview Postgres server that likely
   does not exist under that name. **Confirm with Platform Operations.**
2. **CI has no database.** `.github/workflows/job.test.yml` has no `services:` block, so the `ccd`
   schema integration tests skip rather than run. That is honest but it is not coverage.
3. **Jenkins → GitHub Actions is platform onboarding**, not a code change. The workflows call
   `hmcts/cnp-githubactions-library` and need org secrets plus an AKS/ACR deploy identity.
4. **`catalog-info.yaml` was not recreated** — it needs a real Backstage owner, system and Slack
   channel, and inventing those would register false ownership.
5. **20 dependency advisories remain** (7 high, 13 moderate, no criticals) after PR #36 cleared 79 of
   the 99 master inherited from the re-scaffold. Each is pinned by a dependent rather than by us, so
   clearing them means bumping the dependent — 11 are a single `protobufjs@8.0.1` under
   `applicationinsights`, which Renovate #31 should carry. Not a deploy blocker now the criticals are
   gone, but worth a pass before Phase 6. See "Dependency alerts on master" in `PROGRESS.md`.

## Known risks

| Risk | Handling |
|---|---|
| CCD decentralisation unproven for Node | Track B separable; Azure Blob off-ramp preserved |
| Header auth is an admin bypass | Phase 5; hard gate before any non-local deploy |
| Two rule gaps in `CONFORMANCE_HARNESS_PLAN.md` (migrated-record relaxation unimplemented; Gazette-date gate only on the relinquishment branch) | Carry across as failing tests and fix — do not silently lose them |
| Prototype has no Welsh, no a11y tests | Structure in Phase 4; axe in Phase 4 verification |
| Local disk document storage | Cannot go to AKS — pods ephemeral, replicas share no volume. Phase 10 or the Blob off-ramp |
