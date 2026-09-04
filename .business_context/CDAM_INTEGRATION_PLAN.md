# Documents via CDAM, and replacing `apps/api` with Spring Boot

Written 2026-09-04. Supersedes Phase 10 of [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md).

**Decision: `apps/api` is replaced by a Spring Boot service, `deed-poll-api`.** It owns persistence,
the CCD contract and document handling. `apps/web` stays as the TypeScript UI and moves from in-process
domain calls to HTTP. Steve's call on 2026-09-04, for the long-term benefit; the reasoning and the
alternative that was rejected are recorded under [Why this shape](#why-this-shape).

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

- **Every delete.** `apps/web` performs no deletes of any kind — not cases, notes, witnesses,
  documents or document types. This includes the unguarded cascading case delete recorded as loose
  end 5, which is worth deciding about on its own merits rather than carrying forward by inertia.
- **Witness writes.** Witnesses are *read* — they arrive nested inside `findDeedPoll` and
  `detail.njk` renders them — but nothing creates, updates or deletes one.
- **Document-type writes**, the `validate` endpoint, and document list/metadata.
- `onboarding/*` and `users*`, which are expressjs-monorepo-template leftovers.

Build the eleven. Add the rest when something asks for it.

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
| 9 | Confirm a **Java service deployed by GitHub Actions** is acceptable, or whether it wants Jenkins | — | **`@hmcts/platform-operations`** | Sharpens the existing unanswered GHA question: a Java service in this estate is conventionally Jenkins |
| 10 | ACR path, image and Helm subchart for a second deployable | ours, but needs #9 answered | — | `deed-poll-api` is a new image under `hmctsprod.azurecr.io/deed-poll/` |

**`#ccd-questions-answers` on Slack is the front door** for every `dcd_ccd` row — it is the support
channel named in both CDAM's and the data-store's Backstage `catalog-info.yaml` (`owner: dcd_ccd`).
Nobody has approached them yet.

**Not needed:** LaunchDarkly. ExUI's `mc-cdam-exclusion-list` is an *exclusion* list — secure mode is
on by default, so a new case type needs nothing. ExUI integration generally
(`DECENTRALISED_CASE_TYPE_CONFIG`, `ext:` event prefixes) is out of scope: this is an internal
caseworker service with its own frontend.

---

## Sequencing

**Hard dependency: do not start Stage 2 until AAT is green.** Today nothing deploys — four Azure
secrets are missing, the namespace is unconfirmed and `Terraform Apply` is red. `deed-poll-api` is a
*second* deployable: another image, another subchart, another ACR path, another S2S identity, and
question 9 above. Adding deployables to an onboarding path that is already the bottleneck makes the
bottleneck worse, and a Java service that cannot be deployed cannot be verified against real CCD or
real CDAM either.

| Stage | Work | Gated on |
|---|---|---|
| **0** | Raise all ten onboarding rows. Ask the two open questions below | nothing — do it now |
| **1** | Get AAT green: the four Azure secrets, the namespace, first successful `Terraform Apply` and deploy | the credentials, not us |
| **2** | Scaffold `deed-poll-api`: Spring Boot 3, `ccd { decentralised = true }`, `CCDConfig`, `CaseView`, JPA entities and Flyway for the `public` tables. Pact tests modelled on `pcs-api:src/contractTest/java/` | Stage 1 |
| **3** | Port the domain, using the 386 TS test blocks as the specification. Re-point the 32 conformance tests at the Java schema | Stage 2 |
| **4** | CDAM: the four flows, plus the decentralised events that attach and remove documents | Stage 3 + onboarding rows 1–5 |
| **5** | Cut `apps/web` over to HTTP — 8 files, 11 operations. Delete `apps/api` | Stage 4 |
| **6** | The operational tail: retain-and-dispose cron honouring CCD's authoritative `resolvedTTL`; Logstash pipeline; delete `apps/postgres/ccd-runtime/` | Stage 5 |

Stage 3 is the long pole in *our* work; row 3 is the long pole overall.

---

## What moves, what stays, what goes

| | |
|---|---|
| **Moves to Java** | `libs/deed-poll` domain services, Zod schemas → Bean Validation or equivalent, the conformance harness, `file-storage.ts` → CDAM |
| **Stays TypeScript** | All of `apps/web`: pages, Nunjucks, Welsh, IDAM login (Phase 5), session handling. Plus the parts of `libs/deed-poll` `apps/web` genuinely needs — `auth/roles`, `currentUser`, `upload-policy` constants, error types for HTTP mapping (15 auth + 16 root test blocks) |
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
3. **What does CCD buy deed-poll beyond CDAM?** Raised and not closed. If documents are the only
   driver, Azure Blob in our own storage account is days of work with no external critical path and no
   second language. The counters — retention, audit trail, access control, and HMCTS convention for
   case-handling services — are real, but this is the service owner's question, and it is the only one
   whose answer makes this entire plan unnecessary. Worth confirming explicitly rather than inheriting
   from a plan written in August.
4. **Who creates the S2S microservice key?** The vault mechanism is verified;
   `rpe-service-auth-provider` 404s for the token in this container, so the request route is not.
5. **Can `PATCH /cases/documents/{documentId}` extend or clear a TTL on our own authority?** It is
   allowed by microservice ID rather than restricted to `ccd_data`. It would not fix download
   authorisation, so it does not rescue a CCD-free design — but it is worth knowing whether a document
   can be kept alive between upload and event commit.
