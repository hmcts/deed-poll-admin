# Plan: start case field rules before optional panels finish

## Overview

Address review finding **E05 (Lower)**: the case-detail handler waits for referrals and emails before
starting the required field-rules request, although rules depend only on the case. Start that request
as soon as the case is available, preserving required-read failures and independent optional panels.

## Context

Reviewed baseline: `649c30e01870abe2b57be43d6c17a02fbfffad72` on admin `origin/master`.
Read `CLAUDE.md` and applicable `.claude/rules/` before implementation. Record the execution baseline
and recheck the handler there. Use an isolated feature worktree based on the intended integration
branch; do not switch or implement on the older `fix/api-transport-tls` authoring checkout.

In `src/pages/deed-polls/[id].ts`, the handler waits for case, referrals and email reads with
`Promise.allSettled`, checks the case result, and only then calls `getCaseFieldRules`.
The review held referrals pending and observed that rules did not start until referrals settled.
This proves a scheduling dependency, not a measured production latency penalty.

Ignoring rendering overhead, change the dependency graph from:

```text
max(case, referrals, emails) + field rules
```

to:

```text
max(case + field rules, referrals, emails)
```

Optional historical evidence is in workspace
`local-notes/deed-poll-admin/20261020-ellis-review-evidence/ellis-review-performance.probe.test.ts`.
Adapt it into a portable regression with the desired expectation; do not import the workspace file.

## Development Approach

1. Start independent case/referral/email reads together. Chain field rules directly from the successful
   case promise and aggregate that required chain with optional outcomes.
2. Attach rejection handling to every started promise immediately. A required failure must not leave
   an optional rejection unobserved. Keep the existing response/failure semantics; this plan does not
   require a new timeout, cancellation or fail-fast policy.
3. Case and field rules remain required; referrals and emails retain separate degraded states and
   existing logging behaviour. Do not issue a rules request for a failed case read or log optional
   panel failures as though a nonexistent case were successfully loaded.
4. Keep API call counts, caller/token propagation, permission checks, banners, forms and rendered data
   unchanged. No cross-user cache, new dependency, UI change or API change.
5. Test ordering with deferred promises and explicit barriers. Do not use sleep-based latency assertions
   or claim a benchmark from unit tests. Prefer a small local promise composition to a general scheduler.
6. Work test first, complete each task before the next and preserve others' changes. Record the review
   base and use local task commits as appropriate. Publishing, merging and deployment are separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Record actual counts, failures and skips; distinguish
baseline failures from regressions and inspect formatting diffs for unrelated changes.

For the red/green cycle, shell-quote the literal filename:

```bash
yarn vitest run 'src/pages/deed-polls/[id].test.ts'
```

No live API or browser timing benchmark is required for this orchestration change.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build
ends the session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: Remove the unnecessary scheduling dependency

**Files:** `src/pages/deed-polls/[id].ts` and `src/pages/deed-polls/[id].test.ts`.

- [x] Trace the current reads, required error handling and optional-panel logging on the execution
      baseline. Confirm field rules require only the resolved case and existing caller context.
- [x] Add a failing deterministic test that starts the handler, resolves the case, leaves referrals
      pending and observes the field-rules call before releasing referrals.
- [x] Add the equivalent delayed-email case and assert rules do not begin before the case resolves.
      Assert all independent reads were started without waiting for one another.
- [x] Compose the required case-to-rules promise chain with the optional outcomes. Register rejection
      handling immediately and keep rendering dependent on the data the page still needs.
- [x] Assert one case call and one rules call, with unchanged arguments/caller, and unchanged successful
      view-model output. Run focused tests and all Validation Commands; record red/green evidence.

### Task 2: Preserve failures and independent degradation

**Files:** `src/pages/deed-polls/[id].test.ts`; adjust the handler only as required by these tests.

- [x] Cover required case failure while optional reads are pending, then let both optional reads settle
      or reject. Assert the original required error reaches the handler boundary and rules are not read.
- [x] Cover field-rules failure while optional reads are pending and later reject. Assert the existing
      fatal behaviour and no unhandled rejection or duplicate error logging.
- [x] Cover referral-only failure, email-only failure and both failures. Preserve each panel's fallback,
      logging count and the other panel's usable data.
- [x] Cover fast optional failures before the case resolves. Keep existing rules about logging only once
      the case is known to exist, and ensure all promises are observed.
- [x] Verify existing permission-derived controls, banners and page output remain unchanged. Use
      deterministic promise settlement and clean up any process-level listeners used by tests.
- [x] Run focused tests and all Validation Commands; record results.

### Task 3: Record the scheduling guarantee and review

**Files:** `src/pages/deed-polls/[id].ts` only if a short dependency comment aids maintenance,
and this plan's Execution notes.

- [x] Remove obsolete sequencing comments and document the dependency only where it is not obvious
      from the final code. Avoid introducing a new abstraction for three reads and one dependent read.
- [x] Record starting/final commits, changed files, deterministic ordering evidence, failure coverage,
      test counts and skips. Describe the benefit as overlapping independent work; do not invent a
      production latency saving.
- [x] Run all Validation Commands and hand off to Ralphex review phases. Record review findings and
      revalidation for any fixes.

## Acceptance Criteria

- Rules start once the case resolves, while delayed referrals/emails are still pending.
- Case/rules failures remain fatal; referral/email failures degrade independently.
- Every started promise has rejection handling, including when required reads fail.
- No duplicate reads, changed caller context, altered view-model data or new cache is introduced.
- Regression tests prove dependency ordering without wall-clock timing assumptions.

## Execution notes

Planning only, 20 October 2026. Ellis authored this plan from review finding E05. No implementation,
new validation run or Ralphex execution has been performed for this plan. Append execution evidence here.
(Superseded: implemented 20 October 2026, see the Task 1–3 and Review notes below.)

### Task 1 (20 October 2026)

- Execution baseline `d9b3457` on `fix/e05-case-detail-concurrency` (branched from master after #211/#213).
  The handler there matched the review: `Promise.allSettled([case, referrals, emails])`, then the case check,
  then `getCaseFieldRules` built from `type`, `migratedRecord` and `publishToLondonGazette` with the same
  `caller`. Rules need nothing but the resolved case and the caller.
- Red: five new `read scheduling` tests in `src/pages/deed-polls/[id].test.ts`, using hand-settled deferred
  promises and a `setImmediate` microtask drain (no timers). The pending-referrals and pending-emails tests
  failed on the baseline (rules call count 0 before release, expected 1); 2 failed, 61 passed.
- Green: `src/pages/deed-polls/[id].ts` chains `getCaseFieldRules` off `findDeedPoll(...).then(...)` and
  aggregates that required chain with the two optional reads in one `Promise.allSettled`, so every started
  promise is observed. A failed case read rejects the chain without a rules call. 63/63 focused tests pass,
  including one case call, one rules call with unchanged arguments and caller, all three reads started
  before the case resolves, and an identical render model whichever optional read settles last.
- Validation: `yarn lint` clean (one pre-existing Biome config-migration info); `yarn build` 8/8 tasks;
  `REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force` exit 0 — app 111 files /
  2424 tests, deed-poll 1291, api-client 804, cloud-native-platform 157, express-govuk-starter 127,
  simple-router 41, express-session-postgres 23, express-session-redis 7; 0 failed, 0 skipped.

### Task 2 (20 October 2026)

- Eight `read failures` tests in `src/pages/deed-polls/[id].test.ts`; no handler change was needed. They cover a
  case-read rejection with both optional reads pending (one later resolves, one rejects): the original error object
  reaches the boundary, no rules call, no render, no log. They cover a rules rejection with both optional reads
  later rejecting: the original error, one rules call, nothing logged by the page. They cover referral-only,
  email-only and both failing, each panel degrading alone with one log line per failure. They cover optional
  failures landing before the case resolves (no log until it does, then two) and before a case read that then 404s
  (no log, no rules). The last test covers a Team leader with a send banner and late optional reads: the render
  model is identical to the prompt one, privacy stays editable and the banner link is unchanged.
- Unhandled-rejection checks use a per-test `process.on("unhandledRejection")` listener removed in `afterEach`. A
  first version could not fail: vitest's spy attaches handlers to any `Promise` a mock returns (`settledResults`),
  which hides a promise the handler never observes. Mocks in this block therefore return a non-Promise thenable
  (`unwatched`, `failingRead`). Mutation check: replacing the aggregate with `await required` before settling the
  optional reads made 4 of the 8 fail; restored, 71/71 pass.
- Validation: `yarn lint` clean (same pre-existing Biome info; one justified `noThenProperty` suppression on the
  helper); `yarn build` 8/8; `REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force`
  exit 0. App 111 files / 2432 tests, deed-poll 1291, api-client 804, cloud-native-platform 157,
  express-govuk-starter 127, simple-router 41, express-session-postgres 23, express-session-redis 7. 0 failed,
  0 skipped.

### Task 3 (20 October 2026)

- Comments: the baseline's "Together, because no answer depends on another" sequencing comment and the separate
  comment above the trailing `getCaseFieldRules` call were replaced in Task 1 by one comment on the
  `required` chain, which says that rules hang off the case alone and that a failed case read makes no rules
  call, and one on the `allSettled` aggregate, which says it observes every started promise. No helper or
  scheduler was introduced. The module docblock ("two of the four calls are fatal") still holds and was left as
  it is. Task 3 makes no handler change.
- Commits: started at `d9b3457` (plan only). Task 1 is `38c6b2c`, Task 2 is `b89112e`, and this note is the
  Task 3 commit. Changed files across the branch: `src/pages/deed-polls/[id].ts`,
  `src/pages/deed-polls/[id].test.ts` and this plan.
- Ordering evidence: five `read scheduling` tests use hand-settled deferred promises and a `setImmediate`
  drain, with no timers or sleeps. Rules are called while referrals, and separately emails, are still pending.
  Rules are not called before the case resolves. All three reads start before any settles. There is one case
  call and one rules call, with unchanged arguments and caller. The render model is identical whichever read
  settles last. On the baseline, the pending-referrals and pending-emails tests failed (rules call count 0,
  expected 1).
- Failure coverage: eight `read failures` tests (Task 2). Case or rules rejection is fatal and keeps the original
  error, with no rules call after a failed case read. Each optional panel degrades alone, with one log line per
  failure and only once the case exists. No rejection goes unhandled: they use non-Promise thenables so that
  vitest's own handlers cannot mask one. Mutation check: awaiting the required chain before the optional reads
  fails 4 of the 8.
- Benefit: field rules now overlap with the referrals and emails reads instead of following them, so the
  dependency is `max(case + rules, referrals, emails)`. The latency saving was not measured; none is claimed.
- Validation: `yarn lint` clean (pre-existing Biome config-migration info only). `yarn build` 8/8.
  `REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force` exit 0. App 111 files /
  2432 tests, deed-poll 1291, api-client 804, cloud-native-platform 157, express-govuk-starter 127,
  simple-router 41, express-session-postgres 23, express-session-redis 7. 0 failed, 0 skipped.
- Review: the task work is finished. Ralphex's review phases run after the task loop. They had produced no
  findings when this note was written, so nothing has been fixed or revalidated yet.

### Review (20 October 2026)

- Ralphex review 0 found that a rules failure threw before the referrals and emails failures were logged, so a
  request whose case existed lost those log lines — a change from the baseline, which logged the panels before
  reading rules. The handler now settles the case and its rules as two promises in the one `allSettled`, throws
  a case failure before logging, logs the panels, then throws a rules failure. The rules-failure test now expects
  both panel log lines. Revalidated: lint clean (pre-existing Biome info), build 8/8, full suite with REDIS_URL exit 0 (app 2433 tests), 0 failed, 0 skipped. Also added: a test with the rules finishing after both optional reads, and a reset of the
  rules mock after each `read failures` test so an unconsumed one-shot stub cannot leak. CLAUDE.md's Performance
  Considerations now describe the chained rules read.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Publishing, merging and deployment are separate actions.
Move this plan to `docs/plans/completed/` only after implementation and review. Do not start Ralphex as
part of authoring this plan.
