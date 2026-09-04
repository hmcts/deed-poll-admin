# `deed-poll-api` — re-platforming the backend onto Spring Boot

Written 2026-09-04. Supersedes Phase 10 of [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md), and the
`deed_poll_public_web` row of its decisions table, which recorded a citizen-facing app as out of scope.

## The decisions this plan rests on

All Steve's, taken 2026-09-04.

**1. The backend is re-platformed onto Spring Boot.** `apps/api` is replaced by `deed-poll-api`, which
owns persistence, the CCD contract and document handling. `apps/web` stays as the TypeScript caseworker
UI and moves from in-process domain calls to HTTP. Reasoning and the rejected alternative are under
[Why this shape](#why-this-shape).

**2. `deed-poll-api` serves two frontends, not one.** The existing caseworker admin app *and* a
citizen-facing app that does not exist yet. **This is the most consequential thing in this plan** — it
is why access control gets a section of its own, and it retires the `deed_poll_public_web` "out of
scope" decision.

**3. Three repos, all Java/Terraform ones on Jenkins.**

| Repo | Contains | Template | Build |
|---|---|---|---|
| `hmcts/deed-poll-admin` | `apps/web` (caseworker UI), `libs/` | `expressjs-monorepo-template` (already) | GitHub Actions |
| `hmcts/deed-poll-api` | Spring Boot backend, CCD config, CDAM | **`hmcts/spring-boot-template`** | Jenkins |
| `hmcts/deed-poll-shared-infrastructure` | product resource group, Key Vault, workload identity | **none — see below** | Jenkins |
| a citizen frontend, later | not yet specified | — | — |

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

Target:

```
   caseworker (internal)                        citizen (public internet)
   platform.hmcts.net                           www.gov.uk journey
          │                                              │
          ▼                                              ▼
 ╔═ deed-poll-admin ═══════════╗            ╔═ citizen frontend ══════════╗
 ║  apps/web                   ║            ║  not yet specified          ║
 ║  Nunjucks, Welsh, viewer    ║            ║  own IDAM client            ║
 ║  IDAM client: HMCTS_ACCESS  ║            ║  citizen frontend           ║
 ╚══════════════┬══════════════╝            ╚══════════════┬══════════════╝
                │                                          │
                │   HTTPS, forwarding the user's IDAM token │
                └────────────────────┬─────────────────────┘
                                     ▼
 ╔═ deed-poll-api ═══════════════════════════════════════════════════════╗
 ║  /caseworker/**   ─┐                                                  ║
 ║  /citizen/**      ─┴─► domain logic, separate DTOs per audience        ║
 ║  CaseView          decentralised events          CDAM client          ║
 ║  NOT internet-facing — reachable only from the two frontends          ║
 ╚══┬═══════════════════┬══════════════════┬════════════════════════════╝
    │                   │                  │
    │        S2S + user │        S2S + user│
    │             token │             token│
    │                   ▼                  ▼
    │        ccd-data-store-api          CDAM ──────► dm-store
    │                   │                              (binaries live here)
    │                   │ /ccd-persistence/*
    │                   └──────► back into deed-poll-api
    │                                              ▲
    │                     AM / Role Assignment ────┘ case-level access
    ▼
 PostgreSQL  (one server, one database)
   ├─ public schema   domain tables   ← owned by deed-poll-api (Flyway)
   ├─ ccd schema      case_data, case_event,
   │                  message_queue_candidates, es_queue
   │                                  ← owned by the SDK (Flyway)
   └─ session table                   ← owned by apps/web (pg.Pool)
```

**One API for both audiences is the right call, and it is what the estate does** — `pcs-api` and
`nfdiv-case-api` each serve a citizen frontend and a caseworker surface. What makes it safe is *not*
that the API is one service; it is that access control is declared in the CCD configuration rather than
hand-written per endpoint. That is the next section, and it is the part to get right.

A write leaves and comes back, which is the counterintuitive part:

```
  apps/web ──1──► deed-poll-api ──2──► ccd-data-store-api
                       ▲                      │
                       │                      │ 3  routes on ccd.decentralised
                       └──────4───────────────┘    .case-type-service-urls
                    /ccd-persistence/cases

  5  our submit handler runs: domain write + CDAM attach, one transaction
```

## Access control with two audiences

This is the highest-risk part of serving both apps from one backend: a filtering mistake leaks another
person's name-change case. Get the model right and most of the risk is designed out rather than
tested for.

### Roles are declared, not coded

The SDK's `HasRole` model is the mechanism, and `pcs-api`'s `UserRole` enum is the worked example. Each
role carries a name, a permission set, and — crucially — **where the role comes from**:

```java
public enum UserRole implements HasRole {
    CITIZEN("citizen", CRU, IDAM),            // an IDAM role: "any citizen"
    CREATOR("[CREATOR]", CRU, RAS),           // a CCD case role: "this case, this person"
    PCS_CASE_WORKER("caseworker-pcs", Set.of(R), IDAM),
    ...
}
```

Two things to take from that:

- **`RoleType.IDAM` versus `RoleType.RAS`.** IDAM roles say what kind of user someone is. RAS roles —
  the ones in `[SQUARE_BRACKETS]` — come from AM / Role Assignment Service and say *which cases* this
  particular user may touch. **A citizen's access to their own case is a RAS case role, not an IDAM
  role.** `CITIZEN` alone must never be enough to read a case.
- **Permissions are per role**: `CRU` for a party who may edit, `Set.of(R)` for a caseworker who may
  only read. Event-level grants (`.grant(Set.of(CREATE, READ, UPDATE), UserRole.CASEWORKER)`) and
  field-level access profiles then express, declaratively, that a caseworker note is invisible to a
  citizen.

So the citizen/caseworker split belongs in `deed-poll-api`'s CCD configuration. Do not write it as `if`
statements in controllers.

### The gap this does not close, and it is a real one

**CCD's access control governs the CCD path only** — events submitted through data-store, and the
`CaseView` projection CCD asks for. It does **not** police bespoke REST endpoints we write on the same
service. Every one of the direct `frontend → deed-poll-api` reads is ours to authorise, and CCD is not
in that path at all.

Three disciplines, and the plan recommends all three rather than picking one:

1. **Separate endpoint namespaces — `/caseworker/**` and `/citizen/**`** — with separate controllers.
   Never one endpoint that behaves differently by role.
2. **Never share a response DTO between audiences.** A caseworker DTO that gains a field is then
   incapable of leaking it to a citizen, because the citizen DTO is a different class. This is the single
   cheapest guardrail available and it survives people who have not read this document.
3. **Authorise citizen reads against case access explicitly.** A citizen may see a case because they are
   a party to it — so check that, in our own data, on every citizen read. Do not infer it from the fact
   that a valid citizen token arrived. CDAM already works this way: it asks data-store whether the user
   may read the field holding the document rather than trusting the caller.

### The two auth relationships, which are easy to conflate

| Hop | Credential | Notes |
|---|---|---|
| `apps/web` → `deed-poll-api` | ours to choose; simplest is forwarding the user's IDAM token | `apps/api` already does exactly this — it mounts `authenticate()` globally and reads bearer tokens |
| `deed-poll-api` → CCD and CDAM | **S2S is mandatory** — a `microservicekey-*` secret — plus an IDAM user or system token | This is what onboarding row 1 requests. **Nothing about the web↔api handshake produces it** |

PCS puts **both** `pcs_frontend` and `pcs_api` in `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES`, so their
frontend holds its own S2S identity and reaches CDAM directly. That is a legitimate alternative for
downloads — it avoids streaming binaries through Java twice — at the cost of two services knowing about
CDAM and two S2S secrets. The diagram above shows the simpler shape; decide it deliberately rather than
by accident.

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
| 12 | **A second IDAM client for the citizen app** | `hmcts/idam-access-config` | IDAM | Separate registration from the caseworker one: a citizen frontend rather than `HMCTS_ACCESS`, its own redirect URIs, its own client secret in the vault. **Do not extend the existing client** — the two have different audiences, roles and security postures. The caseworker registration PR is still awaiting IDAM, so raise this once that one lands and its shape is confirmed |
| 13 | **Citizens need case-level access via AM / Role Assignment** | `am-role-assignment-service` | **`dcd_ccd`** / AM | A citizen sees their own case through a RAS case role — `[CREATOR]` or a party role — not through the `citizen` IDAM role. Ask what a service like ours is expected to do here; it is the mechanism the whole citizen journey rests on |

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
| **0** | Raise all thirteen onboarding rows. Ask the open questions below. Create both new repos from the templates above and add them to `workspace.yaml` | nothing — do it now |
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
| **Moves to Java** | `libs/deed-poll` domain services, Zod schemas → Bean Validation or equivalent, the conformance harness, `file-storage.ts` → CDAM |
| **Stays TypeScript** | All of `apps/web`: pages, Nunjucks, Welsh, IDAM login (Phase 5), session handling. Plus the parts of `libs/deed-poll` `apps/web` genuinely needs — `auth/roles`, `currentUser`, `upload-policy` constants, error types for HTTP mapping (15 auth + 16 root test blocks) |
| **Keeps a database connection** | `apps/web`, even after the cutover. `@hmcts-cft/express-session-postgres` holds sessions in Postgres over a `pg.Pool`, so `apps/web` still needs database credentials and still owns the session table. **"`apps/web` becomes a pure UI" is therefore not quite true** — it stops owning case data, not all persistence. Its readiness check (`deedPollDatabaseChecks`) will need re-pointing at what it actually depends on rather than at the case tables |
| **Deleted** | `apps/api` and its 261 route tests. `apps/postgres/ccd-runtime/` — 25 vendored SQL files the SDK's own Flyway replaces. The template's `onboarding/*` and `users*` routes |
| **Decided separately** | Whether the deletes, witness writes, document-type writes and `validate` are ever rebuilt. Default: no, until something asks |

**Protect the conformance harness.** Those 32 tests are the proof the migration did not silently drop
Dataverse columns — the correctness argument for the whole exercise. Re-point them at the Java schema
rather than letting them lapse, and carry their caveat with them: the Dataverse exports are
**alphabetically truncated (A–R)**, so they assert forward coverage only and must never be read as a
complete column set.

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

## Open questions the citizen app raises

New with the two-frontend decision. None blocks Stage 2, but 7 and 8 shape what gets built and are
worth asking early.

7. **Does the citizen journey take a payment?** `feeReference`, `refundAmount`, `dateOfRefund` and
   `refundReference` are already in the schema, which strongly suggests yes. If so it is a **new
   integration that appears nowhere in this plan** — HMCTS Payments and GOV.UK Pay, with its own S2S
   onboarding, its own callbacks and a refund path. Ask before designing the citizen surface, because
   payment usually shapes the journey rather than being bolted onto it.
8. **What is the citizen's relationship to the case, in AM terms?** A citizen sees their own case
   through a RAS case role, and something has to grant it at the point the case is created. Is that
   `[CREATOR]`, a party role, or an access-code link as PCS uses for defendants? This is the mechanism
   the entire citizen journey rests on, so it is worth a specific answer from `dcd_ccd` rather than an
   assumption.
9. **Do the two frontends each need their own S2S identity?** PCS registers both `pcs_frontend` and
   `pcs_api` in `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES`, so their frontend talks to CDAM directly. If
   `deed-poll-api` does all CDAM work, the frontends need none — which is one fewer secret each and the
   shape this plan assumes. Confirm rather than inherit.
10. **Is the same case type right for both audiences?** One case type with role-scoped events is the
    normal answer and what this plan assumes. Worth confirming with `dcd_ccd` that nothing about a
    citizen-initiated application argues for a separate one, because splitting later is expensive —
    it means a second `service_config.json` entry and another CDAM release.
