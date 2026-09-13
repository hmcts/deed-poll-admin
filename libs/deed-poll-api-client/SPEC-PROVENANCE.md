# Where `openapi.json` came from

Taken from `deed-poll-api`'s own published document, not hand-written. Task 1 of
`docs/plans/completed/02-dal-cutover-to-api.md`: api exists, so a divergence between this file and api is a bug in
one of them rather than licence to invent.

| | |
|---|---|
| **api commit** | `ee5cc86b004dbceaa29517d5204b34119f176824` — "Expose witness create and edit on the caseworker surface (#8)", 2026-09-12 |
| **Taken on** | 2026-09-12 |
| **How** | `GET /v3/api-docs`, as api's `OpenAPIPublisherTest` captures it for the `hmcts/cnp-api-docs` publish workflow. Reformatted (2-space JSON) and otherwise unmodified. |
| **Operations** | 17 caseworker operations plus Spring Boot's `GET /`. The four newest are the witness routes — list, add, read and amend — which merged in the commit above and are what task 2 of `docs/plans/05-witness-create-and-edit.md` needed. There is deliberately **no** `DELETE` on a witness: it carries an Administrator gate and is api's own change. |

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
