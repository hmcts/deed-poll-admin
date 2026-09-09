# `deed-poll-api` — rewriting `apps/api` in Spring Boot

Written 2026-09-04. Supersedes Phase 10 of [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md).

> **The admin-side cutover is DONE, 2026-09-09.** This plan described the cutover as a later stage; it was
> brought forward on Steve's call of 2026-09-07 and carried out in
> [`docs/plans/02-dal-cutover-to-api.md`](../docs/plans/02-dal-cutover-to-api.md), eight tasks on
> `dal-cutover-to-api`. **`deed-poll-admin` now owns no data access layer at all**: no Prisma, no pg pool,
> no migrations, no `apps/api`, no `apps/postgres`, no `libs/postgres-prisma`, no `DATABASE_URL` and no
> database credential in any chart. Every case, note, witness and document operation goes through one
> adapter, `libs/deed-poll-api-client`, onto api's published spec (taken from api commit `847933a`).
>
> So the tables below are the *design*, and where they describe admin as still holding a database they are
> **history rather than current state** — annotated where it matters. What is *not* done is api being
> deployed: this plan's own pipeline cutover is outstanding, and until it lands admin runs against the
> in-repo mock and a deployed admin pod would report readiness DOWN. See
> [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md#deed-poll-api).

**Amended 2026-09-06 by [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md) on three points**, none of
which changes this plan's design — but this file is wrong about them where it is not annotated:

1. ~~**The session table lives in its own `session` schema**, not `public`.~~ **Superseded 2026-09-07: there
   is no session table.** Sessions moved to Redis — see the amendment under the persistence diagram. This is
   better for this plan than the schema split was: `public` has exactly one owner, api's Flyway, with no
   second connection in the database at all.
2. **The Postgres server is provisioned by `hmcts/deed-poll-infra`.** This service consumes it and owns its
   *schemas*; it does not create the server, and `deed-poll-api/infrastructure/` is deleted.
3. **`deed-poll-api` deploys via the Jenkins CNP pipeline** — `withPipeline` with product `deed-poll` and
   component `api`, replacing the template's unconfigured `rpe`/`demo`. Its `.github/workflows/` are
   deleted, CodeQL included.

## Scope

**This plan covers one thing: replacing `apps/api` with a Spring Boot service.** It is deliberately
narrower than an earlier draft, which had absorbed the citizen-facing service's payment integration,
anonymous-submission protection and access-control model. Those are `deed-poll-web`'s concerns and now
live in [`DEED_POLL_WEB_NOTES.md`](DEED_POLL_WEB_NOTES.md) — recorded, because they are real decisions,
but not designed here.

> **This document is the *why*. The executable form is
> [`docs/plans/deed-poll-api-01-foundation.md`](../docs/plans/deed-poll-api-01-foundation.md)** — a
> Ralphex plan: 17 sequential tasks (0–16), each with a validation command, written to be run by an autonomous
> agent inside `hmcts/deed-poll-api`. Plan 01 is schema, domain and the caseworker API. **Plans 02 (CCD
> decentralisation) and 03 (CDAM) are not written yet**, deliberately — both depend on external
> onboarding that has not happened, and writing them now would bake in assumptions about a case type ID
> nobody has confirmed.

What this plan *does* carry from that is the small number of constraints that stop `deed-poll-api` from
needing rework when `deed-poll-web` arrives. They are listed in [Building the foundation
`deed-poll-web` needs](#building-the-foundation-deed-poll-web-needs) and amount to three design rules,
not a workstream.

### The three applications, so the names are unambiguous

| Name | What it is | State |
|---|---|---|
| **`deed-poll-admin`** | **internal staff app.** Caseworkers manage applications. Express + Nunjucks, IDAM `HMCTS_ACCESS`, internal on `platform.hmcts.net` | exists — Phases 0–6 done |
| **`deed-poll-api`** | **the backend.** Spring Boot, owns persistence, CCD and CDAM. Serves both frontends | **this plan** |
| **`deed-poll-web`** | **citizen-facing service.** Public, anonymous in release 1, takes a payment | not started — [notes](DEED_POLL_WEB_NOTES.md) |

## The decisions this plan rests on

All Steve's, taken 2026-09-04.

**1. The backend is rewritten in Spring Boot.** `apps/api` is replaced by `deed-poll-api`, which owns
persistence, the CCD contract and document handling. `apps/web` — the staff UI inside
`deed-poll-admin` — stays TypeScript and moves from in-process domain calls to HTTP. Reasoning and the
rejected alternative are under [Why this shape](#why-this-shape).

**2. It is built as a foundation for two frontends, but only one exists.** `deed-poll-admin` today,
`deed-poll-web` later. The practical effect on this plan is small and specific — see [Building the
foundation](#building-the-foundation-deed-poll-web-needs). It does not mean designing citizen endpoints
now: there is no consumer to derive them from, and guessing is the mistake `apps/api` already made.

**3. Three repos, both new ones on Jenkins.**

| Repo | Contains | Template | Build |
|---|---|---|---|
| `hmcts/deed-poll-admin` | `apps/web` (staff UI), `libs/` | `expressjs-monorepo-template` (already) | GitHub Actions |
| `hmcts/deed-poll-api` | Spring Boot backend, CCD config, CDAM | **`hmcts/spring-boot-template`** | Jenkins |
| `hmcts/deed-poll-shared-infrastructure` | product resource group, Key Vault, workload identity | **none — see below** | Jenkins |
| `hmcts/deed-poll-web` | citizen service | later | later |

**On templates.** `hmcts/spring-boot-template` is a real, current GitHub template — pushed 2026-09-02 —
and ships `build.gradle`, `Jenkinsfile_template`, `Jenkinsfile_nightly`, `Dockerfile`, `charts/`,
`config/`, `infrastructure/` and `catalog-info.yaml`. Use it for `deed-poll-api`.

**There is no template for a shared-infrastructure repo.** `hmcts/terraform-module-template` is *not*
it — its `inputs-required.tf` / `inputs-optional.tf` / `outputs.tf` / `example/` shape shows it is for
authoring reusable `cnp-module-*` modules. What the estate actually does is copy an existing repo, and
`pt-shared-infrastructure` is the newest and cleanest: `main.tf`, `key-vault.tf`, `app-insights.tf`,
`variables.tf`, `provider.tf`, `Jenkinsfile_CNP`, `.terraform-version`, `.pre-commit-config.yaml`,
`renovate.json`, `.editorconfig`, `.github/`. It is cloned locally at
`../../apps/pt/pt-shared-infrastructure` in this workspace.

**4. The shared infrastructure moves out of `deed-poll-admin`.** This reverses the decision taken
earlier the same day, and the reversal is right: that decision rested on there being no second component
repo, and there are now two. See [Moving the shared
infrastructure](#moving-the-shared-infrastructure) — **there is no Terraform state to migrate**, which
makes this far cheaper than it would normally be.

Add both new repos to `cft-workspace`'s `workspace.yaml` via `scripts/add-repo`, not by hand.

**Consequence worth knowing:** the Java and Terraform repos need **no federated-credential PR**. Jenkins
has its own credentials path, so they do not join the `azure-github-federation-config` queue where #99
has sat untouched since 2026-09-03. `deed-poll-admin` stays on GitHub Actions and its four missing Azure
secrets remain its own problem.

---

## Building the foundation `deed-poll-web` needs

The whole of `deed-poll-web`'s design is in [its own notes](DEED_POLL_WEB_NOTES.md). Three rules from it
land on `deed-poll-api`, and all three are free if applied from the start and expensive to retrofit:

1. **Two endpoint namespaces from day one** — `/caseworker/**` now, `/citizen/**` left empty. Never one
   endpoint whose behaviour varies by who called it.
2. **No caseworker assumption in the domain layer.** A service method must not assume the caller is a
   caseworker, or that a request carries a named user at all. `deed-poll-web` submits for someone with no
   account.
3. **Separate response DTOs per audience.** A caseworker DTO that later gains a field is then incapable
   of leaking it, because the citizen DTO is a different class. Cheap, and it survives people who have
   not read any of this.

Nothing else about `deed-poll-web` — payments, anonymous submission, rate limiting, citizen access
control — is built or designed as part of this plan. **The one fact worth carrying in your head** is that
release 1 of `deed-poll-web` has no citizen login at all, so the elaborate citizen access-control model
is a later problem than it first appears.

---

## The shape, before and after

Today. Note `apps/api` has an ingress and **no consumer**, and both apps import the domain in-process:

```
                          browser
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
        apps/web :3000               apps/api :3001
        Express + Nunjucks           Express, JSON
              │                             │
              │  import (in-process)        │  import (in-process)
              └──────────────┬──────────────┘
                             ▼
                      libs/deed-poll  (domain + Prisma)
                             ▼
                        PostgreSQL, public schema

   documents → local disk (DATA_DIR) — cannot go to AKS
```

Target. `deed-poll-web` is drawn dotted because it is not in this plan's scope — it is here only to show
where it attaches:

```
   caseworker (internal)                     ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
   platform.hmcts.net                          deed-poll-web  (later)
          │                                   └ ─ ─ ─ ─ ─ ─ ┬ ─ ─ ─ ─ ┘
          │ IDAM login (HMCTS_ACCESS)                        ╎
          ▼                                                  ╎
 ╔═ deed-poll-admin ═══════════╗                             ╎
 ║  apps/web  — staff UI       ║                             ╎
 ║  Nunjucks, Welsh, viewer    ║                             ╎
 ╚══════════════┬══════════════╝                             ╎
                │                                            ╎
       user IDAM token + S2S                                 ╎
                └────────────────────┬───────────────────────╯
                                     ▼
 ╔═ deed-poll-api ═══════════════════════════════════════════════════════╗
 ║  /caseworker/**   the only surface built now                          ║
 ║  /citizen/**      reserved, empty                                     ║
 ║  domain logic     CaseView    decentralised events    CDAM client     ║
 ║  NOT internet-facing — reachable only from the frontends              ║
 ╚══┬═══════════════════┬══════════════════════════════════════════════╝
    │                   │
    │        S2S + user │ S2S + user token
    │             token │
    │                   ▼
    │        ccd-data-store-api          CDAM ──────► dm-store
    │                   │                              (binaries live here)
    │                   │ /ccd-persistence/*
    │                   └──────► back into deed-poll-api
    ▼
 PostgreSQL  (one server, one database)
   ├─ public schema   domain tables   ← owned by deed-poll-api (Flyway)
   ├─ ccd schema      case_data, case_event,
   │                  message_queue_candidates, es_queue
   │                                  ← owned by the SDK (Flyway)
                                      (no session schema — sessions are in Redis)
```

**Amended 2026-09-07: there is no session table, in any schema. Sessions are in Redis.** This diagram first
put the session table in `public`, which would have made `apps/web`'s `pg.Pool` and this service's Flyway both
owners of one schema — a smaller instance of the table-level split the **"Rejected: splitting ownership by
table"** note below argues against. The 2026-09-06 fix was to give it a `session` schema of its own; that was
reversed on 2026-09-07 because `PostgresStore` accepts a `schemaName` it cannot create, so the "one config
value" was a config value plus a migration plus a Prisma drift question — and Redis was already provisioned
for `deed-poll-web`, so using it added no infrastructure. `public` now has exactly one owner with no second
connection in the database at all. See [`DEED_POLL_INFRA_PLAN.md`](DEED_POLL_INFRA_PLAN.md) Decision 3 and
`docs/plans/01-jenkins-and-session-schema.md`.

**The Postgres server itself is provisioned by `hmcts/deed-poll-infra`**, not by this repo — so "one
server, one database" is now a shared-infrastructure fact rather than something this service creates.

**One API for both audiences is the right call, and it is what the estate does** — `pcs-api` and
`nfdiv-case-api` each serve a citizen frontend and a caseworker surface. What makes it safe once
citizens *can* log in is that access control is declared in the CCD configuration rather than written per
endpoint; for release 1, what makes it safe is that citizens are never authenticated and can only write.

A write leaves and comes back, which is the counterintuitive part:

```
  apps/web ──1──► deed-poll-api ──2──► ccd-data-store-api
                       ▲                      │
                       │                      │ 3  routes on ccd.decentralised
                       └──────4───────────────┘    .case-type-service-urls
                    /ccd-persistence/cases

  5  our submit handler runs: domain write + CDAM attach, one transaction
```

---

## The thing to understand first

**CDAM stores nothing.** It is an access-control gate in front of `document-management-store-app`
(dm-store). The binary lives in dm-store's blob storage and the URLs CDAM returns still resolve to a
dm-store host. What CDAM adds is case-scoped permission checks, hash-token tamper detection, and a
TTL/attach lifecycle.

Two consequences that shape everything below:

1. **We never address dm-store.** Service teams must use CDAM exclusively — nfdiv's
   `CaseDocumentAccessManagement` never calls dm-store, and neither should we. deed-poll should hold no
   dm-store URL, and `@hmcts/evidence` (who own dm-store) are not in our dependency list.
2. **CDAM is useless without CCD events.** `PATCH /cases/documents/attachToCase` — the call that clears
   the upload TTL — is S2S-restricted to `ccd_data`, so only ccd-data-store may make it. Without an
   event attaching a document it **auto-deletes after `DOCUMENT_TTL_IN_DAYS`, default 1**, and until the
   event commits only the uploading user can read it; everyone else gets 403.

So "adopt CDAM" necessarily means "adopt decentralised CCD", which is what makes this a backend
decision rather than a storage one.

---

## Why this shape

The Java route is not about language preference. It is that `ccd-config-generator` is a **hard
prerequisite** for decentralisation, not a convenience:

| Concern | If TypeScript | With the SDK |
|---|---|---|
| S2S token (TOTP) | hand-rolled; **no S2S code exists in this repo today** | `authTokenGenerator.generate()` — `service-auth-provider-java-client` |
| CDAM calls | hand-rolled HTTP client | `CaseDocumentClientApi` Feign interface — `com.github.hmcts:ccd-case-document-am-client` (PCS pins `1.59.2`) |
| The five `/ccd-persistence/*` endpoints | hand-built, with idempotency and monotonic revision | `ServicePersistenceController`, wired by `decentralised = true` |
| `ccd` schema (`case_data`, `case_event`, `message_queue_candidates`, `es_queue`) | hand-vendored SQL | SDK Flyway, `classpath:dataruntime-db/migration` |
| Work Allocation messages | hand-built publisher | SDK transactional outbox; the only thing to do is mark events `publish = true` |
| Running the CFT stack in tests | not available | `rse-cft-lib` in-process |

**Phases 2–3 are not discarded — they become the specification.** 386 domain test blocks (267
deed-poll, 60 documents, 44 notes, 15 witnesses) plus 32 conformance tests describe exactly what this
system does, verified against a real database. Porting a specified system with an executable oracle is
a different job from building one: both implementations can run against the same Postgres during
transition and have their behaviour diffed. Those are the cheapest conditions this port will ever have.

**Rejected: splitting ownership by table** (a small Java service owning only `ccd.*` and the document
table, with Prisma keeping the rest). Two runtimes with two migration tools against one Postgres,
ownership enforced by code-review convention, is a design flaw rather than a manageable risk. It also
turned out to preserve less than it appeared to — see the next section.

---

## The API surface, derived rather than ported

**Nothing consumes `apps/api`.** Verified: `apps/web` imports `libs/deed-poll` in-process and makes
zero HTTP calls; the e2e suite drives a browser against `apps/web` on port 3000 only. `apps/api` has
its own ingress host, image and Helm subchart, and no client.

So its surface is a **free choice, not a contract**. It was built to mirror the prototype's
controllers. Do not port it.

**This section derives the `/caseworker/**` surface only.** The `/citizen/**` surface cannot be derived
the same way, because the citizen app does not exist yet — there is nothing to read the requirements
off. Deliberately not guessed at here: a speculative citizen API would be the same mistake `apps/api`
already made, which is building a surface from an imagined consumer rather than a real one. Design it
when the citizen journey is specified, and note that it is very likely to need things the caseworker
surface does not — at minimum an application-submission journey and, given `feeReference`,
`refundAmount`, `dateOfRefund` and `refundReference` are already in the schema, **a payment
integration** (see [open question 7](#open-questions)).

What `apps/web`'s 8 data-access files actually need:

| Operation | Domain function today | Used by |
|---|---|---|
| List cases, filtered | `findDeedPolls` | `deed-polls/index.ts` |
| Get one case **with nested notes, witnesses and documents** | `findDeedPoll` | 5 pages |
| Case field rules | `getCaseFieldRules` | `[id].ts` |
| List document types | `findDocumentTypes` | `documents/upload.ts` |
| Create case, allocating a reference number | `createDeedPoll`, `allocateForCreate` | `new.ts` |
| Update case | `updateDeedPoll` | `edit/[tab].ts` |
| Get one note | `findNote` | `notes/[noteId]/edit.ts` |
| Create note | `createNote` | `notes/new.ts` |
| Update note | `updateNote` | `notes/[noteId]/edit.ts` |
| Upload a document | `uploadDocument` | `[id].ts`, `documents/upload.ts` |
| Download a document | `downloadDocument` | `documents/[documentId]/file.ts` |

**Eleven operations, against 29 handlers in `apps/api`.** What has no consumer at all:

- **Every delete `apps/api` exposes.** `apps/web` performs no deletes of any kind — not cases, notes,
  witnesses, documents or document types. **None of them is ported.** The unguarded cascading case
  delete recorded as loose end 5 is retired rather than carried forward, and is replaced by the two
  operations below.
- **Witness writes.** Witnesses are *read* — they arrive nested inside `findDeedPoll` and
  `detail.njk` renders them — but nothing creates, updates or deletes one.
- **Document-type writes**, the `validate` endpoint, and document list/metadata.
- `onboarding/*` and `users*`, which are expressjs-monorepo-template leftovers.

Build the eleven. Add the rest when something asks for it.

### Two operations that are new, not ported

Steve's decision on 2026-09-04, settling loose end 5. Removing a case is not a REST verb here; it is a
lifecycle question, and CCD already has a model for it — `resolvedTTL` is authoritative for retention,
and the retain-and-dispose cron removes local data only once CCD has disposed of the pointer.

| Operation | Shape | Notes |
|---|---|---|
| **Withdraw / close a case** | a `decentralisedEvent` | The caseworker-facing action, and what "delete" means in practice: a case entered in error. A state transition, audited in `ccd.case_event`, removing nothing. **This is new UI too** — `apps/web` has no delete or withdraw control today, so it is a page and a control as well as an event |
| **Hard delete a case** | admin-only, guarded as `[requireRoles(DEEDPOLL_ADMIN), handler]` is today | Narrow, for data-protection erasure requests where removal is a legal obligation. Not a caseworker action. The cascade must be deliberate and tested: deleting a case with a note left zero rows in `deedpoll_notes`, checked directly against Postgres |

Routine disposal stays CCD's job, and `retainPermanently` is the flag that opts a case out of it —
which is what it was always for.

**This is net new scope rather than a port**, adding an event, a UI control and a guarded admin route to
Stage 3. Worth specifying now rather than retrofitting: adding an event later means republishing the
case-type definition through `dcd_ccd`.

---

## How a write actually works

This is the part most likely to be got wrong, because it is not a normal REST backend. A
service-initiated change is a **CCD event round trip**:

```
apps/web ──HTTP──► deed-poll-api
                        │  CoreCaseDataApi.startEvent / submitEvent
                        ▼
                 ccd-data-store-api
                        │  routes on ccd.decentralised.case-type-service-urls[<CASE_TYPE>]
                        ▼
                 deed-poll-api  /ccd-persistence/cases
                        │  our decentralisedEvent submit handler
                        ▼
                 domain write + CDAM attach, one transaction
```

PCS does exactly this via `CoreCaseDataApi` (`CcdTestCaseOrchestrator.startEvent`), with the inbound
half handled by SDK `StartEventHandler`/`SubmitEventHandler` beans (`RespondPossessionClaim`).

Three consequences worth designing for rather than discovering:

- **The presence of a URL in `ccd.decentralised.case-type-service-urls[...]` is what marks a case type
  decentralised.** There is no flag in the case-type definition.
- **~25ms extra latency per decentralised hop**, and the routing cache is a 100k-entry Caffeine LRU.
- **CCD does not retry a failed `/ccd-persistence/cases` call.** Handlers must be idempotent on
  `idempotency_key`; the SDK gives you the column, not the discipline.

Reads do not need the round trip — `CaseView` is called by CCD when *CCD* wants a case, but
`apps/web` reads straight from `deed-poll-api`.

---

## CDAM: the four flows

Uses `CaseDocumentClientApi` throughout. S2S via `authTokenGenerator.generate()`; the user JWT via an
`IdamTokenProvider` (PCS qualifies a `systemUpdateUserTokenProvider` for system actions).

**Upload.** `POST /cases/documents` multipart, with `jurisdictionId`, `caseTypeId` and
`classification`. CDAM sets the TTL itself on the way to dm-store and returns the dm-store envelope
plus a `hashToken`. Recover the document id from the **last 36 characters of the self href** — there is
no id field; PCS wraps this in a `DocumentIdExtractor`.

**Attach.** Submit a CCD event carrying the document field and its `hashToken`. Data-store validates
the token, calls `attachToCase`, clears the TTL and **strips `document_hash` before persisting**. We
never call `attachToCase` ourselves — we cannot.

**Download.** `GET /cases/documents/{id}/binary` with **both** S2S and the user's JWT. CDAM calls back
to data-store `GET /cases/{caseId}/documents/{documentId}` to check the user has Read on the case field
holding the document. This is the flow that cannot work before CCD exists.

**Delete.** `DELETE /cases/documents/{id}` — see the trap about `permanent` below.

What this replaces: `libs/deed-poll/src/documents/file-storage.ts`, three functions and a
`storageKey` column. **None of them can express CDAM**, for four independent reasons, each a design
constraint rather than a detail:

- upload needs `jurisdictionId`, `caseTypeId`, `classification`; the signature takes a buffer and
  nothing else
- upload returns a hash token that must reach the CCD event
- **hash tokens are single-use and not stable across attach** — the digest input gains `caseId` once
  known — so a token cannot be cached in `storageKey`
- download needs the user's JWT, in what is currently a pure function

`DeedPollSupportingDocument` keeps its metadata row; `storageKey` becomes the CDAM document id, with
`url` and `binaryUrl` alongside it, as PCS's `DocumentEntity` does.

---

## Viewing a document rather than downloading it

Steve's call, 2026-09-04. **This is the one part of this plan that is not gated on anything** — it needs
no CDAM, no CCD and no Java. It can ship against local disk now and carries over to CDAM unchanged,
because we proxy the bytes and therefore set our own response headers. That stops being true only if the
browser is ever redirected straight at CDAM.

`apps/web/src/pages/deed-polls/[id]/documents/[documentId]/file.ts` currently hardcodes
`Content-Disposition: attachment`, so everything downloads.

**Render PDFs with `pdfjs-dist` — Mozilla's pdf.js — in a Nunjucks page.** That is the same renderer
`@hmcts/media-viewer` uses internally, so it is the standard engine without the standard wrapper. JPEG
and PNG need nothing but an `<img>`.

| Type | Treatment |
|---|---|
| `application/pdf` | pdf.js viewer, our own `en`/`cy` labels |
| `image/jpeg`, `image/png` | inline `<img>` |
| `image/tiff`, `application/msword`, `.docx` | download only |

**Always offer download alongside view**, never view alone — GOV.UK guidance is unenthusiastic about
PDFs and a viewer must not trap the user.

**Why not `@hmcts/media-viewer` itself**, recorded so it is not revisited on "use the standard component"
grounds: it is Angular-only. Its README says *"This is an angular library"* and its integration section
is titled *"Integrating into your own Angular application"*; it publishes only an Angular FESM2022 build,
with no web component or UMD entry point, and requires `angular.json` asset configuration. Its peers are
Angular 20, NgRx 20, `ngx-datatable`, `ngx-chips`, `socket.io-client` and — the decisive one for a
bilingual GOV.UK service — **`rpx-xui-translation`**, which would mean a second i18n system alongside the
existing `en`/`cy` locales. The npm repository field points at `hmcts/rpx-xui-media-viewer`; the
`rpx-xui-` prefix is the giveaway that its home is XUI. It also would not have solved TIFF or Word.

Security, briefly, because serving user-uploaded bytes inline is normally an XSS vector:

- It is defensible here **because the upload allowlist excludes the dangerous types** — no SVG, no HTML
  — and we set `Content-Type` from our own stored value rather than echoing the file's.
- Add **`X-Content-Type-Options: nosniff`**, or a browser may sniff past the declared type.
- Keep `Cache-Control: no-store`, which is already set and correct for case data.
- The stronger pattern is serving documents from a **separate sandbox origin**. Named rather than
  recommended: it means another ingress host and CSP work for a residual risk that is a malicious PDF,
  whose scripting browser viewers sandbox away from our origin.

Two things to note rather than solve here. The browser's own PDF chrome follows the **browser's**
language, not the service's, so a Welsh user of a native viewer sees English controls — which is an
argument for pdf.js, where we own the labels. And **whether TIFF and Word are needed at all is
unconfirmed**: `upload-policy.ts` describes the list as "the common scan formats, and Word for documents
produced by the court" and flags it as unresearched. If the service team says scans arrive as PDF in
practice, the download-only row disappears and every document becomes viewable. Worth asking alongside
the file-size question that is already outstanding.

---

---

## Moving the shared infrastructure

[PR #64](https://github.com/hmcts/deed-poll-admin/pull/64) put the product resource group and Key Vault
in `deed-poll-admin/infrastructure/`, changing two `data` blocks into resources. Its argument was
partly that there was no second component repo to share them with. **There are now two**, so they move
to `hmcts/deed-poll-shared-infrastructure` and both components read them.

**There is no Terraform state to migrate.** `Terraform Apply` has never once succeeded — it fails at
`azure/login` for want of `AZURE_CREDENTIALS_CFT_PREVIEW` — so nothing PR #64 declared has ever been
created. That makes this a pure code move: no `terraform state mv`, no `terraform import`, no risk of
orphaning a live vault. **This window closes the moment the credentials land**, so do the move before
the first successful apply, not after.

What moves and what stays:

| Resource | From | To |
|---|---|---|
| `azurerm_resource_group.shared` — `deed-poll-{env}` | `deed-poll-admin/infrastructure/main.tf` | shared-infrastructure |
| `module.key_vault` + the `deed-poll-{env}-mi` workload identity | `deed-poll-admin/infrastructure/keyvault.tf` | shared-infrastructure |
| `random_password.session_secret` and its vault secret | same | shared-infrastructure — it is a product secret, not a component one |
| `azurerm_resource_group.rg` — `deed-poll-{env}-admin` | stays | — |
| App Insights, Postgres flexible server, their vault secrets | stay | — |

Both component repos then read the vault as a `data` source — which is what `deed-poll-admin` did
before PR #64, so that code is recoverable from its diff rather than needing to be rewritten.

Two things to get right in the new repo, both learned the hard way in #64:

- **Use `git::https://` for module sources, not `git@github.com:`.** Jenkins agents do have SSH keys, so
  the SSH form would work there — but keeping both repos on HTTPS means a module source can be copied
  between them without a silent failure.
- **`product_group_name` must name an AAD group that exists.** `cnp-module-key-vault`'s
  `team-access.tf` creates its access policy unconditionally, so an empty or wrong value fails the apply
  on an invalid `object_id`. `"DTS CFT Developers"` is the known-good placeholder; narrow it to a
  "DTS Deed Poll" group once one exists.

---

## Onboarding: the external critical path

**None of this depends on our code, all of it has lead time, and the longest item needs another team to
cut a release. Raise it all at once, first.**

| # | What | Where | Owner | Notes |
|---|---|---|---|---|
| 1 | S2S microservice `deed_poll_api` registered; `microservicekey-deed-poll-api` created in the `s2s-{env}` vault | service-auth-provider | ask **`#ccd-questions-answers`** | Mechanism verified from `pt-shared-infrastructure`: it reads `microservicekey-pt-api` from vault `s2s-{env}` in resource group `rpe-service-auth-provider-{env}` and copies it into its own vault. ~10 lines of our `keyvault.tf` once the secret exists |
| 2 | Add `deed_poll_api` to `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES` | `cnp-flux-config` | **`@hmcts/platform-operations`** | PR. PCS's cftlib config shows the shape of the list |
| 3 | CDAM `service_config.json`: our `caseTypeId`, `jurisdictionId`, permissions | `ccd-case-document-am-api` | **`dcd_ccd`** | **Needs a CDAM code change and release.** It is a classpath resource bound via `@PropertySource`, so unlike #2 it is *not* environment-overridable. Longest lead time here — start it first |
| 4 | Add our case type to `MOVING_CASE_TYPES` | `cnp-flux-config` | **`@hmcts/platform-operations`** | Same PR as #2 |
| 5 | `ccd.decentralised.case-type-service-urls[<CASE_TYPE>]` → our service URL | `ccd-data-store-api` or its Helm chart | **`dcd_ccd`** | This is what makes the case type decentralised |
| 6 | Case-type definition published; ES indices initialised on import | `ccd-definition-store-api` | **`dcd_ccd`** | Definition is generated by the SDK from `CCDConfig` |
| 7 | A Logstash pipeline reading `ccd.es_queue` into CCD's ES cluster | operational | **`dcd_ccd`** + Platform Ops | SDK provides the table and the trigger, not the pipeline. Use ES **external versioning starting above v1** so our writes beat stale centralised indexing |
| 8 | The `deed-poll` Kubernetes namespace | `cnp-flux-config`, most likely | **`@hmcts/platform-operations`** | Already outstanding from Phase 6 — fold it in |
| 9 | Onboard `deed-poll-api` to Jenkins: a job entry in `cnp-jenkins-config`, and the repo created with `Jenkinsfile_CNP` | `cnp-jenkins-config` | **`@hmcts/platform-operations`** | Settled 2026-09-04: the Java service is its own repo on Jenkins, so this replaces the earlier question about whether GitHub Actions is acceptable for Java. **No federated-credential PR is needed for it** |
| 10 | ACR path and Helm chart for `deed-poll-api` | ours | — | A new image under `hmctsprod.azurecr.io/deed-poll/`. Jenkins CNP handles ACR push conventionally, so this is chart work rather than a credentials request |
| 11 | Onboard `deed-poll-shared-infrastructure` to Jenkins | `cnp-jenkins-config` | **`@hmcts/platform-operations`** | Same conversation as row 9 |

**`#ccd-questions-answers` on Slack is the front door** for every `dcd_ccd` row — it is the support
channel named in both CDAM's and the data-store's Backstage `catalog-info.yaml` (`owner: dcd_ccd`).
Nobody has approached them yet.

**Not needed:** LaunchDarkly. ExUI's `mc-cdam-exclusion-list` is an *exclusion* list — secure mode is
on by default, so a new case type needs nothing. ExUI integration generally
(`DECENTRALISED_CASE_TYPE_CONFIG`, `ext:` event prefixes) is out of scope: this is an internal
caseworker service with its own frontend.

---

## Sequencing

**Hard dependency: `deed-poll-api` cannot be *deployed* until `deed-poll-admin`'s Terraform has run.**
Choosing Jenkins removes the credentials bottleneck from the Java service's own pipeline, so this is a
narrower dependency than it first looked — but it is still real, and the reason is worth being precise
about rather than hand-waving at "AAT must be green":

**`deed-poll-api`'s runtime dependencies are created by `deed-poll-admin`'s Terraform.** The Key Vault
holding its S2S secret, the Postgres flexible server holding its schema, and the resource groups all
come from `infrastructure/` in this repo — which cannot apply while `AZURE_CREDENTIALS_CFT_PREVIEW` is
missing. The `deed-poll` namespace is shared and still unconfirmed. So Stage 2 can *start* — scaffolding
and local development against `cftlib` need none of that — but Stage 4 onwards cannot be verified
against real CCD or real CDAM until Stage 1 lands.

That also raises a question this plan does not settle: with a second component repo, the usual reason
for a `deed-poll-shared-infrastructure` repo now applies where it did not before. See
[open question 6](#open-questions).

| Stage | Work | Gated on |
|---|---|---|
| **0** | Raise all eleven onboarding rows. Ask the open questions below. Create both new repos from the templates above and add them to `workspace.yaml` | nothing — do it now |
| **1** | **Move the shared infrastructure out** into its own repo, before any apply has happened — see [Moving the shared infrastructure](#moving-the-shared-infrastructure). Then get AAT green: the four Azure secrets, the namespace, first successful `Terraform Apply` and deploy | the move: nothing. The rest: the credentials |
| **2** | Scaffold `deed-poll-api`: Spring Boot 3, `ccd { decentralised = true }`, `CCDConfig`, `CaseView`, JPA entities and Flyway for the `public` tables. Pact tests modelled on `pcs-api:src/contractTest/java/`. Local verification via `cftlib` | **not** Stage 1 — can run in parallel |
| **3a** | **Prove decentralisation end to end, thin.** A case pointer, a deliberately minimal `CaseView`, one trivial `decentralisedEvent`, and one document through CDAM — deployed to AAT. No domain logic | Stage 2 + onboarding rows 1–6, 9 |
| **3b** | Port the domain against the proven skeleton, using the 386 TS test blocks as the specification. Re-point the 32 conformance tests at the Java schema | Stage 3a |
| **4** | The rest of CDAM and the events that use it, including withdraw/close and the admin hard delete | Stage 3b |
| **5** | Cut `apps/web` over to HTTP — 8 files, 11 operations, plus the new withdraw control. Delete `apps/api`. **Two ordered PRs across two repos**, since `deed-poll-api` must be deployed and serving before `apps/web` stops calling the domain in-process | Stage 4 |
| **6** | The operational tail: retain-and-dispose cron honouring CCD's authoritative `resolvedTTL`; Logstash pipeline; delete `apps/postgres/ccd-runtime/` | Stage 5 |

Stage 3b is the long pole in *our* work; onboarding row 3 is the long pole overall.

**Why 3a exists** (Steve's call, 2026-09-04): nobody here has done any of the CCD-facing work before —
the `/ccd-persistence/*` contract, S2S, the CDAM attach cycle, a Jenkins pipeline, a definition publish.
Doing those first, while the codebase is small enough to change cheaply, means the unknowns fail early
rather than on top of a large body of new Java. It also exercises the whole external onboarding chain
before the expensive work depends on it.

Accept two costs and do not let them drift into arguments for skipping 3a: **the minimal `CaseView` will
be rewritten** once real fields exist, and **the first event is mostly scaffolding**. Both are cheap
precisely because 3a is small. If 3a turns out to be hard, that is the finding — and much better learned
there than at Stage 4.

---

## What moves, what stays, what goes

| | |
|---|---|
| **Moves to Java** | `libs/deed-poll`'s query layer (**done** — every function is an adapter call now), Zod schemas → Bean Validation or equivalent, the conformance harness's *structural* layer (**done**, api commit `9db5fe3`), `file-storage.ts` → CDAM (**done here** — the file is deleted and api owns storage; CDAM itself is api's plan 03) |
| **Stays TypeScript** | All of `apps/web`: pages, Nunjucks, Welsh, IDAM login (Phase 5), session handling. Plus the parts of `libs/deed-poll` `apps/web` genuinely needs — `auth/roles`, `currentUser`, `upload-policy` constants, error types for HTTP mapping (15 auth + 16 root test blocks). **In the event this was more than expected and deliberately so**: the view models, the field-rule matrix, `case-state.ts` and the four rule layers of the conformance harness all stayed, because a rule enforced at both ends must be pinned at both ends |
| **Keeps a database connection** | ~~`apps/web`, even after the cutover.~~ ~~**No longer true as of 2026-09-07: sessions are in Redis.**~~ **Settled 2026-09-09: nothing in this repo holds a database credential.** `apps/web` is a pure UI over api plus its own session store, `postgres-url` is out of all four charts, and `deedPollDatabaseChecks` was replaced by `deedPollApiStatus()` — api reachability, with Redis alongside it, exactly as this row asked |
| **Deleted** | `apps/api` and its 261 route tests (**done**). `apps/postgres/ccd-runtime/` — 25 vendored SQL files the SDK's own Flyway replaces (**done**, with the rest of `apps/postgres`). The template's `onboarding/*` and `users*` routes (**done** — `libs/onboarding` and its eight pages went too, which is plan 03's task 1 carried out early) |
| **Decided separately** | Whether the deletes, witness writes, document-type writes and `validate` are ever rebuilt. Default: no, until something asks. **Still no**, except note delete, which api gained as its thirteenth caseworker operation (`847933a`) because admin's note form has always had the button |

**Protect the conformance harness.** Those 32 tests are the proof the migration did not silently drop
Dataverse columns — the correctness argument for the whole exercise. Re-point them at the Java schema
rather than letting them lapse, and carry their caveat with them: the Dataverse exports are
**alphabetically truncated (A–R)**, so they assert forward coverage only and must never be read as a
complete column set.

**Done, 2026-09-09, and the answer was "one layer of five moves".** Recorded in full at
[`libs/deed-poll/src/conformance/README.md`](../libs/deed-poll/src/conformance/README.md). The structural
layer is api's now — `9db5fe3` ported it and vendored the Dataverse exports, and api's version is strictly
stronger, because the TypeScript one only checked that its map *had a key* per source column and never that
the field it named existed. The four rule layers (`state-cascade`, `field-rules`, `conditional-gates`,
`enum-values`) stayed in admin, since the rules they pin are still applied there. The A–R caveat travelled
and is now *asserted* rather than merely documented — and it turns out to matter more than it read: the
columns the truncation hides are `Type`, `State` and `Urgency`, precisely the ones the four remaining
layers drive their rules from, so the two halves were always complementary rather than overlapping.

---

## Traps to carry forward

Each is already the cause of a real incident or a wrong assumption:

- **`DELETE /cases/documents/{id}` takes `permanent`, default `false`.** The FinRem rollout (DFR-4514)
  hit a pre-existing bug that began hard-deleting documents that should have been kept; manual recovery
  was needed. Our current `deleteFile` silently no-ops on a missing key — that polarity must not carry
  over to a call with a hard-delete switch on it.
- **`DOCUMENT_BINARY_URL` is a confirmed bug** — the constant's value is `"document_url"`, so
  `getDocumentId()` falls through. Read binary URLs from `links.binary.href`, as PCS does.
- **Rotating the S2S TOTP secret invalidates every previously issued hash token** — it is the salt.
- **A hash token is a single-use credential, not an identifier.** Do not cache it.
- **Intermittent 404s on retrieval during event processing** (CCD-7418, open). Retrying the event
  usually works; do not build a retry-free happy path.
- **Setting both `aboutToSubmitCallback` and a `submitHandler` on one event throws at startup.**
- **Annotate `CaseView.getCase` `@Transactional(readOnly = true)`.** The SDK opens no transaction, so
  without it you get `LazyInitializationException` or a query per association.
- **Populate `SearchCriteria` in `CaseView`** even if Global Search is not wanted — the reference
  implementation sets it explicitly.
- **Mark events `publish = true`** or the Work Allocation outbox row is never written and nothing
  downstream hears about the event.

---

## Open questions

The first two should be asked before Stage 2, because they can invalidate work:

1. **What are the jurisdiction and case-type IDs?** `MIGRATION_PLAN.md` assumes `DEED_POLL`; nothing
   has confirmed it. CDAM's `service_config.json` entry must match exactly — `validateCaseTypeId`
   compares the submitted `caseTypeId` against that list and 403s otherwise, so getting this wrong
   means going back to row 3 and waiting for another release.
2. **Is a Java service in this repo, deployed by GitHub Actions, acceptable to Platform Operations** —
   or does it want its own repo, or Jenkins? This changes Stage 2's shape and possibly the repo layout.
3. ~~**What does CCD buy deed-poll beyond CDAM?**~~ **Closed 2026-09-04 — CCD is expected of this
   service.** Steve confirmed. This was the only question whose answer would have made the plan
   unnecessary: had documents been the sole driver, Azure Blob would have been days of work with no
   external critical path and no second language. It is recorded as asked and answered so that the
   Blob off-ramp in `MIGRATION_PLAN.md` is understood as a fallback for a failure, not an alternative
   design still under consideration.
4. **Who creates the S2S microservice key?** The vault mechanism is verified;
   `rpe-service-auth-provider` 404s for the token in this container, so the request route is not.
5. **Can `PATCH /cases/documents/{documentId}` extend or clear a TTL on our own authority?** It is
   allowed by microservice ID rather than restricted to `ccd_data`. It would not fix download
   authorisation, so it does not rescue a CCD-free design — but it is worth knowing whether a document
   can be kept alive between upload and event commit.
6. ~~**Does the shared infrastructure move to a `deed-poll-shared-infrastructure` repo?**~~ **Closed
   2026-09-04 — yes, it moves.** This answer changed twice in a day, which is worth recording rather
   than tidying away: it was first left in `deed-poll-admin` on the grounds that no second component
   repo existed, then moved once the decision to serve two frontends made a third repo the convention
   anyway. The reasoning is at [Moving the shared
   infrastructure](#moving-the-shared-infrastructure), and the coupling the earlier answer accepted —
   a TypeScript repo owning the Java service's vault — is what the move removes.

