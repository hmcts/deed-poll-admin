/**
 * The adapter. Nothing else.
 *
 * `./api/wire.js` is deliberately NOT re-exported: the wire schemas are an implementation detail, and
 * re-exporting them would let a page parse a raw response for itself — the coupling decision 1 of
 * `docs/plans/completed/02-dal-cutover-to-api.md` exists to prevent. The domain types the adapter returns ARE
 * exported, from `client.ts`, which is what task 2 re-points the type-only imports at.
 *
 * `./mock/` is not re-exported either, for a plainer reason: the app imports this index, so an
 * in-memory api — with its `/__mock/scenario` switch and its seeding route — would be reachable inside the
 * deployed artifact. The mock's own consumers (`src/mock/main.ts`, and the tests) reach it by relative
 * path, and `yarn mock:api` runs it directly, so nothing needs it here.
 */
export * from "./api/client.js";
export { assertApiBaseUrl } from "./api/transport.js";
