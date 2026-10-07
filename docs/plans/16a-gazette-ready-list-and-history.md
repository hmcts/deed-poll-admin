# Plan 16a: London Gazette ready list and send history

## Overview

Deliver the independently usable, read-only portion of plan 16 against merged API PR #80,
commit `44c89a335069243997898fefd603afa9df85695e`: an admin-only worklist count, oldest-enrolled
ready list, and paginated send history. The parent plan remains active for checklist, selection,
confirmation and sending. There is no Gazette POST operation yet.

## Instructions and ownership

- Work only in this admin worktree on `plan-16-london-gazette`. Other developers have dirty work in
  the original admin/API checkouts and workspace tooling. Do not edit, reset, or clean those.
- Read this repository's CLAUDE.md and applicable .claude/rules files. Use existing adapter/domain/page,
  role-gate, i18n, error, pagination and template conventions.
- Ralphex runs implementation/internal review through Codex and external review through Copilot
  using `claude-opus-5`, selected by the workspace `codex-copilot-opus` profile. Do not invoke Claude
  Code, change the profile, or silently skip external review. Commit normal task progress locally;
  do not push or merge as part of this plan.
- Keep user-facing content about the user task. Do not add technical API dependency explanations,
  disabled send controls, checkboxes, invented review status, or placeholder send pages.

## Verified API contract and reconciliation

The generated post-review contract is available at
`../deed-poll-api-gazette/build/gazette-evidence/review-openapi.json` relative to this worktree.
SHA-256: `f4610f3ef37ed5ee332bc84f165cd154f50c68704ca3e2d04da2d2de5bc8fc64`.
It was regenerated successfully by OpenAPIPublisherTest on 7 October during API external review.
API worktree HEAD `80da0d37c2cc86c820feb6536eed2b56fd604c7b` has identical source/build inputs to
merged commit `44c89a335069243997898fefd603afa9df85695e` (verified by git diff). Prefer this
verified artifact over the shared `/tmp/openapi-specs.json`, which unrelated builds may overwrite.
Record this provenance honestly; do not claim a fresh generation at the squash commit.

The current admin contract is older. Expected additions are four operations across four paths:
`GET /caseworker/gazette-notices`, `GET /caseworker/ccd-attempts`,
`POST /caseworker/ccd-attempts/{attemptId}/reconciliation`, and
`POST /caseworker/ccd-attempts/{attemptId}/retry`. Five schemas are added:
`GazetteNoticeBatchResponse`, `GazetteNoticeHistoryResponse`, `CcdAttemptCountResponse`,
`CcdAttemptListResponse`, `CcdAttemptResponse`. No operations/schemas are removed.
Existing changes are case-list filter documentation, the readyForPublication enum member in both
saved-query request schemas, email template descriptions/new response descriptions, and document
upload's documented 409. Measure the actual full delta and account for every change.

Do not expand this into a CCD recovery UI or speculative client writes. If the exhaustive drift
tests require representing the deliberately unconsumed CCD surface, use an explicitly enumerated,
documented inventory with exact contract assertions, separate from implemented operations/wire
schemas. The union must still match the complete published contract in both directions; unknown
additions and changes to deferred definitions must fail. Do not filter paths by wildcard, pretend
unimplemented operations are implemented, silently omit schemas, or weaken existing drift checks.
Keep all existing consumed response shapes and header/body checks covered.

API owns ready membership and ordering: publishToLondonGazette true, dateNoticeSentToLondonGazette
null, state Enroled; default dateEnroled ascending with stable tie-break. The real admin must ask
for filter=readyForPublication with no sort or extra narrowing, never recompute this predicate.
The development mock alone reproduces API semantics and must match the actual Java source.

History is admin-only, page 1-based/default 1, size default 25/cap 100. Envelope: batches, page,
size, total, totalPages. Batch: sentAt, sentBy, caseCount, referenceNumbers, referencesTruncated.
References are an immutable, sorted preview capped at 100. caseCount is the total, not the preview
length. Show when the preview is truncated. There is no batch ID or full-history-detail endpoint.

## Validation

Install worktree dependencies with the pinned Yarn and immutable lockfile; do not share mutable
node_modules with the original checkout. Before edits record lint, test-file/test counts and Welsh
baseline. After each implementation task run `yarn lint` and
`npx turbo test test:app --concurrency=1`. Finish with build, focused browser journeys and inline
accessibility checks. Record actual commands/results and any baseline failures honestly.
Welsh identical-English entries already fail `yarn welsh:check`; compare the delta, do not claim
the baseline is clean or suppress its checks. Add extractable en/cy content following conventions.

Use isolated app/mock ports and Redis namespace/database for browser checks if existing development
services are active. Do not reset an existing mock or stop another developer's services. Read the
local auth/IDAM setup before testing; request escalation for necessary Docker/network/cache access.
Do not commit credentials, test sessions, build output or logs.

## Tasks

### Task 0: Record baseline and reconcile the complete published contract

- [x] Install dependencies, record baseline evidence, inspect SPEC-PROVENANCE.md and the actual contract delta.
- [x] Refresh the complete OpenAPI artifact and provenance; add Gazette wire schemas/client history call
      and ready filter vocabulary; explicitly account for the unrelated unconsumed CCD surface as above.
- [x] Extend contract/adapter tests to cover Gazette wire strictness, pagination, authentication and
      malformed/error responses while retaining exhaustive contract coverage. Add the minimal mock
      route needed to test the adapter here; Task 1 extends its fixtures and semantics. Pass validation.

### Task 1: Domain reads, realistic mock and local seed data

- [ ] Add thin Caller-based Gazette domain reads/view models through callApi; reuse existing list client.
- [ ] Implement matching ready filter and history semantics in the mock, including role checks, stable
      ordering, paging and bounded reference previews. Follow existing mock-only fixture facilities;
      do not invent a production send endpoint to seed audit history.
- [ ] Seed eligible/ineligible cases and past batches (including a truncated preview) for development;
      verify the seeder reads its results back. Test predicate boundary cases, ordering, totals, paging,
      role refusals, history truncation and normal domain error translation. Pass validation.

### Task 2: Admin area gate, dashboard count and ready list

- [ ] Mount requireRole(DEEDPOLL_ADMIN) at /deed-polls/gazette after requireAuth; extend the filesystem
      route coverage test. Test anonymous redirect, non-admin refusal, and admitted admins.
- [ ] Add independent degrade-and-log count on the main case list for admins only; non-admin sessions
      must make no Gazette count call. Zero and unavailable states must remain distinguishable, and
      admins must be able to reach the Gazette area even when no cases are currently ready.
- [ ] Implement a paginated read-only ready list at /deed-polls/gazette with case reference/detail links,
      appropriate available summary fields and history navigation. Preserve API's order even when a
      bookmarked URL supplies sort; no sorting controls, local filtering or selection state.
- [ ] Add extractable bilingual content and register the new area with the Welsh extractor in this task.
      Test populated/empty/error pages, count isolation, role boundary, navigation, paging and templates.
      Pass validation.

### Task 3: Paginated send history

- [ ] Add /deed-polls/gazette/history with sender, timestamp, full case count and escaped reference preview;
      indicate referencesTruncated accurately, with no invented ID-based links or full-detail action.
- [ ] Use shared pagination conventions and API response metadata; handle empty, out-of-range and failed
      reads consistently with existing list pages. Add handler/template/domain tests and bilingual content.
      Verify hostile reference/sender text remains escaped and caseCount is never preview length.
      Pass validation.

### Task 4: Browser journeys, full validation and parent-plan handoff

- [ ] Add minimal full browser journeys covering admin count-to-ready-list-to-case/history navigation,
      pagination/truncated preview and empty state, plus a non-admin's denied Gazette area and absent count.
      Include accessibility/Welsh checks following repository conventions; run against this worktree's app.
- [ ] Run full lint, tests, build and Welsh extraction/check delta; record measured outcomes and evidence.
- [ ] Update CLAUDE/README only where needed to document new cross-file behavior and development seed data.
      Annotate parent plan16 accurately: completed gate/count/history versus remaining review/selection/send,
      contract/business dependencies, and the missing full send-journey E2E. Do not mark parent16 complete.
- [ ] Ensure clean committed worktree, move only this completed subplan to completed/, and fix parent links
      when moving it. Ralphex internal and Copilot Opus external review must run before reporting completion.


## Task 0 evidence — 7 October 2026

- Installed with `yarn install --immutable`, pinned Yarn 4.18.0, using this worktree's own node_modules.
  Lockfile unchanged. Existing peer warnings concern Redis and playwright-core; dependency build scripts
  were disabled by the environment. No sibling checkout was modified.
- Before edits: `yarn lint` passed (392 files, two existing Biome configuration infos).
  `npx turbo test test:app --concurrency=1` passed all eight tasks: 169 test files, 3,355 tests passed,
  three skipped. `yarn welsh:check` exited 1: 503 strings, 474 identical cy entries
  (467 prose, seven non-prose).
- Verified the review artifact's SHA-256 against the plan. The copied JSON is structurally identical
  after formatting. Full delta and source provenance are in the API client's SPEC-PROVENANCE.md:
  44 operations / 31 paths / 44 schemas, including the explicitly pinned unconsumed CCD surface.
- Added Gazette wire schemas, history client and filter vocabulary; the minimal mock serves empty
  history, paging, decoded-token admin checks and outages. Batch fixtures and ready semantics remain
  Task 1. Existing main case-list tabs deliberately exclude the separate admin queue; their test still
  accounts for the complete published vocabulary by exact equality.
- Validation: `yarn format` and `yarn lint` passed (393 checked files, same two Biome infos).
  `npx turbo test test:app --concurrency=1` passed all eight tasks: 169 files, 3,408 tests passed,
  three skipped, an increase of 53 passing tests. Focused API-client tests passed 532 tests;
  `yarn workspace @hmcts/deed-poll-api-client build` passed. `git diff --check` passed.
- `yarn welsh:check` still exits 1 with exactly the baseline counts; no user-facing strings changed.
  Full application build, browser journeys and Ralphex internal / Copilot Opus external review remain
  scheduled in Task 4, not represented as completed here.
