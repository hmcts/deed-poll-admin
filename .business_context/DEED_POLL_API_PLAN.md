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
citizen-facing app that does not exist yet. This retires the `deed_poll_public_web` "out of scope"
decision, and it is why the API has two endpoint namespaces rather than one. Read it together with
decision 5, which constrains what the citizen side actually needs in release 1 — the two decisions
together are the difference between a fortnight of access-control design and none.

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

**5. Release 1 of the citizen journey is an anonymous form that takes a payment.** Steve, 2026-09-04. It
duplicates an existing MoJ form: the applicant completes the fields, pays, and gets a success message.
**No account, no login, no portal, no progress tracking** — those come later.

This is the single most simplifying fact in the plan and it is easy to lose, so it is stated here
rather than buried: **release 1 needs no citizen IDAM client, no citizen login, and no case-level
access control for citizens.** A citizen never returns to read anything. See [Release 1 is anonymous,
and that changes the design](#release-1-is-anonymous-and-that-changes-the-design).

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

Target, as release 1 actually is — note the citizen side has **no login**:

```
   caseworker (internal)                    applicant (public internet)
   platform.hmcts.net                       anonymous, no account
          │                                              │
          │ IDAM login (HMCTS_ACCESS)                     │ no login
          ▼                                              ▼
 ╔═ deed-poll-admin ═══════════╗            ╔═ citizen frontend ══════════╗
 ║  apps/web                   ║            ║  not yet specified          ║
 ║  Nunjucks, Welsh, viewer    ║            ║  form + pay + success page  ║
 ╚══════════════┬══════════════╝            ╚══════════════┬══════════════╝
                │                                          │
       user IDAM token + S2S                          S2S only
                │                                          │
                └────────────────────┬─────────────────────┘
                                     ▼
 ╔═ deed-poll-api ═══════════════════════════════════════════════════════╗
 ║  /caseworker/**  ─┐                                                   ║
 ║  /citizen/**     ─┴─► domain logic, separate DTOs per audience         ║
 ║  CaseView         decentralised events        CDAM client             ║
 ║  holds a SYSTEM-USER IDAM token: acts for the anonymous applicant     ║
 ║  NOT internet-facing — reachable only from the two frontends          ║
 ╚══┬═════════════┬═════════════┬══════════════════════╦═════════════════╝
    │             │             │                      ║
    │  S2S + user │  S2S + user │           S2S + user ║ (system user)
    │       token │       token │                token ║
    │             ▼             ▼                      ▼
    │   ccd-data-store-api    CDAM ──► dm-store    ccpay-payment-app
    │             │            (binaries)           │  ("Fees and Pay")
    │             │ /ccd-persistence/*              ├──► GOV.UK Pay
    │             └──► back into deed-poll-api      └──► Fees Register
    │                                                     │
    │   payment status ◄── Azure Service Bus ◄─────────────┘
    ▼      (ccpay-service-callback-topic)
 PostgreSQL  (one server, one database)
   ├─ public schema   domain tables   ← owned by deed-poll-api (Flyway)
   ├─ ccd schema      case_data, case_event,
   │                  message_queue_candidates, es_queue
   │                                  ← owned by the SDK (Flyway)
   └─ session table                   ← owned by apps/web (pg.Pool)
```

**The later portal release adds** a citizen IDAM client, citizen login, and case-level access through
AM / Role Assignment so an applicant can return and see their own case. None of that is release 1.

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

## Release 1 is anonymous, and that changes the design

An earlier draft of this plan designed an elaborate citizen access-control model — IDAM citizen client,
RAS case roles, `[CREATOR]`, per-audience read authorisation. **That is the portal release, not release
1.** Recorded as a correction rather than quietly deleted, because the elaborate version is what someone
will otherwise reinvent.

For release 1 the citizen is never authenticated, so there is nothing to authorise:

| Concern | Release 1 | The later portal |
|---|---|---|
| Citizen IDAM client | **not needed** | needed, separate from `HMCTS_ACCESS` |
| Citizen login / session | **none** | OIDC, as `apps/web` already does |
| Citizen case-level access (RAS, `[CREATOR]`) | **not needed** — nobody comes back | the mechanism the whole portal rests on |
| `/citizen/**` read endpoints | **none** — there is nothing to read | the bulk of the portal |
| `/citizen/**` write endpoints | **one**: submit an application | plus amend, withdraw, respond |

### What replaces citizen authentication

The citizen frontend has no user token to forward, because there is no user. Two things fill the gap,
and both are established patterns rather than inventions:

- **The citizen frontend authenticates as a service.** Its calls to `deed-poll-api` carry S2S only. So
  the citizen frontend **does** need its own S2S identity — which answers what was open question 9. Do
  not instead let `deed-poll-api` accept unauthenticated calls on `/citizen/**` and rely on network
  topology.
- **A system user creates the case.** CCD events need a user, and payments need an IDAM user JWT, so
  `deed-poll-api` obtains a system-user token. PCS does exactly this: `SYSTEM_USER("pcs-system-update",
  CRU, IDAM)` in its `UserRole` enum, `CcdRoleConfig("pcs-system-update", "PUBLIC")` in its CCD setup,
  and an `IdamTokenProvider` bean qualified `systemUpdateUserTokenProvider`. We need the equivalent
  IDAM account and CCD role — call it `deed-poll-system-update`.

**The honest consequence: an unauthenticated public endpoint creates cases and initiates payments.**
That wants rate limiting and a deliberate look at abuse before go-live. The fee is a partial gate — an
abandoned journey costs the abuser nothing but produces no completed application — but it does not stop
someone filling the database with unpaid drafts. Not solved here; flagged as
[open question 11](#open-questions-the-citizen-app-raises).

### Documents, which work out neatly

Worth noting because it looks like a problem and is not. **CDAM upload is S2S-only**, so a citizen
uploading evidence works with a service identity and no user token. **CDAM download requires a user
JWT**, so a citizen could never re-download their own document — which is exactly consistent with
having no portal. Caseworkers download with their own tokens. Nothing needs designing around.

---

## Access control, for when the portal arrives

Not release 1 work. Kept because the model is the reason one API for both audiences is safe, and
because getting it wrong later leaks another person's name-change case.

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

## Payment: Fees and Pay, and where GOV.UK Pay sits

Steve asked where GOV.UK Pay fits. **We never call it.** The layering, from
`apps/payment/CLAUDE.md`:

```
  deed-poll-api
       │  IDAM user JWT (system user) + S2S      ← both required on every call
       ▼
  ccpay-payment-app         "Fees and Pay" — the hub, port 8080
       │  modules: payment-api, gov-pay-client, payment-reference-data, …
       ├──────► GOV.UK Pay public API        card processing
       ├──────► the Fees Register            fee codes and amounts
       ├──────► Liberata                     PBA account validation (not us)
       └──────► PCI-PAL Antenna / Kerv       telephony payments (not us)

  payment status comes back via Azure Service Bus
  (ASB_CONNECTION_STRING / ccpay-service-callback-topic)
```

So "Fee and Pay" is `apps/payment` — the workspace labels it *Fees & Pay* — and **GOV.UK Pay is an
implementation detail behind `ccpay-payment-app`'s `gov-pay-client` module.** We integrate with
`ccpay-payment-app` and nothing else.

Four things that follow, each of which shapes the journey:

1. **Every payment-app call needs an IDAM user JWT *and* an S2S JWT.** An anonymous citizen supplies
   neither, so both come from `deed-poll-api`: the system-user token and our own S2S identity. This is
   the main reason the system user is not optional.
2. **`deed_poll_api` must be added to `ccpay-payment-app`'s trusted service list.** It currently covers
   about twenty CFT services — `cmc`, `ccd_gw`, `xui_webapp`, `pcs_api`, `civil_service`,
   `nfdiv_case_api` and so on. That is an onboarding request to the payments team, and it is a *separate*
   list from CDAM's `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES`.
3. **Payment status arrives asynchronously, over Azure Service Bus.** Do not treat the browser's return
   from GOV.UK Pay as proof of payment — it tells you the user came back, not that the money moved. The
   `ccpay-service-callback-topic` subscription is the authoritative signal, which means the citizen
   journey needs a state that means "submitted, payment not yet confirmed".
4. **There is already a citizen-facing payment outcome page in the estate** —
   `ccpay-paymentoutcome-web`, an Express/TypeScript app on port 3100. Worth looking at before building
   our own success page; it may be reusable or at least a pattern to copy.

### The ordering question, which needs deciding before the citizen surface is designed

"Payment before the success message" leaves one genuine choice: is the case created before or after the
payment succeeds?

| | Before payment | After payment |
|---|---|---|
| Abandoned journeys | leave unpaid cases in the data | leave nothing |
| Where form data lives during payment | the case | a session or draft store |
| Payment reference attaches to | an existing case — simple | something that does not exist yet |

**Recommendation: create the case first, in a state that means "awaiting payment", and move it on when
the Service Bus callback confirms.** It matches the asynchronous reality of point 3, it means the payment
reference always has a case to attach to, and CCD's authoritative `resolvedTTL` plus the
retain-and-dispose cron already give a mechanism for reaping abandoned drafts — a mechanism this plan
needs anyway. The cost is unpaid cases being visible to caseworkers, so the case list wants a filter that
excludes them by default.

`feeReference`, `refundAmount`, `dateOfRefund` and `refundReference` already exist in the schema, so the
refund path is anticipated by the domain model even though release 1 may not exercise it.

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
| 12 | **An IDAM system user, `deed-poll-system-update`**, plus the matching CCD role | `hmcts/idam-access-config` + our `CCDConfig` | IDAM | **Release 1 depends on this.** It is what creates a case and calls payments on behalf of an anonymous applicant. PCS's equivalent is `pcs-system-update`, registered as `CcdRoleConfig("pcs-system-update", "PUBLIC")`. Not the same thing as the caseworker client already awaiting IDAM |
| 13 | **An S2S identity for the citizen frontend** | service-auth-provider | IDAM / S2S | Its calls to `deed-poll-api` carry S2S only, because there is no user token in release 1. Same request route as row 1 |
| 14 | **Add `deed_poll_api` to `ccpay-payment-app`'s trusted service list** | `hmcts/ccpay-payment-app` | payments team | A **separate** list from CDAM's. Currently covers ~20 CFT services (`pcs_api`, `nfdiv_case_api`, `civil_service`, …). Needed before any payment call works |
| 15 | Fee code and amount for a deed poll application, from the Fees Register | the Fees Register | payments / service team | `ccpay-payment-app` calls the register; we need the fee code the journey should quote. The register's repo is not in this workspace and I could not confirm its name, so ask rather than guess |
| 16 | Azure Service Bus subscription to `ccpay-service-callback-topic` | `cnp-flux-config` / payments | **`@hmcts/platform-operations`** + payments | The authoritative payment-status signal. Not the browser redirect |
| — | ~~A citizen IDAM client~~ | | | **Deferred to the portal release.** Release 1 has no citizen login, so there is nothing to register yet |
| — | ~~Citizen case access via AM / Role Assignment~~ | | | **Deferred to the portal release.** Nobody returns to read a case in release 1 |

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
| **0** | Raise all sixteen onboarding rows. Ask the open questions below. Create both new repos from the templates above and add them to `workspace.yaml` | nothing — do it now |
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

7. ~~**Does the citizen journey take a payment?**~~ **Answered 2026-09-04 — yes, before the success
   message.** Via Fees and Pay, which is `ccpay-payment-app`; GOV.UK Pay sits behind it and we never call
   it directly. See [Payment](#payment-fees-and-pay-and-where-govuk-pay-sits). Four onboarding rows and
   one design decision came out of it.
8. ~~**What is the citizen's relationship to the case, in AM terms?**~~ **Not a release 1 question.**
   Release 1 has no citizen account, so nobody returns to read a case. Deferred with the portal.
9. ~~**Do the two frontends each need their own S2S identity?**~~ **Answered: the citizen frontend does.**
   It has no user token to forward in release 1, so its calls to `deed-poll-api` carry S2S only.
   `apps/web` still forwards a real caseworker token and needs none unless it ever talks to CDAM directly.
10. **Is the same case type right for both audiences?** Still open. One case type with role-scoped events
    is the normal answer and what this plan assumes. Worth confirming with `dcd_ccd` that nothing about an
    anonymous citizen-initiated application argues for a separate one, because splitting later is
    expensive — a second `service_config.json` entry and another CDAM release.
11. **What stops abuse of an unauthenticated public submission endpoint?** Release 1 exposes one, and it
    creates cases and initiates payments. The fee is a partial gate — an abandoned journey produces no
    completed application — but nothing stops someone filling the database with unpaid drafts. Needs a
    deliberate answer before go-live: rate limiting at the ingress, and a view on whether drafts should
    be reaped faster than the retention period.
12. **Create the case before or after payment?** Recommended in the payment section — before, in an
    "awaiting payment" state, moved on by the Service Bus callback. Recorded as a question because it
    is a service decision with a visible consequence: unpaid cases appear in the caseworker list unless
    filtered out by default.
