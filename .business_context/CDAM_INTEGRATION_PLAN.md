# Documents via CDAM — integration plan

Written 2026-09-04. Supersedes Phase 10 of [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md), which assumed a
TypeScript implementation.

**Decision taken: follow the PCS shape.** A new Spring Boot service owns the CCD contract and the
document handling; `apps/web` stays as the TypeScript UI. Steve's call, on the grounds that the only
working examples of decentralised CCD in HMCTS are Java, and the SDK is a hard prerequisite rather
than a convenience.

---

## The thing to understand first

**CDAM stores nothing.** It is an access-control gate in front of `document-management-store-app`
(dm-store). The binary lives in dm-store's blob storage, and the URLs CDAM returns still resolve to a
dm-store host. What CDAM adds is case-scoped permission checks, hash-token tamper detection, and a
TTL/attach lifecycle.

Two consequences that shape everything below:

1. **We never address dm-store.** Service teams must use CDAM exclusively; nfdiv's
   `CaseDocumentAccessManagement` never calls dm-store, and neither should we. deed-poll should hold
   no dm-store URL.
2. **CDAM is useless without CCD events.** `PATCH /cases/documents/attachToCase` — the call that
   clears the upload TTL — is S2S-restricted to `ccd_data`, so only ccd-data-store may make it.
   Without an event attaching a document, it **auto-deletes after `DOCUMENT_TTL_IN_DAYS`, default 1**,
   and until the event commits only the uploading user can read it; everyone else gets 403. So
   "adopt CDAM" necessarily means "adopt decentralised CCD".

---

## Target architecture

```
        browser
           │
      apps/web  (TypeScript, Express + Nunjucks — UI only)
           │  HTTP
    deed-poll-api  (NEW — Spring Boot 3, ccd-config-generator SDK)
       │        │
       │        └── CaseDocumentClientApi ──► CDAM ──► dm-store
       │
   PostgreSQL  (public schema + ccd schema)
       ▲
       └── ccd-data-store-api  ──► /ccd-persistence/* on deed-poll-api
```

`ExUI` is optional and not assumed: this is an internal caseworker service with its own frontend, so
step 10 of the decentralisation how-to (`DECENTRALISED_CASE_TYPE_CONFIG`, `ext:` event prefixes) is
out of scope unless someone wants deed-poll in ExUI later.

---

## What the Java route actually buys

Measured against what the TypeScript route would have had to hand-build:

| Concern | TypeScript | Java |
|---|---|---|
| S2S token (TOTP) | hand-rolled; no S2S code exists anywhere in this repo today | `authTokenGenerator.generate()` — `service-auth-provider-java-client` |
| CDAM calls | hand-rolled HTTP client | `CaseDocumentClientApi` Feign interface — `com.github.hmcts:ccd-case-document-am-client` (PCS pins `1.59.2`) |
| The five `/ccd-persistence/*` endpoints | hand-built, with idempotency and monotonic revision | `ServicePersistenceController`, wired automatically by `decentralised = true` |
| `ccd` schema (`case_data`, `case_event`, `message_queue_candidates`, `es_queue`) | hand-vendored SQL | SDK Flyway, `classpath:dataruntime-db/migration` |
| Work Allocation messages | hand-built publisher | SDK transactional outbox; **only** thing to do is mark events `publish = true` |

That last column is why the decision is right. It also makes
`apps/postgres/ccd-runtime/` — the 25 vendored SQL files from `ccd-config-generator` — **redundant**,
because the SDK runs those migrations itself. Deleting it is a downstream tidy-up, not a first step.

Two things the SDK does *not* do, which remain real work: a **Logstash pipeline** reading `ccd.es_queue`
into CCD's ES cluster (step 8), and a **retain-and-dispose cron** honouring CCD's authoritative
`resolvedTTL` (step 9).

---

## Start here: the external critical path

**These are identical under every design option below, they all have lead times, and none of them
depends on a line of our code. Raise them first.**

| # | What | Where | Owner | Notes |
|---|---|---|---|---|
| 1 | S2S microservice `deed-poll-api` registered, `microservicekey-deed-poll-api` created in the `s2s-{env}` vault | service-auth-provider | **ask `#ccd-questions-answers`** | Verified mechanism: `pt-shared-infrastructure` reads `microservicekey-pt-api` from vault `s2s-{env}` in resource group `rpe-service-auth-provider-{env}` and copies it into its own vault. ~10 lines in our `keyvault.tf` once the secret exists |
| 2 | Add `deed_poll_api` to `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES` | `cnp-flux-config` | **`@hmcts/platform-operations`** | PR |
| 3 | CDAM `service_config.json` entry: our `caseTypeId`, `jurisdictionId`, permissions | `ccd-case-document-am-api` | **`dcd_ccd`** | **Needs a CDAM code change and release** — it is a classpath resource bound via `@PropertySource`, so unlike #2 it is *not* environment-overridable. Likely the longest lead time here |
| 4 | Add our case type to `MOVING_CASE_TYPES` | `cnp-flux-config` | **`@hmcts/platform-operations`** | Same PR as #2 |
| 5 | `ccd.decentralised.case-type-service-urls[DEED_POLL]` → our service URL | `ccd-data-store-api` or its Helm chart | **`dcd_ccd`** | **The presence of this URL is what marks a case type decentralised** — there is no flag in the definition |
| 6 | Case-type definition published; ES indices initialised on import | `ccd-definition-store-api` | **`dcd_ccd`** | |
| 7 | The `deed-poll` Kubernetes namespace | `cnp-flux-config`, most likely | **`@hmcts/platform-operations`** | Already outstanding from Phase 6 — fold it into the same conversation |
| 8 | Confirm GitHub Actions is a supported deployment route for a CFT service | — | **`@hmcts/platform-operations`** | Already flagged in `PROGRESS.md`; a Java service in this estate is conventionally Jenkins, so this question gets sharper, not softer |

**`#ccd-questions-answers` on Slack is the front door** for every `dcd_ccd` row — it is the support
channel named in both CDAM's and the data-store's Backstage `catalog-info.yaml` (`owner: dcd_ccd`).
Nobody has approached them yet.

Not needed: `@hmcts/evidence`, who own dm-store. We go through CDAM.

Not needed: LaunchDarkly. ExUI's `mc-cdam-exclusion-list` is an *exclusion* list — secure mode is on
by default, so a new case type needs nothing.

---

## The open design decision: how much moves to Java

This is the decision that separates "weeks" from "months", and it is **not** settled by choosing the
PCS shape. The reason it matters here more than it did for PCS: PCS was Java from the start, whereas
we have a working TypeScript domain layer — `libs/deed-poll`, 25 suites and 441 tests — and 5 Prisma
models.

Relevant fact, because it is easy to assume otherwise: **`apps/web` imports `libs/deed-poll`
in-process and makes no HTTP calls at all.** Both apps are independent consumers of the same
in-process domain library, each talking to Postgres through Prisma. Call sites doing data access:
**8 files in `apps/web`, 22 in `apps/api`.**

### Option A — full PCS: Java owns all persistence

Port the domain to Java (JPA entities, 441 tests), retire `apps/api`, make `apps/web` a pure UI over
HTTP. Cleanest end state and exactly what PCS does.

**Cost: it discards most of Track A Phases 2 and 3.** Months, and the relational model was chosen
deliberately for DB-level constraints, which a port must preserve rather than re-derive.

### Option B — CCD as the document plane only *(recommended)*

`deed-poll-api` is small and does four things: a `CaseView` projecting a handful of fields read-only
from the existing tables; one or two `decentralisedEvent`s for adding and removing a document; the
CDAM upload/download/delete calls; and the retain-and-dispose cron. Ownership splits **by table**:

| Tables | Owner | Migrations |
|---|---|---|
| `ccd.*` | `deed-poll-api` | SDK Flyway |
| `deedpoll_supportingdocument` | `deed-poll-api` | Flyway — **Prisma must stop managing it** |
| everything else in `public` | TypeScript | Prisma, as today |

Keeps Phases 2–6 intact. `apps/web` gains HTTP calls for document upload and download only — a
change to 3 of its 8 data-access files rather than all of them.

**Risks to be honest about:** two services share one database, so the table split has to be enforced
by convention and reviewed carefully; `deed-poll-api` reads `public` tables it does not own, so a
Prisma migration can break its `CaseView`; and a minimal `CaseView` may not satisfy CCD — **ask
`dcd_ccd` whether a projection this thin is acceptable before building it.** Global Search expects
`setSearchCriteria(new SearchCriteria())` to be populated even in the reference implementation.

### Option C — documents only, no CCD

Ruled out. Without CCD events there is no `attachToCase`, so documents TTL out after a day and only
the uploader can read them. Recorded so it is not revisited.

### If Option B is chosen and CCD adoption later deepens

Option B is a subset of Option A, not a divergence from it: the same service grows more events and
more of the domain over time. Nothing in it needs undoing.

---

## Work stages

Sequenced so that everything not gated on the external path happens in parallel with it.

**Stage 0 — raise the external requests (day 1).** All eight rows above. Nothing else here is on the
critical path by comparison.

**Stage 1 — widen the storage seam in TypeScript.** `libs/deed-poll/src/documents/file-storage.ts` is
three functions — `saveFile(buffer) → key`, `createFileReadStream(key)`, `deleteFile(key)` — and
`storageKey` on `DeedPollSupportingDocument`. **None of them can express CDAM**, for four separate
reasons worth stating because each is a design constraint rather than a detail:

- Upload needs `jurisdictionId`, `caseTypeId` and `classification`; the current signature takes a
  buffer and nothing else.
- Upload returns a **hash token** that has to be threaded into the CCD event that attaches it.
- **Hash tokens are single-use and not stable across attach** — the digest input gains `caseId` once
  known — so a token cannot be cached in `storageKey`.
- Download needs the **user's JWT**, so a request-scoped credential must reach a layer that is
  currently a pure function.

Replace the three functions with an interface, and make the local-disk implementation one provider
behind it. This is worth doing first because it is useful under every option, it is small, and it lets
the TypeScript side stop pretending documents are a filesystem concern.

**Stage 2 — scaffold `deed-poll-api`.** Spring Boot 3, `ccd { decentralised = true; runtimeIndexing = ... }`
in `build.gradle`, `CCDConfig` entry point, `CaseView`. Mirror `pcs-api`'s layout. Verify the
`/ccd-persistence/*` contract with Pact tests modelled on `pcs-api:src/contractTest/java/`; no generic
suite ships with the SDK, and **CCD does not retry a failed `/ccd-persistence/cases` call**.

**Stage 3 — CDAM in `deed-poll-api`.** `CaseDocumentClientApi` for upload, metadata, download and
delete; `AuthTokenGenerator` for S2S; a system-user IDAM token for the download half. PCS's
`DocumentImportService` is the closest working example — note it persists `documentId`, `url`,
`binaryUrl`, `fileName` and `categoryId`, and recovers the document id from the self href via a
`DocumentIdExtractor`. **PCS does not exercise CDAM *upload*** — its documents arrive from
doc-assembly — so for the upload path nfdiv's `CaseDocumentAccessManagement` is the better reference.

**Stage 4 — cut `apps/web` over.** Document upload and download call `deed-poll-api` over HTTP.
`DeedPollSupportingDocument.storageKey` becomes the CDAM document id; the local-disk provider stays
available for development.

**Stage 5 — the operational tail.** Logstash pipeline for `ccd.es_queue` using ES **external
versioning starting above v1**; the retain-and-dispose cron; delete `apps/postgres/ccd-runtime/`.

---

## Traps to carry forward

From the CCD docs, each already the cause of a real incident or a wrong assumption:

- **`DELETE /cases/documents/{id}` takes `permanent`, default `false`.** The FinRem rollout (DFR-4514)
  hit a pre-existing bug that started hard-deleting documents that should have been kept, needing
  manual recovery. Our own `deleteFile` is currently a silent no-op on a missing key; that polarity
  must not carry over to a call with a hard-delete switch on it.
- **`DOCUMENT_BINARY_URL` is a confirmed bug** — the constant's value is `"document_url"`, so
  `getDocumentId()` falls through. Read binary URLs from `links.binary.href`, as PCS does.
- **Rotating the S2S TOTP secret invalidates every previously issued hash token** — it is the salt.
- **A hash token is a single-use credential, not an identifier.** Do not cache it.
- **Intermittent 404s on retrieval during event processing** (CCD-7418, open). Retrying the event
  usually works. Do not build a retry-free happy path.
- **Setting both `aboutToSubmitCallback` and a `submitHandler` on one event throws at startup.**
- **Annotate `CaseView.getCase` `@Transactional(readOnly = true)`.** The SDK opens no transaction, so
  without it you get `LazyInitializationException` or a query per association.

---

## What could not be verified here, and needs `dcd_ccd`

Stated plainly so nobody treats this plan as more settled than it is:

1. **Whether a minimal `CaseView` (Option B) is acceptable**, or whether CCD expects a full case
   projection. This decides whether Option B is viable at all.
2. **Who creates the S2S microservice key.** `rpe-service-auth-provider` 404s for the token in this
   container, so it is private or renamed; the vault mechanism is verified from
   `pt-shared-infrastructure` but the request route is not.
3. **The jurisdiction and case-type IDs.** `MIGRATION_PLAN.md` assumes `DEED_POLL`; nothing has
   confirmed it, and CDAM's `service_config.json` entry has to match exactly —
   `validateCaseTypeId` compares the submitted `caseTypeId` against that list and 403s otherwise.
4. **Whether a Java service in this repo, deployed by GitHub Actions, is acceptable to Platform
   Operations**, or whether it wants its own repo and Jenkins. This interacts with the existing
   unanswered question about GHA as a CFT deployment route.
5. **Whether `PATCH /cases/documents/{documentId}` can extend or clear a TTL on our own authority.**
   It is allowed by microservice ID rather than restricted to `ccd_data`, unlike `attachToCase`. It
   would not fix download authorisation, so it does not rescue Option C — but it is worth knowing
   whether a document can be kept alive between upload and event commit.
