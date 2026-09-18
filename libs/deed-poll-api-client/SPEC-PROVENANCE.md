# Where `openapi.json` came from

Taken from `deed-poll-api`'s own published document, not hand-written. Task 1 of
`docs/plans/completed/02-dal-cutover-to-api.md`: api exists, so a divergence between this file and api is a bug in
one of them rather than licence to invent.

| | |
|---|---|
| **api commit** | `ee3717313d3cd841608b05a38f4b9a9598f84a30` — "Merge pull request #24 from hmcts/referrals-api-3", 2026-09-18, the tip of `origin/master`. Regenerated from a detached worktree rather than by switching the shared clone's branch. |
| **Taken on** | 2026-09-18 |
| **How** | `GET /v3/api-docs`, as api's `OpenAPIPublisherTest` captures it for the `hmcts/cnp-api-docs` publish workflow. Reformatted (2-space JSON) and otherwise unmodified. |
| **Operations** | **30 caseworker operations** across 17 paths, **4 judicial** across 4 paths, plus Spring Boot's `GET /` — 35 in total, across 22 paths. 27 schemas. The refresh added the whole referrals surface: five `/caseworker/cases/{id}/referrals*` operations, four `/judicial/referrals*` ones, and eight schemas (`CreateReferralRequest`, `ReferralResponse`, `JudicialDirectionRequest`, `JudicialPoolResponse`, `JudicialReferralSummary`, `JudicialReferralDetail`, `JudicialCaseView`, `JudicialCaseNote`). It is four api plans' worth in one step — api-1, api-2, api-2b and api-3 — because admin's spec had not been refreshed since api-1 merged. `#21` between them is documents only, with nothing under `src/main/`. |
| **Before that** | `3b2579ab14e8c073aa27999e0f477d1d6bc4aa92` — "Publish the sortable fields in a fixed order (#18)", 2026-09-17. **Not `19fbb39` (#17)**, though the document was captured before #18 merged: #18 only fixed the order of four names in the `sort` description, and the captured document already carried the fixed order, so `3b2579a` is the commit that reproduced it byte-for-byte and `19fbb39` is not. **25 caseworker operations** across 13 paths, plus `GET /` — 26 in total. 19 schemas. That refresh added the seven `/caseworker/saved-queries*` operations, three schemas (`SavedQueryResponse`, `CreateSavedQueryRequest`, `UpdateSavedQueryRequest`), a `q` parameter on the case list, and two response properties: `CaseListResponse.referenceMatch` and `CaseSummaryResponse.newSurname`. |
| **Before that** | `fd4fe3a61bf33c0cdea7066cf884dc87fd1df71f` — "Field-level case query, sorting and paging (#14)", 2026-09-14. 18 caseworker operations. It added no operation: the query surface **extended** `GET /caseworker/cases` with `where`, `sort`, `page` and `size`, and added `page`, `size`, `total` and `totalPages` to `CaseListResponse`. A `POST .../search` was deliberately not what api built — decision 1 of `deed-poll-api/docs/plans/completed/case-query-and-paging.md`: a query has to be bookmarkable and survive the back button. |
| **Before that** | `051f3b49d101a4e0cefc9477de9ea4f618ad1bf9` — "Allow Administrators to delete a witness (#9)", which added `DELETE /caseworker/cases/{id}/witnesses/{witnessId}`. It carries an **Administrator gate api enforces in the domain** — `WitnessService.removeWitness` calls `requireAnyRole` before it resolves the witness — and the document says nothing about that, because springdoc has no vocabulary for it. api's own tests are its authority; nothing here re-checks a role. |

Every operation count above is right and none is a bug: api's `OpenAPIPublisherTest` asserts the caseworker
count and the judicial count separately and outright — `isEqualTo(30)` and `isEqualTo(4)`, with a
`doesNotContainAnyElementsOf` between the two lists — and the extra path is the welcome route. So the counts
here are not an independent measurement that happens to agree; they agree with numbers api's own build fails on.

The actuator and query facts the document cannot carry were re-checked at this refresh, as the closing section
says to: api's `application.yaml` still has `management.endpoints.web.base-path: /`, the health probes enabled
and the `liveness` group including `livenessState`; `SecurityConfiguration.PUBLIC_PATHS` still allowlists
`/health` and `/health/**`; and the `where` parameter's operator table is byte-identical, so the only
description that moved is `sort`'s.

## What the 2026-09-18 refresh changed that was not an addition

Three things, each accounted for property by property against `3b2579a`. Nothing was removed on either axis,
and no pre-existing schema was retyped:

1. **`currentReferralState` on three case schemas** — `CaseSummaryResponse`, `CaseDetailResponse` and
   `SavedCaseResponse`, identically: `{"type":"string","enum":["Open","Claimed","Decided","Closed",
   "Withdrawn"]}`. api's denormalisation of "the state of the case's one non-terminal referral, or null". A
   deep diff of all 19 pre-existing schemas found these three properties and nothing else.
2. **One `operationId` shift** — `POST /caseworker/cases/{id}/notes` went `create_3` → `create_4`, because the
   new `POST …/referrals` took `create_3`. The collision-by-shape churn described below; nothing here keys off
   an `operationId`. One moved, against eight last refresh.
3. **`currentReferralState` appended to the `sort` parameter's sortable-field list** on `GET /caseworker/cases`
   — 69 names to 70, inserted at index 15, directly after `state`. **Not the determinism bug returning**, and
   that was checked rather than eyeballed: the 69 shared names are in byte-identical order and
   `createdOn, modifiedOn, createdBy, modifiedBy` are still the last four in #18's pinned order, so the
   `List.of` fix holds. Registering the field as *queryable* in
   `libs/deed-poll/src/deed-poll/query-fields.ts` is a later plan's work; the adapter reads no parameter
   description.

**Both keyed write bodies published properly**, which is the check the 2026-09-17 defect below made mandatory:
`CreateReferralRequest` carries four properties (`reasons` required, `minItems: 1`, an items-level enum of six;
`notes` capped at 1000; `urgency`; `urgencyReason` capped at 500) and `JudicialDirectionRequest` three
(`decision` and `publishToGazette` required, `directionsText` capped at 4000). Neither is `{}`, so
`OpenAPIWriteBodies`'s `describeReferralBody`/`describeDirectionBody` did their job and there is nothing to
raise upstream. One shared quirk, checked rather than assumed new: **every hand-registered write body omits
`type: object`** — `CreateSavedQueryRequest`, `UpdateSavedQueryRequest`, `CreateNoteRequest` and
`CreateCaseRequest` all publish `type: undefined` with their properties present, and the two referral bodies
match them.

**`CreateReferralRequest.reasons` is the one enum the drift test cannot pin**: api publishes the six members on
the array's *items*, and `contract.test.ts` reads `properties[x].enum`. `REFERRAL_REASON` in `wire.ts` is
therefore checked by hand at each refresh — a member added at api's end fails at the wire, not in the suite.

## What the 2026-09-17 refresh changed that was not an addition

The diff is otherwise **byte-identical** once two things are accounted for, both verified rather than assumed:

1. **Eight `operationId` values shifted their suffix** — `create` → `create_1`, `delete` → `delete_1`, and so
   on. That is the collision-by-shape described below, and it is why nothing here keys off an `operationId`.
2. **Nothing else.** The `sort` parameter's field list *appeared* to reorder its last four names, and that was
   a real api bug rather than churn: `CaseSort` held the four audit columns in a `Set.of`, whose iteration
   order Java randomises per JVM, so each regeneration published them differently. Fixed upstream in
   `hmcts/deed-poll-api#18` — `List.of`, with a test pinning the order — and verified by regenerating the
   document three times in separate JVMs. **If a future refresh shows those four moving again, that fix has
   regressed; it is not normal.**

## Two api defects this refresh surfaced

Recorded because both were invisible in the operation counts, which is what a reviewer checks first:

- **`CreateSavedQueryRequest` and `UpdateSavedQueryRequest` published as `{}`.** Every api write body binds as
  a keyed map, so springdoc reflects no fields and `OpenAPIWriteBodies` compensates by hand — and it had not
  been extended for the new resource. `contract.test.ts` would have matched two empty schemas and a client
  built from them would have sent nothing. Fixed in `hmcts/deed-poll-api#17`, which also added a
  classpath-scanning guard so a future keyed body fails api's own build rather than shipping empty.
- The determinism bug above.

**The lesson for the next refresh: read the schemas, not just the paths and counts.** An operation count moving
correctly is compatible with a body that describes nothing.

**The `delete` operation ids are Spring's, and they collide by shape.** springdoc names an operation after
its handler method, so the note delete is `delete_1` and the witness delete is `delete` — the suffix moves
between refreshes as controllers are added, which is why nothing here keys off an `operationId`.
`contract.test.ts` compares `METHOD path`.

## Refreshing it

In the api clone, on a clean `master`:

```bash
export TESTCONTAINERS_RYUK_DISABLED=true      # this devcontainer only; Ryuk is unreachable over IPv6 here
./gradlew integration --tests "*OpenAPIPublisherTest*"
```

That writes `/tmp/openapi-specs.json`. **`--tests`, not `-Dtest.single=…`** — which this file used to say: it
is a Gradle 1.x idiom that is silently ignored rather than refused, so it "works" only by running the whole
integration source set. Harmless here, misleading anywhere else.

The test needs a database container, so Docker must be running.

Then, in this repo:

1. Reformat as you copy — the file is 2-space JSON and api emits it minified:
   `node -e 'const s=require("/tmp/openapi-specs.json");require("fs").writeFileSync("libs/deed-poll-api-client/openapi.json",JSON.stringify(s,null,2)+"\n")'`
2. Update the commit table above, and add a row for what it replaced rather than overwriting it.
3. **Diff the schemas, not only the paths and the operation count.** A count that moves correctly is entirely
   compatible with a request body published as `{}` — that is exactly what happened on 2026-09-17. Compare
   `components.schemas` property-by-property against the previous version, and account for every change:
   expected addition, known `operationId` churn, or a bug to raise upstream.
4. `yarn test` — `src/api/contract.test.ts` compares the document against the wire schemas, so anything api
   added or renamed fails rather than going unnoticed. Note what it cannot see: an **empty** schema matches an
   empty registration silently, which is why step 3 is a human read and not a test.

## Three things the document does not say

The first two are recorded in `src/api/wire.ts` at the code that compensates, and both are pinned by the
contract test so they cannot be quietly forgotten:

1. **Nullability of responses.** springdoc emits none for a response body, so `type: string` there means
   "a string when present" rather than "never null". The schemas treat every response property as nullable
   except the handful that are Java primitives at the source; `STRICT_RESPONSE_PROPERTIES` lists them.
2. **The error body.** api's failures come from a `@RestControllerAdvice`, and springdoc only publishes
   schemas a declared response references — so `ApiError` is absent from the document even though every
   4xx carries it. It lives in `UNSPECIFIED_SCHEMAS`.
3. **The actuator.** springdoc does not document management endpoints, so `GET /health/liveness` — the one
   path `checkApiReachable` and the readiness probe depend on — is absent, and `contract.test.ts` therefore
   cannot pin it. Its authority is api's `application.yaml` (`management.endpoints.web.base-path: /`, plus
   `management.endpoint.health.probes.enabled: true` and the `liveness` group's `include: livenessState`)
   and `SecurityConfiguration.PUBLIC_PATHS`, which allowlists `/health` and `/health/**` unauthenticated.
   **Re-check those two files when refreshing this document**: a change to the base path or to the probe
   group would take this app's readiness down permanently with nothing here failing to warn about it.
4. **The query vocabulary, except as prose.** The operator table, the value arity of each operator and the
   sortable field names arrive only inside the `where` and `sort` parameter *descriptions* — springdoc has
   no schema for "which operators a field's kind admits". So `contract.test.ts` cannot pin
   `libs/deed-poll/src/deed-poll/query-fields.ts` against them, and their authority is api's
   `QueryOperator` and `CaseSort.sortableFields()`. **Read those descriptions when refreshing this
   document**: an operator api adds is a control this app will not offer, and one it removes is a 400 the
   builder can produce.
