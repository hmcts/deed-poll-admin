# Where `openapi.json` came from

Taken from `deed-poll-api`'s own published document, not hand-written. Task 1 of
`docs/plans/completed/02-dal-cutover-to-api.md`: api exists, so a divergence between this file and api is a bug in
one of them rather than licence to invent.

| | |
|---|---|
| **api commit** | `051f3b49d101a4e0cefc9477de9ea4f618ad1bf9` — "Allow Administrators to delete a witness (#9)", 2026-09-13 |
| **Taken on** | 2026-09-13 |
| **How** | `GET /v3/api-docs`, as api's `OpenAPIPublisherTest` captures it for the `hmcts/cnp-api-docs` publish workflow. Reformatted (2-space JSON) and otherwise unmodified. |
| **Operations** | 18 caseworker operations plus Spring Boot's `GET /`. The newest is `DELETE /caseworker/cases/{id}/witnesses/{witnessId}`, which merged in the commit above and is what task 2 of `docs/plans/06-witness-delete.md` needed. It carries an **Administrator gate api enforces in the domain** — `WitnessService.removeWitness` calls `requireAnyRole` before it resolves the witness — and the document says nothing about that, because springdoc has no vocabulary for it. api's own tests are its authority; nothing here re-checks a role. |

Both operation counts are right and neither is a bug: api's `OpenAPIPublisherTest` asserts the caseworker
count of 18, and the nineteenth path is the welcome route.

**The `delete` operation ids are Spring's, and they collide by shape.** springdoc names an operation after
its handler method, so the note delete is `delete_1` and the witness delete is `delete` — the suffix moves
between refreshes as controllers are added, which is why nothing here keys off an `operationId`.
`contract.test.ts` compares `METHOD path`.

## Refreshing it

Run api's publisher test — `./gradlew integration -Dtest.single=OpenAPIPublisherTest` in the api clone, or
the `publish-openapi` workflow's job — which writes `/tmp/openapi-specs.json`. Copy that over
`openapi.json`, update the commit above, and run `yarn test` here: `src/api/contract.test.ts` compares the
document against the wire schemas, so anything api added or renamed fails rather than going unnoticed.

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
