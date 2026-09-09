# Where `openapi.json` came from

Taken from `deed-poll-api`'s own published document, not hand-written. Task 1 of
`docs/plans/02-dal-cutover-to-api.md`: api exists, so a divergence between this file and api is a bug in
one of them rather than licence to invent.

| | |
|---|---|
| **api commit** | `847933a3709862288ed5f8c8050d5adbf0bbea0c` — "Expose the note delete as the thirteenth caseworker operation (#4)", 2026-09-08 |
| **Taken on** | 2026-09-09 |
| **How** | `GET /v3/api-docs`, as api's `OpenAPIPublisherTest` captures it for the `hmcts/cnp-api-docs` publish workflow. Reformatted (2-space JSON) and otherwise unmodified. |
| **Operations** | 13 caseworker operations plus Spring Boot's `GET /`. The thirteenth is `DELETE /caseworker/cases/{id}/notes/{noteId}`, the prerequisite this plan needed, which merged in the commit above. |

## Refreshing it

Run api's publisher test — `./gradlew integration -Dtest.single=OpenAPIPublisherTest` in the api clone, or
the `publish-openapi` workflow's job — which writes `/tmp/openapi-specs.json`. Copy that over
`openapi.json`, update the commit above, and run `yarn test` here: `src/api/contract.test.ts` compares the
document against the wire schemas, so anything api added or renamed fails rather than going unnoticed.

## Two things the document does not say

Both are recorded in `src/api/wire.ts` at the code that compensates, and both are pinned by the contract
test so they cannot be quietly forgotten:

1. **Nullability of responses.** springdoc emits none for a response body, so `type: string` there means
   "a string when present" rather than "never null". The schemas treat every response property as nullable
   except the handful that are Java primitives at the source; `STRICT_RESPONSE_PROPERTIES` lists them.
2. **The error body.** api's failures come from a `@RestControllerAdvice`, and springdoc only publishes
   schemas a declared response references — so `ApiError` is absent from the document even though every
   4xx carries it. It lives in `UNSPECIFIED_SCHEMAS`.
