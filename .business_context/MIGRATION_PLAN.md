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
- **Phase 3 — JSON API → `apps/api/src/routes/`.** ✅ **All 29 handlers done** 2026-09-01. Sliced by
  resource: `deed-polls` (7), notes + witnesses (10), `document-types` (5), `documents` (7). Three
  defects of one shape were found by running the app rather than by testing it — see `PROGRESS.md`.
- **Phase 4 — SSR pages → `apps/web/src/pages/`.** ✅ **All 12 page handlers ported** 2026-09-01,
  each exercised against a running app. Two pieces deliberately outstanding, tracked in
  `PROGRESS.md` under "Phase 4 outstanding": the verification pass (axe, Playwright journeys, Welsh
  content), and deleting `power_app_nest/` — kept as a reference by Steve's decision, since it was
  never committed and so cannot be recovered once gone.
- **Phase 5 — authentication (IDAM/Entra).** ⬅ **in progress.** `apps/web`'s OIDC login is built and
  verified against a local stub issuer — authorization code + PKCE, discovery, session, global
  `requireAuth`, logout. **Blocked on an IDAM client registration**, drafted at
  [`IDAM_REGISTRATION_REQUEST.md`](IDAM_REGISTRATION_REQUEST.md) and needing to be sent. `apps/api`
  still uses the header bypass and needs bearer-token validation, which is separate work.
- **Phase 6 — config, Helm, deployment.**

See `PROGRESS.md` for per-slice detail, the decisions already settled, and the outstanding items.

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
- **Phase 10 — CDAM documents.** **Superseded 2026-09-04 by
  [`CDAM_INTEGRATION_PLAN.md`](CDAM_INTEGRATION_PLAN.md)** — read that instead. This bullet assumed a
  TypeScript reimplementation of `file-storage.ts`; the decision taken is to follow the PCS shape and
  put the CCD contract and document handling in a new Spring Boot service, because the
  `ccd-config-generator` SDK is a hard prerequisite for decentralisation and both live adopters are
  Java. The original text: reimplement `file-storage.ts` against `POST /cases/documents` and
  `GET /cases/documents/{id}/binary`, threading `caseTypeId` and `jurisdictionId`. Downloads need
  both S2S and a user JWT, so this depends on Phase 5. **What that missed:** the three-function seam
  cannot express CDAM at all, and `attachToCase` is restricted to `ccd_data`, so documents TTL out
  within a day unless a CCD event attaches them.
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
| Header auth is an admin bypass (**`apps/api` only** since Phase 5; `apps/web` now uses IDAM) | Phase 5; hard gate before any non-local deploy. Narrowed 2026-08-23: the scheme is now opt-in by `NODE_ENV` and fails closed elsewhere, so an early deploy 403s rather than granting admin. **Unguarded routes are still open** — this is not authentication |
| Every ported route is unguarded, including hard-delete | Faithful to the prototype, which guarded nothing. Privilege is enforced inside the domain (`isAdmin` gates `privacy`) rather than at the route. Whether `DELETE` should be admin-only, and whether deletion should be soft given `retainPermanently`, is an open business question — Loose ends 5 in `PROGRESS.md`. Settle before Phase 5 |
| ~~Two rule gaps in `CONFORMANCE_HARNESS_PLAN.md`~~ | **Closed, verified 2026-09-01.** `getFieldRules` with `migrated: true` relaxes all 8 type-required fields to 0, and the Gazette gate hides the notice date for `Adult` as well as `DeedOfRelinquishment`. The plan itself is preserved at [`CONFORMANCE_HARNESS_PLAN.md`](CONFORMANCE_HARNESS_PLAN.md) — it lived only inside `power_app_nest/`, which was never committed, so deleting that directory would have destroyed it |
| Prototype has no Welsh, no a11y tests | Structure in Phase 4; axe in Phase 4 verification |
| Local disk document storage | Cannot go to AKS — pods ephemeral, replicas share no volume. [`CDAM_INTEGRATION_PLAN.md`](CDAM_INTEGRATION_PLAN.md) or the Blob off-ramp. Note the CDAM route now has a long external critical path (a CDAM code change and release among it), so if a deployed environment needs working uploads sooner, Blob is the answer for the interim |
