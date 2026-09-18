# Plan: referrals to the judiciary (admin 0 of 4) — the spec refresh and the whole referral adapter

## Overview

**This plan did not exist when the referrals feature was planned. It exists because admin-1's reconciliation
gate fired on 2026-09-18, exactly as that plan said it would**, and the honest answer was to split the adapter
off rather than widen the UI plan or trim the spec.

`referrals-admin-1-caseworker-referrals-tab.md` has three preconditions, the first being "api-1 has been run
and merged". What is actually merged on `deed-poll-api`'s `master` is **all four api plans**:

| api plan | Merged as | Adds to the published spec |
|---|---|---|
| api-1 create and withdraw | `#19` | `GET`/`POST /caseworker/cases/{id}/referrals`, `GET /…/{referralId}`, `POST …/withdrawal` |
| api-2 claim, direction, close | `#22` | `POST /caseworker/cases/{id}/referrals/{referralId}/closure` |
| api-2b current referral state | `#23` | `currentReferralState` on three existing response schemas |
| api-3 judicial surface | `#24`, `ee37173` | `GET`/`POST` across `/judicial/referrals**` — four operations |

Admin's committed `openapi.json` is at api `3b2579a` (`#18`), the commit directly below `#19` — so the delta
is precisely those four plans, plus **`#21` `referrals-api-2b-and-api3-confirm`**, which sits between them and
is expected to be confirmation only. Task 1 accounts for it rather than assuming it is empty.

So the delta is **nine operations and eight schemas**, where admin-1 was written for four operations and two
schemas. Its gate says to stop and report in exactly this case, and it was right to: the overshoot is a
planning fact, not an obstacle to code around.

### Why the adapter cannot be scoped to api-1

`libs/deed-poll-api-client/src/api/contract.test.ts` compares the adapter with api's document as **set
equality, in both directions, on both axes**:

```js
expect(inCode).toEqual(inSpec);                              // contract.test.ts:69  — schema keys
expect([...IMPLEMENTED_OPERATIONS].sort()).toEqual(inSpec);  // contract.test.ts:85  — operations
```

An operation api serves with no adapter function fails as loudly as a call the adapter makes that api does not
serve — that is the test's stated purpose, not an accident of how it was written. So **refreshing
`openapi.json` at all obliges the adapter to carry the whole current api in the same commit.** There is no
partial refresh, and the two ways of pretending otherwise were both rejected:

- **Hand-trimming the document** — forbidden by admin-1's gate and by `SPEC-PROVENANCE.md`, which exists
  precisely so this file is api's output rather than our edit of it.
- **Regenerating from api-1's merge commit** — the same lie in a different costume. It would leave the drift
  test tracking an api nobody runs, and admin-2 would inherit the entire refresh anyway.

Splitting the adapter into its own plan is therefore the smallest change that keeps every plan honest:
**admin-0 lands the spec, the adapter and the mock for the whole referral surface; admin-1, admin-2 and
admin-3 then each add only domain services and pages, with no spec work and no contract-test edits.**

### What this unblocks

| Plan | After admin-0 | Still blocked on |
|---|---|---|
| admin-1 caseworker referrals tab | runnable — domain + pages only | nothing |
| admin-2 returned-action-needed count | runnable — domain + pages only | admin-1 (the tab it links into) |
| admin-3 judicial screen | adapter present | **idam-1** — the `caseworker-deedpoll-judicial` role |

## Scope — read this before writing anything

**In scope:** `libs/deed-poll-api-client/openapi.json`, `SPEC-PROVENANCE.md`, `src/api/wire.ts`,
`src/api/client.ts`, `src/api/contract.test.ts`, `src/api/client.test.ts`, `src/mock/server.ts`.

**Out of scope, and each belongs to a named later plan:**

- **No domain services.** `libs/deed-poll/src/referrals/` is admin-1's first task. A service here with no page
  to call it is speculative (CLAUDE.md, YAGNI) and would export from `libs/deed-poll/src/index.ts` something
  nothing consumes.
- **No pages, templates, locales or e2e.** admin-1 and admin-3 own those.
- **No `query-fields.ts` entry for `currentReferralState`.** Adding the property to the wire schemas is
  adapter work and is in scope; registering it as a **queryable** field in
  `libs/deed-poll/src/deed-poll/query-fields.ts` is what makes the dashboard count possible and is
  **admin-2's**, with admin-2's tests.
- **No detail-tab machinery.** admin-1's tab decision (`form-fields.ts`, `detail-view.ts`, `detail.njk`)
  stays admin-1's.

## Decisions taken — implement these, do not revisit

1. **One refresh, from api `ee3717313d3cd841608b05a38f4b9a9598f84a30`** — "Merge pull request #24 from
   hmcts/referrals-api-3", 2026-09-18, the tip of `origin/master`. Verify it is still the tip before
   regenerating; if api has moved on, Task 1's gate is what decides whether that is acceptable.
2. **The adapter implements all nine operations, including the four judicial ones.** This is not scope creep —
   it is what set equality requires (above). The judicial functions have no caller until admin-3, and that is
   correct: the adapter's job is to describe api, and `client.test.ts` is what exercises them meanwhile.
3. **Nothing about the judicial adapter depends on idam-1.** Auth is never per-call here — it rides in
   `ApiConfig` and `send()` sets the bearer header (`client.ts:535`). A judge's role gate is api's, enforced
   on api's side; the adapter would look identical either way. So admin-0 is not blocked by the open idam
   plan, and must not add role checks to compensate for it.
4. **`currentReferralState` lands on three schemas, not one** — `CaseSummaryResponse` (`wire.ts:252`),
   `CaseDetailResponse` (`wire.ts:246`) and `SavedCaseResponse` (`wire.ts:104`). Verified against api's
   `CaseSummaryResponse:64`, `CaseDetailResponse:147` and `SavedCaseResponse:144`. It is nullable — api's
   javadoc says "or null when it has none".
5. **Derive strictness from api's Java types, do not copy a list from this plan.**
   `STRICT_RESPONSE_PROPERTIES` (`wire.ts:548`) holds only Java primitives, collections api builds with
   `List.of`/`List.copyOf`, and `id`. Verified examples to anchor the reading: `ReferralResponse.migrated` is
   a `boolean` primitive and `reasons` is a `List.copyOf` → both strict; `publishToGazette` is a boxed
   `Boolean` and `decision` a nullable enum → neither is. `JudicialPoolResponse`'s `page`, `size`, `total`,
   `totalPages` are `int`/`int`/`long`/`int` → strict, as `CaseListResponse`'s already are. **Read each record
   in `deed-poll-api/src/main/java/uk/gov/hmcts/reform/deedpoll/api/{caseworker,judicial}/dto/` and decide
   per property.** The per-schema strictness test asserts the schema rejects null for *exactly* the pinned
   set, so an over-pinned property fails and an under-pinned one passes — only the first is caught for you.
6. **api has already closed the keyed-body trap for referrals, so expect real properties, not `{}`.**
   `CreateReferralRequest` and `JudicialDirectionRequest` both extend `KeyedRequestBody`, which is the shape
   that published as `{}` and silently matched an empty registration during the saved-query refresh
   (`SPEC-PROVENANCE.md`, "Two api defects this refresh surfaced"). api compensates for both in
   `config/OpenAPIWriteBodies.java` — `describeReferralBody` (`:384`) and `describeDirectionBody`, registered
   at `:112`–`:113`. **Confirm both carry properties and enum members in the refreshed document.** If either
   is `{}`, that is an api bug to raise upstream, not something to model around here.
7. **Never `git checkout` in the `deed-poll-api` clone.** It is a shared working tree — another agent has been
   working in it, it currently sits on `referrals-api-3`, and switching its branch underneath a running
   process is a known hazard in this workspace. Fetch, then regenerate from a **separate worktree**:

   ```bash
   cd ../deed-poll-api && git fetch origin
   git worktree add /tmp/api-spec-refresh ee3717313d3cd841608b05a38f4b9a9598f84a30
   ```

   Remove the worktree when done (`git worktree remove /tmp/api-spec-refresh`). Do not commit anything in
   that clone.
8. **The mock needs a new top-level route block for `/judicial/referrals`, not a regex extension.** The
   existing `scoped` regex (`mock/server.ts:220`) matches `/caseworker/cases/{id}/…` only, so judicial cannot
   be reached by widening its collection group — it is a sibling namespace and needs its own branch, placed
   with the `/caseworker/saved-queries` blocks above it. The caseworker referral sub-paths **do** extend
   `scoped`, but note they need a trailing action group (`withdrawal|closure`) in the shape `/file` already
   occupies, not a second `{childId}`.
9. **Withdrawal, closure and claim take no request body.** Verified on api's controllers —
   `CaseworkerReferralController.withdraw` (`:131`) and `close` (`:159`) take path variables only, and the
   judge's `claim` (`JudicialReferralController:114`) likewise. Only `create` and `direction` carry bodies. A
   client function that sends `{}` to a bodyless POST is a divergence to avoid, not a harmless default.

## Validation Commands

Run from the repo root. **Both are green now, before any task runs — measured 2026-09-18.**

```bash
yarn lint                                    # exit 0, with 2 warnings and 2 infos
yarn turbo test test:app --concurrency=1     # 8 of 8 tasks, 1,953 passed, 3 skipped
```

Three tooling facts, so no task loses time to them:

- **Not bare `yarn test`.** It reports failure with `0 successful, 8 total` and "no tests" — nothing runs.
  `turbo test test:app` is the form that works, and the `:app` suffix is load-bearing (CLAUDE.md).
- **`--concurrency=1` is deliberate.** Parallel workers exhaust memory in this devcontainer.
- **The suite needs no Docker.** `src/app.test.ts` exercises an unreachable Redis on purpose, so
  `ECONNREFUSED 127.0.0.1:6379` in the output is an asserted path, not a broken environment.

**Expected movement:** every task below should *raise* the totals. Record the measured figure in each
checkbox rather than "green" — a count that moved the wrong way is the cheapest signal that a deletion
happened by accident.

## How this plan is run — two passes, and why the split falls where it does

**Run this plan in two sittings, stopping after Task 2b.** Tasks 1–2b end with the adapter matching api and
the suite green; that is the point where the drift test starts telling the truth again, and the right place to
read the result before building the mock on top of it.

| Pass | Tasks | Ends with |
|---|---|---|
| **1** | 1, 2a, 2b | `openapi.json` at api `ee37173`, the adapter describing all nine operations, suite green |
| **2** | 3, 4 | the mock answering the whole referral surface, adapter tests covering it, full validation recorded |

**The registration is what cannot straddle a task boundary — the code can.** `contract.test.ts` has exactly
two green states, "neither side knows about referrals" and "both do", so the refreshed document and the
registry entries must land together. But the test iterates `WIRE_SCHEMAS`'s **keys** and compares
`IMPLEMENTED_OPERATIONS` against the document, so:

| | Green? | Why |
|---|---|---|
| Eight Zod schemas defined, **not** in `WIRE_SCHEMAS` | ✅ | the registry is the test's subject, not the file's exports |
| Nine client functions defined, **not** in `IMPLEMENTED_OPERATIONS` | ✅ | the list still matches the old document at 26 |
| The refreshed `openapi.json` copied in | ❌ | red until the registry catches up |
| `currentReferralState` on the three case schemas | ❌ | a property the committed document does not carry |

That is why Task 2a writes the adapter and Task 2b flips the registration. **2a deliberately leaves dead code
in the tree for the length of one task** — unregistered schemas and uncalled functions — and that is a
reviewed trade, not an oversight: the alternative is one task large enough that a failure inside it is hard to
localise.

**If Task 2a comes back with Biome warnings, the unused code is the cause.** Exported symbols should not trip
its unused rules and the path helpers are consumed by the functions beside them, so it is expected clean —
but it is unproven, so do not go hunting elsewhere first.

---

## Finding: the measured delta

**Measured 2026-09-18. The gate passes: the delta is exactly the referral surface, and nothing else.**
Regenerated from a detached worktree at `deed-poll-api` `ee3717313d3cd841608b05a38f4b9a9598f84a30` — still the
tip of `origin/master` after `git fetch`, so decision 1 stands unamended. The shared clone was left on
`referrals-api-3` and untouched (decision 7).

### The commit range, including #21

`3b2579a..ee37173` first-parent is five merges — `#19`, `#21`, `#22`, `#23`, `#24`. **`#21` is documents only**:
two files, both under `docs/plans/`, and **zero** files under `src/main/`. It is confirmation exactly as the
Overview expected, so the four api plans in the table are the whole of the production delta and there is no
fifth.

### Counts

| | Committed (`3b2579a`) | Refreshed (`ee37173`) | Delta |
|---|---|---|---|
| Operations | 26 | **35** | +9 |
| — caseworker | 25 | **30** | +5 |
| — judicial | 0 | **4** | +4 |
| — Spring Boot's `GET /` | 1 | 1 | — |
| Paths | 14 | **22** | +8 (17 caseworker, 4 judicial, 1 welcome) |
| Schemas | 19 | **27** | +8 |

**api asserts both halves of that itself**, which is the corroboration worth having: `OpenAPIPublisherTest`
asserts `isEqualTo(30)` for the caseworker count and `isEqualTo(4)` for the judicial one, separately and with
`doesNotContainAnyElementsOf` between the two lists. My count is not an independent measurement that happens
to agree — it agrees with a number api's own build fails on.

The nine operations are the nine the gate named, with no removals:

```
+ GET  /caseworker/cases/{id}/referrals
+ POST /caseworker/cases/{id}/referrals
+ GET  /caseworker/cases/{id}/referrals/{referralId}
+ POST /caseworker/cases/{id}/referrals/{referralId}/withdrawal
+ POST /caseworker/cases/{id}/referrals/{referralId}/closure
+ GET  /judicial/referrals
+ GET  /judicial/referrals/{referralId}
+ POST /judicial/referrals/{referralId}/claim
+ POST /judicial/referrals/{referralId}/direction
```

The eight schemas are likewise the eight named: `CreateReferralRequest`, `ReferralResponse`,
`JudicialDirectionRequest`, `JudicialPoolResponse`, `JudicialReferralSummary`, `JudicialReferralDetail`,
`JudicialCaseView`, `JudicialCaseNote`. Nothing was removed on either axis.

### Decision 6 confirmed — both keyed bodies published properly

**`CreateReferralRequest` carries 4 properties and `JudicialDirectionRequest` 3**, both with their enum members,
their `maxLength` constraints and a `required` array. Not `{}`. `OpenAPIWriteBodies`'s
`describeReferralBody`/`describeDirectionBody` did their job, so there is nothing to raise upstream:

- `CreateReferralRequest` — `reasons` (required, `minItems: 1`, enum of six: `Minor`, `DomesticAbuse`,
  `NonPublication`, `DeclarantRequirementsNotMet`, `SeparatedOrEstranged`, `Other`), `notes`
  (`maxLength: 1000`), `urgency` (enum `Normal`/`Urgent`), `urgencyReason` (`maxLength: 500`).
- `JudicialDirectionRequest` — `decision` (required, enum `Approved`/`Rejected`), `publishToGazette`
  (required, boolean), `directionsText` (`maxLength: 4000`).

One shared quirk, checked rather than assumed to be new: **every hand-registered write body omits `type:
object`.** `CreateSavedQueryRequest`, `UpdateSavedQueryRequest`, `CreateNoteRequest` and `CreateCaseRequest`
all publish `type: undefined` with their properties present, and the two referral bodies match them. That is
how `OpenAPIWriteBodies` has always registered, it is not the 2026-09-17 `{}` defect recurring, and the
contract test keys off property sets rather than `type`.

### Every difference, accounted for

Four kinds, where the gate anticipated three. The fourth is below and is not a surprise to absorb — it is the
same api-2b addition surfacing in a second place:

1. **The nine operations and eight schemas** above.
2. **`currentReferralState` on the three case schemas** — `CaseSummaryResponse`, `CaseDetailResponse` and
   `SavedCaseResponse`, identical on all three: `{"type":"string","enum":["Open","Claimed","Decided","Closed",
   "Withdrawn"]}`. Decision 4's list of three was right; a property-by-property deep diff of all 19
   pre-existing schemas found **these three properties and nothing else** — no retypes, no removals, no
   changes to any other schema's non-`properties` keys.
3. **One `operationId` shift** — `POST /caseworker/cases/{id}/notes` went `create_3` → `create_4`, because the
   new `POST …/referrals` took `create_3`. The known collision-by-shape churn (`SPEC-PROVENANCE.md`); nothing
   here keys off an `operationId`. Only one moved this time, against eight last refresh.
4. **`currentReferralState` appended to the `sort` parameter's sortable-field list** on `GET /caseworker/cases`
   — 69 names to 70, inserted at index 15, directly after `state`. **Not the determinism bug returning**, and
   that was checked specifically rather than eyeballed: the 69 shared names are in *byte-identical order*, and
   `createdOn, modifiedOn, createdBy, modifiedBy` are still the last four in `#18`'s pinned order. So the
   `List.of` fix holds. This is api-2b making the new field sortable, and the Scope section already expects it
   to be queryable — registering it in `query-fields.ts` is admin-2's task, not this plan's. Nothing in the
   adapter reads this description, so it changes no work here beyond being recorded in `SPEC-PROVENANCE.md` at
   Task 2b.

No other difference exists anywhere in the document: the deep diff covered every pre-existing operation
(parameters, bodies, responses, security), the top-level keys and `components.securitySchemes`.

### Three shape notes Task 2a should not re-derive

- **Decision 9 confirmed from the document, not just the controllers.** `POST …/withdrawal`, `POST …/closure`
  and `POST …/claim` each publish **no `requestBody` at all**. Only `create` and `direction` carry one, both
  `required: true`. A client function sending `{}` to those three would be inventing a body api does not
  document.
- **`GET /judicial/referrals`'s `page` and `size` publish as `{"type":"string"}`**, not the case list's
  `integer`/`int32`-with-default-and-minimum. That is deliberate on api's side and documented in
  `JudicialReferralController.pool`'s javadoc — both bind as `String` and go to `CasePaging.parse`, which
  "refuses what it cannot understand and clamps an over-cap size rather than refusing it". Faithful
  publication of a real signature, not a springdoc artefact, and it costs the adapter nothing since query
  values serialise as strings regardless.
- **Responses are `*/*`, and every 200/201 references a schema.** The caseworker five answer
  `ReferralResponse` (a bare array for the list); judicial answers `JudicialPoolResponse` for the pool and
  `JudicialReferralDetail` for the other three, including `claim` and `direction`.

### Artefacts and reproduction

`/tmp/openapi-specs.json` is Task 2a's and 2b's input — 50,881 bytes, the same size a run earlier the same day
produced, which is consistent with `#18`'s determinism fix holding. The worktree was removed after
regenerating, per decision 7. If `/tmp` is cleared before pass 1 finishes, reproduce with:

```bash
cd ../deed-poll-api && git worktree add /tmp/api-spec-refresh ee3717313d3cd841608b05a38f4b9a9598f84a30
cd /tmp/api-spec-refresh && TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration --tests "*OpenAPIPublisherTest*"
```

### Baseline, measured rather than trusted

Both validation commands were run before anything changed, and both reproduce the plan's stated figures
exactly — so the movement each later task records is against a real number:

| | Result |
|---|---|
| `yarn lint` | exit 0 — 306 files checked, **2 warnings, 2 infos** |
| `yarn turbo test test:app --concurrency=1` | **8 of 8 tasks, 1,953 passed, 3 skipped** (120 files) |

Per package: `@hmcts/deed-poll` 752, `//:test:app` 621 + 3 skipped, `@hmcts/deed-poll-api-client` **242**,
`@hmcts-cft/cloud-native-platform` 140, `@hmcts-cft/express-govuk-starter` 127, `@hmcts-cft/simple-router` 41,
`@hmcts-cft/express-session-postgres` 23, `@hmcts-cft/express-session-redis` 7. The api-client's **242** is the
one to watch: Tasks 2b and 4 should move that figure and no other.

---

## Tasks

### Task 1: Establish the delta, and stop if it is not the referral surface

**Change nothing in the tree except this plan file.** The output is a finding. This task exists so the gate
is a real stop rather than something discovered halfway through an edit.

1. Confirm `origin/master`'s tip is still `ee37173` (decision 1). If api has moved, say so and carry on —
   but record which commit you actually used.
2. Regenerate, from a worktree (decision 7), per `SPEC-PROVENANCE.md`:

   ```bash
   export TESTCONTAINERS_RYUK_DISABLED=true    # this devcontainer only; Ryuk is unreachable here
   cd /tmp/api-spec-refresh && ./gradlew integration --tests "*OpenAPIPublisherTest*"
   ```

   That writes `/tmp/openapi-specs.json`. It needs Docker for a database container. **`--tests`, not
   `-Dtest.single=…`**, which is silently ignored.
3. Diff it against the committed `libs/deed-poll-api-client/openapi.json` **property by property, not just
   paths and counts** — a body published as `{}` matches on paths and lies about shape, which is exactly what
   happened on 2026-09-17.
4. Account for **every** difference as one of: an expected referral addition, `currentReferralState` on the
   three case schemas, or `operationId` suffix churn (`create` → `create_1` and the like, which nothing here
   keys off).

**The gate.** The delta must be exactly:

- **9 operations** — 5 caseworker (`GET`, `POST`, `GET /{referralId}`, `POST …/withdrawal`,
  `POST …/closure`) and 4 judicial (`GET`, `GET /{referralId}`, `POST …/claim`, `POST …/direction`), taking
  the document from 26 operations to **35**.
- **8 schemas** — `CreateReferralRequest`, `ReferralResponse`, `JudicialDirectionRequest`,
  `JudicialPoolResponse`, `JudicialReferralSummary`, `JudicialReferralDetail`, `JudicialCaseView`,
  `JudicialCaseNote`, taking 19 schemas to **27**.
- **`currentReferralState`** on `CaseSummaryResponse`, `CaseDetailResponse` and `SavedCaseResponse`.

Anything else — a fifth api plan merged upstream, a schema published as `{}` (decision 6), those four sort
fields moving again (a regressed api fix, `SPEC-PROVENANCE.md`) — **stop, record it here, and report.** Do
not absorb a surprise into the adapter to keep the task moving.

Record the finding in this file under `## Finding: the measured delta`, citing the counts you measured rather
than the ones above.

- [x] Task 1 complete — gate **passes**. 26→35 operations (+9), 19→27 schemas (+8),
      `currentReferralState` on the three case schemas, at api `ee37173` (still `origin/master`'s tip). `#21`
      confirmed documents-only. Both keyed bodies published with real properties (decision 6 clear). One
      difference beyond the gate's three categories — `currentReferralState` appended to the `sort`
      description's field list — accounted for above as api-2b's, not the determinism regression: the other 69
      names are in unchanged order. Tree unchanged except this file. Baseline recorded: lint exit 0
      (2 warnings, 2 infos); **1,953 passed, 3 skipped, 8 of 8 tasks**.

### Task 2a: Write the adapter — schemas and client functions, registered nowhere

**Nothing in this task is wired up, and the tree must stay green throughout.** Do not copy in the refreshed
document, do not touch `WIRE_SCHEMAS`, `STRICT_RESPONSE_PROPERTIES` or `IMPLEMENTED_OPERATIONS`, and do not
add `currentReferralState` anywhere — all five of those are Task 2b, and any one of them here turns the
contract test red mid-task. Work from `/tmp/openapi-specs.json` (Task 1's output) as the shape you are
modelling, not from the committed `openapi.json`, which does not carry referrals yet.

1. **`wire.ts` — eight Zod schemas**, beside their neighbours rather than in a block at the end.
   `noteSchema:195` is the closest model for a response carrying audit fields. The eight are
   `CreateReferralRequest`, `ReferralResponse`, `JudicialDirectionRequest`, `JudicialPoolResponse`,
   `JudicialReferralSummary`, `JudicialReferralDetail`, `JudicialCaseView`, `JudicialCaseNote`.
   Responses are nullable by default (springdoc emits no nullability for a response body — `wire.ts:548`'s
   comment is the authority); leave the strictness decision itself to 2b, where the test can check it.
2. **`client.ts` — nine functions and two path helpers**, mirroring the notes trio (`listNotes:166` and its
   neighbours) for the caseworker five, and `notePath:413` for
   `/caseworker/cases/{id}/referrals/{referralId}` and `/judicial/referrals/{referralId}`. Bodyless POSTs
   send no body (decision 9). Auth is not a parameter — it rides in `ApiConfig` (decision 3).
3. **The exported type aliases, in the block at `client.ts:697`–`:722`.** This is the part the domain layer
   actually imports and the easiest to forget: `export type Referral = WireReferralResponse`,
   `ReferralCreate`, the judicial detail/summary/pool types, and the direction request — following `Note`,
   `WitnessCreate` and `SavedQueryPatch` exactly. **Also derive the enum unions the pages will need** the way
   `CaseState` does at `:722` (`NonNullable<Referral["state"]>`), rather than restating members that already
   exist on the schema. admin-1's gate checks these are exported, not just the functions.
   **No edit to `libs/deed-poll-api-client/src/index.ts` is needed or wanted** — it is
   `export * from "./api/client.js"`, so everything above is on the package surface automatically, and the
   wire schemas and the mock stay off it deliberately (the file's own docblock says why).
4. **Comment the judicial functions for what they are**: the adapter half of api-3's surface, with no caller
   in this repo until admin-3. **Describe the operations rather than promising a future reader** — plan 12 had
   to go back and fix two comments that still said "nothing reads this yet" after something did.
5. **No tests in this task.** `client.test.ts` cannot exercise any of it until the mock answers (Task 3), and
   a test written against nothing is a test that pins nothing. Task 4 is where the coverage lands.
   **There is no coverage threshold configured** (`vitest.config.ts` sets `reportsDirectory` and nothing
   else — verified 2026-09-18), so uncovered code here fails no gate. Do not add a threshold to compensate.

Both validation commands must be green at the end, with the totals **unchanged** from the baseline — this task
adds no test. A count that moved here means something was registered that should not have been.

- [x] Task 2a complete — eight Zod schemas in `wire.ts`, nine client functions, two path helpers and the
      exported aliases in `client.ts`. Totals **unchanged**, as required: lint exit 0 with 2 warnings and 2
      infos, `1,953 passed, 3 skipped, 8 of 8 tasks`, api-client still **242**. Nothing registered, nothing
      tested, and Biome came back clean — the expected-clean guess in "How this plan is run" held, so the
      unused-code note above needed no follow-up.
      **One thing 2b must also do, which its five edits do not list.** `client.ts` cannot reference
      `WIRE_SCHEMAS.ReferralResponse` before the registry carries it, so the three response schemas it parses
      with — `referralSchema`, `judicialPoolSchema`, `judicialReferralDetailSchema` — are `export const` in
      `wire.ts` and imported by name. That is the 2a dead-code trade in a second form: once 2b registers the
      eight, **switch those three call sites to `WIRE_SCHEMAS.*` and drop the `export` from all eight schemas**,
      so the registry stays the single reference and the wire schemas stay off the package surface. They are off
      it today regardless — `index.ts` exports only `./api/client.js`.
      Shape decisions 2b's per-schema tests will check, taken from api's records rather than the document:
      strict (reject null) are `ReferralResponse` `id`/`migrated`/`reasons`, `JudicialReferralSummary`
      `id`/`reasons`, `JudicialReferralDetail` `id`/`reasons`/`caseNotes`, `JudicialPoolResponse` all five,
      `JudicialCaseNote` `note` (the same NOT NULL column `NoteResponse.note` pins), and `JudicialCaseView`
      **none at all** — it has no id, no primitive and no collection, so its pinned list is empty. `application`
      is nullish despite api always building one: decision 5 admits primitives, `List` collections and `id`,
      and a nested record is none of the three. Two vocabulary arrays were added for the schemas to use,
      `REFERRAL_STATE` and `REFERRAL_REASON`, both re-exported from `client.ts` beside the option sets — and
      `REFERRAL_REASON` is the one the drift test cannot pin, because api publishes those members on
      `CreateReferralRequest.reasons`'s **items** and the test reads `properties[x].enum`.

### Task 2b: Flip the registration — the document and the registry, together

**This is the one step that cannot be subdivided.** The refreshed document and the registry entries are green
only as a pair, so all five edits land in one commit. It is small and mechanical; its value is that the suite
now checks 2a's guesses about shape.

1. **The document.** Copy it in with the reformat, exactly as `SPEC-PROVENANCE.md` prescribes:

   ```bash
   node -e 'const s=require("/tmp/openapi-specs.json");require("fs").writeFileSync("libs/deed-poll-api-client/openapi.json",JSON.stringify(s,null,2)+"\n")'
   ```

2. **`WIRE_SCHEMAS` (`wire.ts:501`)** — register the eight. `UNSPECIFIED_SCHEMAS` (`:531`) needs no change;
   `ApiError` is still the only schema api does not publish.
3. **`currentReferralState`** on `CaseSummaryResponse` (`wire.ts:252`), `CaseDetailResponse` (`:246`) and
   `SavedCaseResponse` (`:104`), nullable (decision 4).
4. **`STRICT_RESPONSE_PROPERTIES` (`wire.ts:548`)** — decide per property, per decision 5, reading api's
   records rather than copying a list from this plan.
5. **`IMPLEMENTED_OPERATIONS` (`contract.test.ts:35`)** — the nine `METHOD path` strings, in the order the
   existing list follows.
6. **`SPEC-PROVENANCE.md`** — new row for `ee37173` with the counts Task 1 measured, **pushing the current row
   down rather than overwriting it**. Record what the refresh changed that was not an addition, and whether
   decision 6's two keyed bodies published properly.

**Expect this task to go red before it goes green, and to fail in a useful place.** A wrong shape in 2a
surfaces here as a per-schema property failure naming the property, which is the whole reason the split is
worth its dead code. Totals should rise only by whatever the per-schema comparisons add.

**Pass 1 ends here.** Stop, report the measured figures, and do not begin Task 3 in the same run.

- [x] Task 2b complete — the document is at api `ee37173` (35 operations, 27 schemas), the eight schemas are
      registered, `currentReferralState` is on the three case schemas, strictness is pinned per schema, the
      nine operations are in `IMPLEMENTED_OPERATIONS`, and `SPEC-PROVENANCE.md` carries a new row with
      `3b2579a` pushed down rather than overwritten.
      **Measured:** lint exit 0, 306 files, 2 warnings and 2 infos — unchanged. `1,975 passed, 3 skipped,
      8 of 8 tasks`, up 22 from 1,953, and **all 22 in `@hmcts/deed-poll-api-client` (242 → 264)** with every
      other package's figure identical. That is the per-schema comparison arriving and nothing else moving.
      **It did not go red on the way**, which is the one prediction above that did not hold: every shape 2a
      guessed from api's records — all five strictness sets, the eight property lists, the six enum
      comparisons — matched the document first time, so the split bought localisation it turned out not to
      need. Worth recording as evidence that reading api's Java records beats inferring from the document,
      not as an argument that the split was unnecessary.
      **A sixth edit the task's five did not list**, and it is not optional: `contract.test.ts`'s
      `requests` array (`:135`) is what excludes a write body from "should pin strictness for every response
      schema", so `CreateReferralRequest` and `JudicialDirectionRequest` had to join it. Left out, that test
      demands a `STRICT_RESPONSE_PROPERTIES` entry for two request schemas — the opposite of what the list
      means. Task 2a's follow-up is also done: the three parse sites now read `WIRE_SCHEMAS.*` and all eight
      schemas have lost their `export`, so the registry is the single reference again.
      Two refresh obligations `SPEC-PROVENANCE.md` sets were discharged rather than skipped: api's actuator
      config and `PUBLIC_PATHS` still put the liveness probe where `checkApiReachable` looks, and the `where`
      parameter's operator table is byte-identical — `sort`'s is the only description that moved.

### Task 3: The in-memory mock

**Pass 2 begins here.** Before starting, confirm the tree carries Task 2b's work — `openapi.json` names
`/judicial/referrals` and `WIRE_SCHEMAS` holds the eight — and that both validation commands are green. If
either is untrue you are on the wrong tree or pass 1 did not finish; stop rather than re-doing it.

`libs/deed-poll-api-client/src/mock/server.ts`. The mock is the contract for everything above the adapter —
`client.test.ts` runs against it, admin-1's pages will develop against it, and `yarn test:e2e` drives it — so
a shortcut here is a shortcut in three places.

1. **Caseworker referrals** — extend `scoped` (`:220`) with a `referrals` collection and a trailing
   `(withdrawal|closure)` action group (decision 8), then a `referrals()` handler modelled on `notes()`
   (`:385`): list, create, read one, withdraw, close.
2. **Judicial** — a new top-level block for `/judicial/referrals` and its three sub-paths, placed with the
   other namespace blocks above `scoped` (decision 8). The pool answers a `JudicialPoolResponse`, so it pages
   the way the case list does.
3. **State.** A `referrals` array on `MockCase` (`:1363`), seeded and reset with the rest (`seed():672`).
4. **The state machine is api's, and the mock must not invent a laxer one.** `Open → Claimed → Decided →
   Closed`, with `Withdrawn` from any non-terminal state; 409 on create when a non-terminal referral exists,
   409 on withdraw when terminal, 409 on close when the state is not `Decided`, 409 on claim when not `Open`.
   Read `ReferralService` in the api clone for the guards rather than inferring them from the controllers'
   javadoc — **the mock returning 200 where api returns 409 is how a page ships with no conflict handling**,
   and admin-1 decision 6 makes those 409s first-class UI.
5. The judge's pool is shared and ordered urgent-first then oldest (api-3 decision 3). Mirror it; a mock that
   orders by insertion teaches the pages the wrong thing.
6. **Recompute `currentReferralState` on the case at every transition — recompute from the referrals, never
   push a value per site.** api-2b's rule exactly: the field is "the state of the case's one non-terminal
   referral, or null". A per-site push ("on close, set `Closed`") is the drift bug api-2b was designed to
   avoid — close is terminal, so the case must go **null**. This is admin-0's because the mock cannot be
   internally consistent without it, and **admin-2's Task 0 gate checks it**: admin-2's whole feature is a
   count over this field, so a mock where the field and the referrals disagree makes that plan untestable.
   `MockCase` inherits the property from `WireSavedCase` once Task 2b registers it, and the mock's
   `QUERYABLE_FIELDS` derives from `SavedCaseResponse.shape` (`server.ts:819`), so the filter is accepted
   automatically — what is *not* automatic is the value being right.

- [x] Task 3 complete — the mock answers the whole referral surface: the five caseworker operations on an
      extended `scoped` regex with a trailing `(file|withdrawal|closure)` action group, and the four judicial
      ones in their own top-level block beside the saved-query ones (decision 8, both halves). `MockCase`
      carries a `referrals` array, seeded and reset with the rest, and `MockReferral` is api's published
      referral with its dates still `Date` and no `lastTouchedAt` — the sweep is not modelled.
      **Measured:** lint exit 0, 306 files, 2 warnings and 2 infos — unchanged. **2,015 passed, 3 skipped,
      8 of 8 tasks**, up 40 from 1,975, and **all 40 in `@hmcts/deed-poll-api-client` (264 → 304)** with every
      other package's figure identical.
      **Two gaps the tests found in the mock rather than in the tests**, both the same omission: a case never
      referred published **no `currentReferralState` key at all** (`undefined`, where api sends `null`), and
      `toSummary` did not carry the property even though `CaseSummaryResponse` publishes it. Fixed in
      `CASE_DEFAULTS` and `toSummary` — admin-2 counts over this field on list rows, so a row that omitted it
      would have made the count read `undefined` for every case.
      **One prediction in this plan's own Task 3 was wrong, and the mock follows api rather than the plan.**
      Item 4 says "409 on claim when not `Open`" — true — but a direction by a judge who is *not* the holder is
      **404, not 409**, when the referral is claimed by somebody else: api's `direct` resolves through
      `visible()` first, and `visibleTo` admits a `Claimed` referral only to its holder, so the invisible-referral
      404 fires before `decide`'s conflict. The 409 is for a direction the judge *can* see but does not hold — an
      `Open` one, or their own `Decided` one. Both paths are pinned.
      Three things are deliberately **not** modelled, each recorded in `server.ts`'s docblock with its reason:
      the `caseworker-deedpoll-judicial` role gate (this mock reads no roles out of a token, exactly as it reads
      none for the saved-query and witness-delete gates, so a 403 is not a state it can produce — idam-1 and
      admin-3's concern), the inactivity sweep that reclaims a stale claim (a two-hour window on api's clock,
      untestable machinery here), and the case notes api writes on a referral transition (the wording is api's
      `ReferralNotes`, and a copy here would be a second opinion on text this app only renders). What **is**
      restated brings the file's list from seven rules to ten: the state machine including the
      one-live-referral guard and the two conditional create refusals, the `currentReferralState` recompute,
      and the judicial visibility rule plus the pool's urgent-first-then-oldest order.
      Judicial identity comes from `auditName`, so a judge is the token's subject — which is what lets the tests
      tell one judge's claim from another's without a role this app cannot issue yet.

### Task 4: Adapter tests, and full validation

1. **`client.test.ts`** — cover all nine operations against the mock: each happy path, and the classified
   failures that matter to the layers above (409 → `conflict`, 404 → `not-found`, a 400's field errors). The
   adapter is tested against the mock, never by stubbing `fetch` (`.claude/rules/testing.md`).
2. **Both validation commands**, with the figures recorded — package-by-package totals, not just "green", so
   the next plan can measure its own movement against a real baseline.
3. Confirm the three things a green suite does **not** prove, and say so in the checkbox: no page renders a
   referral yet, no domain service exists, and `query-fields.ts` is untouched. All three are intended.

- [x] Task 4 complete — `client.test.ts` covers all nine operations against the mock: 21 new tests, 11 on the
      caseworker five and 10 on the judicial four, each happy path plus the failures the layers above branch on
      — 409 → `conflict` (a second live referral, a second withdrawal, a close before a direction, a second
      claim, a direction on a referral nobody holds), 404 → `not-found` (a referral read through the wrong case,
      and one another judge holds, on both the read and the direction), and a 400's field errors (api's two
      conditional requirements, an empty `reasons`, and a decision api does not publish). No `fetch` was stubbed;
      a judge is the token's subject, which is what tells one judge's claim from another's.
      **Measured:** lint exit 0, 306 files, **2 warnings and 2 infos** — unchanged across all four tasks.
      `yarn turbo test test:app --concurrency=1`: **8 of 8 tasks, 2,036 passed, 3 skipped**, up 21 from 2,015,
      and **all 21 in `@hmcts/deed-poll-api-client` (304 → 325)**. Per package, for the next plan to measure
      against: `@hmcts/deed-poll` 752, `//:test:app` 621 + 3 skipped, `@hmcts/deed-poll-api-client` **325**,
      `@hmcts-cft/cloud-native-platform` 140, `@hmcts-cft/express-govuk-starter` 127, `@hmcts-cft/simple-router`
      41, `@hmcts-cft/express-session-postgres` 23, `@hmcts-cft/express-session-redis` 7. So the api-client has
      moved 242 → 325 over the plan and no other package's figure has moved at all.
      **The three things this green suite does not prove, all confirmed still true and all intended:** no page
      renders a referral to the judiciary (`src/pages` has no referral page — the two matches for "referral" are
      the case's own pre-existing `referral` edit tab and a comment in `detail.njk`, neither touched),
      `libs/deed-poll/src/referrals/` does not exist, and `query-fields.ts` is unmodified, so
      `currentReferralState` is on the wire and in the mock but is not yet a queryable field. They are admin-1's,
      admin-1's and admin-2's respectively.
      One formatting note for anyone repeating this: Biome's line-width rule fires on long `toMatchObject`
      calls, so `yarn format` ran once between writing the tests and lint coming back clean — a formatting fix,
      not a lint finding.

## Deliberately not in this plan

- **The UI, in any form.** That is admin-1 (caseworker tab, create, view, withdraw), admin-2 (the
  returned-action-needed count and worklist) and admin-3 (the judicial screen).
- **`close` as a caseworker journey.** The adapter gains the operation because the spec has it; the page that
  calls it belongs with admin-2's "returned — action needed" work, since closing is what drops a case off
  that queue.
- **Anything role-gated.** idam-1 is still open, and admin-3 is where the judicial role becomes visible in
  this app.
- **Amending admin-1, admin-2 or admin-3.** Each needs its layer-2 (adapter) section marked as done by this
  plan, and admin-1 needs its precondition 1 rewritten. That is a documentation pass to run when admin-0
  lands, deliberately not folded in here — editing three plans while implementing a fourth is how a plan
  stops matching the tree.
