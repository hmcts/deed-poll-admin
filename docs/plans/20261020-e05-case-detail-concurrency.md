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

- [ ] Cover required case failure while optional reads are pending, then let both optional reads settle
      or reject. Assert the original required error reaches the handler boundary and rules are not read.
- [ ] Cover field-rules failure while optional reads are pending and later reject. Assert the existing
      fatal behaviour and no unhandled rejection or duplicate error logging.
- [ ] Cover referral-only failure, email-only failure and both failures. Preserve each panel's fallback,
      logging count and the other panel's usable data.
- [ ] Cover fast optional failures before the case resolves. Keep existing rules about logging only once
      the case is known to exist, and ensure all promises are observed.
- [ ] Verify existing permission-derived controls, banners and page output remain unchanged. Use
      deterministic promise settlement and clean up any process-level listeners used by tests.
- [ ] Run focused tests and all Validation Commands; record results.

### Task 3: Record the scheduling guarantee and review

**Files:** `src/pages/deed-polls/[id].ts` only if a short dependency comment aids maintenance,
and this plan's Execution notes.

- [ ] Remove obsolete sequencing comments and document the dependency only where it is not obvious
      from the final code. Avoid introducing a new abstraction for three reads and one dependent read.
- [ ] Record starting/final commits, changed files, deterministic ordering evidence, failure coverage,
      test counts and skips. Describe the benefit as overlapping independent work; do not invent a
      production latency saving.
- [ ] Run all Validation Commands and hand off to Ralphex review phases. Record review findings and
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

## Post-Completion

Hand the reviewed branch and evidence to Steve. Publishing, merging and deployment are separate actions.
Move this plan to `docs/plans/completed/` only after implementation and review. Do not start Ralphex as
part of authoring this plan.
