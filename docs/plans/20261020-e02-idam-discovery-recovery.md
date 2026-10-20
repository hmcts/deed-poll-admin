# Plan: recover from transient IDAM discovery failures

## Overview

Address review finding **E02 (Medium)**: the first rejected OIDC discovery promise remains cached, so
later authentication attempts fail even after IDAM recovers. Retain successful discovery caching and
in-flight sharing while allowing bounded recovery without restarting the application.

## Context

Reviewed baseline: `649c30e01870abe2b57be43d6c17a02fbfffad72` on admin `origin/master`.
Read `CLAUDE.md` and applicable `.claude/rules/` before implementation. Recheck the finding on the
execution branch and record its starting commit. Authoring used the older `fix/api-transport-tls`
checkout; use an isolated feature worktree on the intended integration baseline, preserving others' work.

`src/auth/idam.ts` holds a module-level `discovered` promise. The review used the real OIDC discovery
client against a local server: a first 503 poisoned both subsequent `beginLogin` calls; resetting the
cache allowed the now-healthy endpoint to be used. The first two calls made only one discovery request.

Optional reproduction evidence is in workspace
`local-notes/deed-poll-admin/20261020-ellis-review-evidence/ellis-review.probe.test.ts`;
the accompanying review report explains its limits. The probe asserts broken behaviour. Convert it
into a colocated regression; do not make committed tests depend on workspace notes.

## Development Approach

1. Keep one shared in-flight attempt and cache successful configuration. On failure, release only that
   attempt's cache entry. A stale rejection must not clear a newer attempt installed after a reset.
2. Use a small request-driven retry cooldown with a documented bounded delay. While cooling down,
   fail promptly without another discovery request. The first request after the deadline starts one
   shared attempt. Do not add background retry timers, a retry library or a new configuration surface
   unless the existing configuration demonstrably requires one.
3. Keep the client's existing bounded network timeout. Reset failure/cooldown state after success;
   the test reset hook must reset all cache state. Use deterministic time control in cooldown tests.
4. Limit this retry policy to discovery. Do not automatically replay token exchange, refresh or API
   writes. Preserve issuer validation, transport restrictions, PKCE/state handling and subject checks.
5. Use test-first changes and complete each task before the next. Record a review base, preserve other
   agents' edits and use local task commits as appropriate. Publishing, merging and deployment are
   outside this plan. E01 may touch nearby authentication tests; reconcile changes before execution.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and available local Redis. Record actual counts, failures and skips,
including whether `src/session-store.test.ts` ran. Establish the baseline and distinguish pre-existing
failures from regressions. Inspect formatting diffs for unrelated changes.

For focused red/green checks, run `yarn vitest run src/auth/idam.test.ts`. Local discovery tests must
bind only to loopback and close their servers. They need no live IDAM credentials or external service.

## Implementation Steps

### Task 1: Recover without losing successful caching

**Files:** `src/auth/idam.ts` and `src/auth/idam.test.ts`.

- [ ] Trace the discovery callers and existing reset hook on the execution baseline. Add a failing
      local-HTTP test: first discovery returns 503, the endpoint becomes healthy, a later eligible
      `beginLogin` succeeds without resetting the module or restarting the process.
- [ ] Add coverage for a connection failure followed by recovery. Assert actual HTTP attempt counts
      and successful login URL construction rather than only mocked discovery invocation counts.
- [ ] Clear a rejected cache entry with an identity/generation check so only its owning attempt can
      change cache state. Preserve sharing while discovery is pending and caching after success.
- [ ] Cover multiple simultaneous initial callers and repeated successful calls: exactly one discovery
      operation serves each shared attempt; successful configuration does not trigger rediscovery.
- [ ] Run focused tests and all Validation Commands; record red/green evidence and results.

### Task 2: Bound retry pressure and protect cache replacement

**Files:** `src/auth/idam.ts` and `src/auth/idam.test.ts`.

- [ ] Add failing tests for many requests during an outage, callers at the cooldown boundary and
      repeated failed attempts. Use fake time or the repository's existing clock seam, not real sleeps.
- [ ] Implement the bounded request-driven cooldown. Document the chosen interval in code and execution
      notes; keep only the state needed for one shared attempt and the next permitted attempt.
- [ ] Verify requests inside the cooldown fail promptly with no HTTP request; concurrent callers after
      it expires share exactly one attempt. Verify recovery resets failure/cooldown state.
- [ ] Hold an old attempt, reset discovery and complete a newer successful attempt, then reject the old
      one. Assert the new configuration remains cached and no stale cooldown is installed.
- [ ] Verify the reset hook clears all state and restore fake timers/mocks in every test. Do not expand
      retries to token endpoints or alter existing transport and OIDC security checks.
- [ ] Run focused tests and all Validation Commands; record results.

### Task 3: Verify authentication integration and document recovery

**Files:** `src/auth/idam.test.ts`, existing authentication integration tests where needed,
`CLAUDE.md` or the existing authentication documentation, and this plan's Execution notes.

- [ ] Exercise the public authentication entry point through outage and recovery with a valid local
      discovery document. Retain tests for issuer/transport rejection, PKCE/state and subject checks.
- [ ] Confirm token exchange/refresh is not replayed by the discovery retry policy, successful discovery
      remains cached, and failure diagnostics do not expose tokens or credentials.
- [ ] Document recovery timing and the distinction between a transient discovery failure and a
      misconfigured issuer. Do not require a restart as the recovery path for transient failure.
- [ ] Record starting/final commits, changed files, actual request-count evidence, test counts and skips.
      Run all Validation Commands and hand off to the normal Ralphex review phases; record any review
      fixes and revalidation.

## Acceptance Criteria

- A transient 503 or network failure can recover on a later request without reset/restart.
- Concurrent callers share discovery; successful configuration remains cached.
- An outage cannot trigger an unbounded retry burst, and callers do not wait on background retry loops.
- Old failed attempts cannot replace or clear newer cache state.
- Existing OIDC validation and transport behaviour remain intact; token operations are not replayed.

## Execution notes

Planning only, 20 October 2026. Ellis authored this plan from review finding E02. No implementation,
new validation run or Ralphex execution has been performed for this plan. Append execution evidence here.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Publishing, merging and deployment are separate actions.
Move this plan to `docs/plans/completed/` only after implementation and review. Do not start Ralphex as
part of authoring this plan.
