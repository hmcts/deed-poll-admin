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

- [x] Add thin Caller-based Gazette domain reads/view models through callApi; reuse existing list client.
- [x] Implement matching ready filter and history semantics in the mock, including role checks, stable
      ordering, paging and bounded reference previews. Follow existing mock-only fixture facilities;
      do not invent a production send endpoint to seed audit history.
- [x] Seed eligible/ineligible cases and past batches (including a truncated preview) for development;
      verify the seeder reads its results back. Test predicate boundary cases, ordering, totals, paging,
      role refusals, history truncation and normal domain error translation. Pass validation.

### Task 2: Admin area gate, dashboard count and ready list

- [x] Mount requireRole(DEEDPOLL_ADMIN) at /deed-polls/gazette after requireAuth; extend the filesystem
      route coverage test. Test anonymous redirect, non-admin refusal, and admitted admins.
- [x] Add independent degrade-and-log count on the main case list for admins only; non-admin sessions
      must make no Gazette count call. Zero and unavailable states must remain distinguishable, and
      admins must be able to reach the Gazette area even when no cases are currently ready.
- [x] Implement a paginated read-only ready list at /deed-polls/gazette with case reference/detail links,
      appropriate available summary fields and history navigation. Preserve API's order even when a
      bookmarked URL supplies sort; no sorting controls, local filtering or selection state.
- [x] Add extractable bilingual content and register the new area with the Welsh extractor in this task.
      Test populated/empty/error pages, count isolation, role boundary, navigation, paging and templates.
      Pass validation.

### Task 3: Paginated send history

- [x] Add /deed-polls/gazette/history with sender, timestamp, full case count and escaped reference preview;
      indicate referencesTruncated accurately, with no invented ID-based links or full-detail action.
- [x] Use shared pagination conventions and API response metadata; handle empty, out-of-range and failed
      reads consistently with existing list pages. Add handler/template/domain tests and bilingual content.
      Verify hostile reference/sender text remains escaped and caseCount is never preview length.
      Pass validation.

### Task 4: Browser journeys, full validation and parent-plan handoff

- [x] Add minimal full browser journeys covering admin count-to-ready-list-to-case/history navigation,
      pagination/truncated preview and empty state, plus a non-admin's denied Gazette area and absent count.
      Include accessibility/Welsh checks following repository conventions; run against this worktree's app.
- [x] Run full lint, tests, build and Welsh extraction/check delta; record measured outcomes and evidence.
- [x] Update CLAUDE/README only where needed to document new cross-file behavior and development seed data.
      Annotate parent plan16 accurately: completed gate/count/history versus remaining review/selection/send,
      contract/business dependencies, and the missing full send-journey E2E. Do not mark parent16 complete.
- [x] Ensure clean committed worktree, move only this completed subplan to completed/, and fix parent links
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


## Task 1 evidence — 7 October 2026

- Reused this worktree's isolated dependencies installed immutably in Task 0. Before edits, lint passed
  (393 files, two existing Biome infos); all eight test tasks passed (169 files, 3,408 passing tests,
  three skipped). Welsh baseline remained 503 strings / 474 identical cy entries (467 prose, seven non-prose).
- Added Caller-based ready-list, count and history reads through callApi, with paging only and no local
  membership/order decisions. Ready rows reuse buildCaseList; the history view preserves API counts,
  truncation and plain reference/sender text, formatting timestamps through the existing formatter.
- Matched the mock against API CaseSpecifications, ListFilters, DeedPollService.order,
  GazetteNoticeHistory and GazetteNoticeBatchCaseRepository. Ready ordering uses enrolment then ascending
  case ID; history uses descending send time/ID and frozen references ordered by UTF-8 bytes, capped at 100.
  Fixture-only POST /__mock/gazette-batches seeds membership, rejects invalid dates/duplicate IDs and resets
  with the mock. No production Gazette write was added. History retains the decoded-token admin gate;
  the ready filter remains on API's existing case-list surface, with the UI admin gate scheduled in Task 2.
- Added 43 tests covering all eight state boundaries, publication/sent-date exclusions, stable ordering,
  pagination/totals, role refusals, truncation boundaries, immutable history, zoneless wire timestamps,
  reset/outage behaviour, Caller forwarding, dropped extraneous queries and domain error translation.
- Final `yarn format` and `yarn lint` passed (398 checked files, same two Biome infos).
  `npx turbo test test:app --concurrency=1` passed all eight tasks: 172 files, 3,451 tests passed,
  three skipped. Both `yarn workspace @hmcts/deed-poll-api-client build` and
  `yarn workspace @hmcts/deed-poll build` passed. `git diff --check` passed.
- Ran `yarn mock:api --port 0` in this worktree and pointed `yarn mock:seed` at its isolated URL using
  DEED_POLL_API_MOCK_URL. Read-back checks passed: 57 cases, 26 ready cases, 26 batches over two history
  pages, newest batch 101 cases with 100 sorted references and truncation true. `yarn mock:seed --keep`
  passed with 114 cases / 52 ready / 52 batches. Stopped only the mock processes started for these checks.
- `yarn welsh:check` still exits 1 with exactly the baseline counts; no user-facing content added.
  Full application build, browser checks and internal/external review remain Task 4.


## Task 2 evidence — 7 October 2026

- Reused the worktree's own dependencies installed immutably in Task 0. Before edits, lint passed
  (398 checked files, two existing Biome infos); all eight test tasks passed (172 files, 3,451 passing
  tests, three skipped). Welsh baseline: 503 strings / 474 identical cy entries (467 prose, seven non-prose).
- Mounted requireRole(DEEDPOLL_ADMIN) on /deed-polls/gazette after authentication and persona locals,
  before routing. Filesystem-derived coverage includes every Gazette page and the future history route;
  tests cover anonymous redirects, caseworker/judicial refusal, and admins with either persona combination.
- Added the independent admin-only count through the existing degrade-and-log helper. Non-admins make
  no Gazette read; zero and unavailable render differently, and both retain the area link. Failures in
  either the Gazette count or the other counts leave the successful counts and main list available.
- Added the read-only ready list using buildCaseList and API pagination metadata. Only page travels to
  the domain; bookmarked sort, search, filter, where and size are ignored. API row order is preserved,
  table headings are plain text, and no selection or send controls exist. Cases link to details; the
  history navigation targets Task 3's route. Empty and out-of-range pages differ and offer recovery.
  Tests cover totals, paging, navigation, escaped references/names, Welsh rendering and failed reads.
- The Welsh extractor already recursively includes the Gazette directory through deed-polls; documented
  that coverage and ran yarn welsh:extract. All 17 new strings are extracted with bilingual content.
  The regenerated catalogue also catches up two existing translated header strings. yarn welsh:check
  still exits 1: 520 strings, the same 474 identical entries (467 prose, seven non-prose). New Welsh copy
  has not received human language review.
- Initial focused validation caught an overbroad test assertion matching an existing Gazette query
  field; narrowed it to the new count/navigation. Final yarn format and yarn lint passed (400 checked
  files, same two Biome infos). npx turbo test test:app --concurrency=1 passed all eight tasks:
  173 files, 3,482 passing tests, three skipped — 31 new passing tests. git diff --check passed.
- A standalone npx tsc -p tsconfig.app.json --noEmit initially failed because starter workspace build
  declarations were absent. Running the normal yarn build built dependencies in order and passed all
  eight tasks, including application TypeScript and Vite. No source workaround was needed.
- Browser/accessibility journeys and Ralphex internal / Copilot Opus external review remain Task 4.
  Task 3 history implementation has not been started in this iteration.


## Task 3 evidence — 7 October 2026

- Reused this worktree's isolated dependencies installed immutably in Task 0. Before edits, yarn lint
  passed (400 checked files, two existing Biome infos); all eight test tasks passed with 173 files,
  3,482 passing tests and three skipped. Welsh baseline: 520 strings / 474 identical cy entries
  (467 prose, seven non-prose).
- Added /deed-polls/gazette/history under the existing admin area gate, using the existing Caller-based
  domain read and history view. The page preserves batch/reference order, formats timestamps, shows
  the full caseCount independently of preview length, and follows referencesTruncated exactly.
  Sender and reference text are escaped through the real GOV.UK table macro. There are no invented
  batch/detail links. Ready-list navigation is present even when history is empty.
- Shared pagination uses API metadata and only the parsed page travels to the domain. Empty history
  and out-of-range pages differ, with first-page recovery; failed reads propagate to the shared error
  handler. Added 17 handler/template tests and one domain test covering these behaviours, hostile
  text, unsupported query controls and Welsh rendering; existing history view/error tests also pass.
- yarn format and yarn lint passed (402 checked files, same two Biome infos).
  npx turbo test test:app --concurrency=1 passed all eight tasks: 174 files, 3,500 tests passed,
  three skipped. npx tsc -p tsconfig.app.json --noEmit and git diff --check passed.
- yarn welsh:extract refreshed the catalogue with all 13 new strings. yarn welsh:check still exits 1:
  533 strings, the same 474 identical entries (467 prose, seven non-prose). New Welsh copy awaits
  human language review. Full browser/accessibility journeys, build and internal/external review
  remain Task 4, which was not started in this iteration.


## Task 4 evidence — 7 October 2026

- Reused the worktree's own immutable-installed dependencies. Before edits, lint passed (402 files,
  two existing Biome configuration infos); all eight test tasks passed, 174 files / 3,500 passing tests
  / three skipped. Welsh baseline was 533 strings / 474 identical cy entries (467 prose, seven non-prose).
- Added `yarn test:gazette`, two complete Playwright journeys using this worktree's app on 3316,
  a fresh mock on 3216 and separate Redis on 6316/database 1. Signed in through the real local IDAM
  simulator on 5556. The suite refuses existing app/mock ports and never resets another mock.
  Covered zero count and empty ready/history, populated count-to-list-to-case/history navigation,
  keyboard activation, the private-case indicator, both second pages, 101-case/100-reference truncation, escaped sender/references,
  Welsh headings/paging/truncation, absent non-admin count/link and 403 on both Gazette routes.
  Inline WCAG 2 A/AA and 2.1 A/AA axe scans passed with no exclusions. Final browser run: two passed.
- Browser execution caught and fixed a real mock integration defect: the simulator's access token
  has no roles; those come from userinfo. The standalone mock now resolves missing roles using its
  configured local userinfo endpoint; in-process role fixtures still work. Six added tests exercise
  admin/non-admin/malformed-role responses, missing identity and upstream refusals, including bearer
  forwarding. Production authentication is unchanged. Initial config composition also accidentally
  retained the default web servers; replacing the config object fixed this before the successful runs.
- `yarn format` and `yarn lint` passed (404 files, same two Biome infos).
  `npx turbo test test:app --concurrency=1` passed all eight tasks: 174 files, 3,507 passing tests,
  three skipped. `yarn build` passed all eight tasks, including application TypeScript and Vite.
  `yarn welsh:extract` now captures 534 strings (one additional translated Privacy heading);
  `yarn welsh:check` exits 1 with the same 474 identical entries as the baseline. New Welsh copy still needs human language review. `git diff --check` passed.
- Browser startup emitted existing optional Azure credential/secret-volume warnings; the local app
  started and both journeys passed. No credentials, sessions, generated build output or logs are committed.
- Updated README/CLAUDE for read-only Gazette behavior, seed fixtures, mock userinfo and isolated
  browser prerequisites. Parent plan 16 marks only gate/count and history tasks complete; contract
  reconciliation for sending, selection/checklist, confirmation/Notify, business decisions and the
  full send-journey E2E remain outstanding.
- Ralphex internal quality, implementation, testing, simplification and documentation reviews completed.
  The documentation review's missing build prerequisite was fixed and rechecked; final focused
  critical/major reviews found no issues.
- Independent Copilot CLI review ran with `claude-opus-5`, matching the workspace
  `codex-copilot-opus` profile, which was not changed. Automatic approval rejected broad tool access;
  the successful invocation enabled only the read-only view tool and read a prepared branch diff plus
  source files. Session events verified the model and no reads of internal progress transcripts.
  The first review produced six suggestions: added the ready-list Privacy indicator with bilingual
  heading and tests, decoupled ready paging from the history query type, and corrected two comments.
  Retained authentication before unsupported methods (401/403 remain appropriate refusals), and the
  page-specific out-of-range predicate (the shared helper also includes empty totals). Copilot's
  focused follow-up verified the fixes and both retained decisions, ending `NO ISSUES FOUND`.
- Re-ran lint, all unit tests, build, Welsh extraction/check and both browser journeys after review fixes;
  the final results are recorded above. Stopped only this iteration's temporary services. Archived
  only this completed subplan and updated its parent link; parent plan 16 remains active.
