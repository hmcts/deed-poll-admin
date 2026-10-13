# Plan 16b: Gazette contract and request status

## Scope — 9 October 2026

Historical slice record: Steve subsequently chose mandatory gating.
[16c](16c-gazette-mandatory-review-and-send.md) implements the next journey; the
statements below describe 16b at completion.

This slice consumes merged API PR #93 (`742cb5a`) in an isolated admin worktree,
based on admin master `5cd70ad`. It completes contract reconciliation and the
read-only request/status/member part of [plan 16](16-gazette-1-ready-list-review-and-send.md).

The five-item review checklist and whether it blocks selection still need a business
answer. This slice does not choose that rule. It adds no send form or domain write
journey. No live email, deployment or Notify configuration has been performed.

## Completed work

- [x] Regenerate OpenAPI from a clean detached checkout of merged API master.
- [x] Account for the whole parsed delta: five operations, nine schemas and the
  public history `batchId`; all unrelated and deferred CCD definitions unchanged.
- [x] Add preview/submission/status/list/member client operations and strict wire
  parsers. Keep Gazette refusals separate from generic errors; never follow a POST
  redirect or retry automatically. Only the published structured code/status pairs
  establish an admission refusal. Unknown codes and malformed answers fail closed.
- [x] Add mock request fixtures, outcome selection, lost-response simulation,
  matching-key replay, recipient/selection conflicts, expiry, reservations and
  complete legacy membership. The mock sends no email and has no delivery engine.
- [x] Add read domain services and admin-only request list/detail pages. Preserve
  API ordering, paging and full totals. Explain all five states, offer explicit GET
  refresh, and show unavailable reads without a send control or server diagnostics.
- [x] Link history to full frozen membership by public batch ID. Leave missing
  legacy recipient/group counts unknown; never substitute current settings or cases.
- [x] Add bilingual copy, rendering tests and browser coverage for status/navigation,
  non-admin refusal, escaping, unavailable reads and membership beyond 100 references.

Request membership remains plain frozen reference text, so editing or deleting a
live application does not change this record. A failed member read preserves the
known status; a failed status read shows that the outcome cannot be determined.
The ready list explains that an existing request may reserve an otherwise ready case.

The client contains the published write operations so the contract inventory stays
complete. Domain write services, localised refusal recovery and preservation of a
per-journey key/body after a browser timeout belong to the next send-UI slice. Client
replay tests do **not** establish that the as-yet unimplemented browser journey is safe.

## Evidence

- API contract generation: `integration --tests '*OpenAPIPublisherTest*'` succeeded
  against `742cb5a`; raw SHA-256
  `c5465002de9a57d175cad73a9b33392b22d8e73337cd02df5ece51eec80b86cc`.
  Detailed provenance is in
  [SPEC-PROVENANCE.md](../../libs/deed-poll-api-client/SPEC-PROVENANCE.md).
- Clean admin baseline: lint passed; serial suite passed 3,597 tests, three skipped.
  Welsh extraction: 554 strings, 474 identical (467 prose, seven non-prose).
- Updated `yarn build`: passed. Existing GOV.UK asset/CSS warnings remain.
- Updated `yarn lint`: passed.
- Updated serial `npx turbo test test:app --concurrency=1`: 3,669 passed, three skipped.
- `yarn test:gazette`: all four IDAM-authenticated journeys passed, with inline axe
  checks and Welsh checks. Dedicated app/mock ports and disposable Redis/IDAM were
  used; no shared mock was reset.
- Welsh extraction: 615 strings, still 474 identical (467 prose, seven non-prose).
  The check retains its expected non-zero baseline; no new identical prose was added.
  New Welsh copy still requires human review.

## Next steps

1. Merge this admin slice after review.
2. Resolve checklist wording and gating, then build selection/review and
   preview-backed confirmation with stable per-journey request identity.
3. Implement domain write handling and the complete browser send/recovery journey,
   including lost responses, concurrent tabs, changed recipients and every refusal.
4. Deploy the merged API and migrations before this admin version. Provision Notify
   templates and download-link retention, complete language review, then explicitly
   enable sending as a separate operational step.
