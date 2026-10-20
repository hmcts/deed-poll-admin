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

- [x] Trace the discovery callers and existing reset hook on the execution baseline. Add a failing
      local-HTTP test: first discovery returns 503, the endpoint becomes healthy, a later eligible
      `beginLogin` succeeds without resetting the module or restarting the process.
- [x] Add coverage for a connection failure followed by recovery. Assert actual HTTP attempt counts
      and successful login URL construction rather than only mocked discovery invocation counts.
- [x] Clear a rejected cache entry with an identity/generation check so only its owning attempt can
      change cache state. Preserve sharing while discovery is pending and caching after success.
- [x] Cover multiple simultaneous initial callers and repeated successful calls: exactly one discovery
      operation serves each shared attempt; successful configuration does not trigger rediscovery.
- [x] Run focused tests and all Validation Commands; record red/green evidence and results.

### Task 2: Bound retry pressure and protect cache replacement

**Files:** `src/auth/idam.ts` and `src/auth/idam.test.ts`.

- [x] Add failing tests for many requests during an outage, callers at the cooldown boundary and
      repeated failed attempts. Use fake time or the repository's existing clock seam, not real sleeps.
- [x] Implement the bounded request-driven cooldown. Document the chosen interval in code and execution
      notes; keep only the state needed for one shared attempt and the next permitted attempt.
- [x] Verify requests inside the cooldown fail promptly with no HTTP request; concurrent callers after
      it expires share exactly one attempt. Verify recovery resets failure/cooldown state.
- [x] Hold an old attempt, reset discovery and complete a newer successful attempt, then reject the old
      one. Assert the new configuration remains cached and no stale cooldown is installed.
- [x] Verify the reset hook clears all state and restore fake timers/mocks in every test. Do not expand
      retries to token endpoints or alter existing transport and OIDC security checks.
- [x] Run focused tests and all Validation Commands; record results.

### Task 3: Verify authentication integration and document recovery

**Files:** `src/auth/idam.test.ts`, existing authentication integration tests where needed,
`CLAUDE.md` or the existing authentication documentation, and this plan's Execution notes.

- [x] Exercise the public authentication entry point through outage and recovery with a valid local
      discovery document. Retain tests for issuer/transport rejection, PKCE/state and subject checks.
- [x] Confirm token exchange/refresh is not replayed by the discovery retry policy, successful discovery
      remains cached, and failure diagnostics do not expose tokens or credentials.
- [x] Document recovery timing and the distinction between a transient discovery failure and a
      misconfigured issuer. Do not require a restart as the recovery path for transient failure.
- [x] Record starting/final commits, changed files, actual request-count evidence, test counts and skips.
      Run all Validation Commands and hand off to the normal Ralphex review phases; record any review
      fixes and revalidation.

## Acceptance Criteria

- A transient 503 or network failure can recover on a later request without reset/restart.
- Concurrent callers share discovery; successful configuration remains cached.
- An outage cannot trigger an unbounded retry burst, and callers do not wait on background retry loops.
- Old failed attempts cannot replace or clear newer cache state.
- Existing OIDC validation and transport behaviour remain intact; token operations are not replayed.

## Execution notes

Authored 20 October 2026 by Ellis from review finding E02, and implemented on
`fix/e02-idam-discovery-recovery` (Tasks 1–3 below). Execution evidence is appended here.

### Task 1 (20 October 2026)

- Execution branch `fix/e02-idam-discovery-recovery`, starting commit `2555fa382f00582b2f86dbc041f596c9819f94e2`.
  The finding reproduced there: `idamConfiguration` kept the first rejected `client.discovery` promise.
- Discovery callers: `beginLogin`, `completeLogin`, `refreshTokens`, `endSessionUrl` (all `src/auth/idam.ts`),
  `password-grant.ts` and `client-credentials.ts`. `resetIdamDiscovery` is test-only (`idam.test.ts`,
  `password-grant.test.ts`).
- Baseline (before changes): lint and build clean; app 107 files / 2241 tests; deed-poll 1204,
  api-client 778, cloud-native-platform 157, express-govuk-starter 127, simple-router 41,
  express-session-postgres 23, express-session-redis 7; no skips; `src/session-store.test.ts` ran (7 tests).
- Red: four new local-HTTP tests in `src/auth/idam.test.ts` ("discovery recovery"); three failed against the
  baseline (503 then recovery, connection reset then recovery, simultaneous failure then recovery). The
  simultaneous-success test passed already, as expected.
- Green: the attempt's own `.catch` clears `discovered` only when it still holds that attempt. Focused file
  47/47. Request counts asserted on the loopback server: 503 then two logins = 2 requests; connection reset then
  one login = 2; three simultaneous logins plus a later one = 1; two simultaneous failed logins plus a recovery = 2.
- Full validation after: lint and build clean; app 107 files / 2245 tests (+4); other packages unchanged; no
  skips; `src/session-store.test.ts` ran (7 tests).

### Task 2 (20 October 2026)

- Starting commit `d91d5d7`. Cooldown `DISCOVERY_RETRY_COOLDOWN_MS = 5_000` in `src/auth/idam.ts`: a failure of the
  attempt that owns the cache sets `retryNotBefore = now + 5s`; a caller with no cached attempt before then is refused
  at once ("IDAM discovery failed recently…") with no HTTP request; the first caller at or after the deadline clears it
  and starts one shared attempt. Interval chosen so a login seconds after IDAM recovers succeeds while an outage under
  load costs at most one discovery request per 5 seconds. No timers, retry library or configuration added; token
  exchange, refresh and transport/issuer checks are untouched (only `idamConfiguration` changed).
- State is just `discovered` and `retryNotBefore`; `resetIdamDiscovery` clears both.
- Tests use `vi.useFakeTimers({ toFake: ["Date"] })` with `vi.setSystemTime`, restored in `afterEach`; no sleeps.
  The four Task 1 recovery tests now advance the clock past the cooldown before recovering.
- Red: six new tests; two failed before the change (20 logins inside the cooldown made 20 more requests; repeated
  failures not spaced). The boundary, recovery, stale-attempt and reset tests passed already against Task 1's
  identity check and pin it against the cooldown change.
- Request counts asserted: failure + 20 logins at deadline−1ms = 1 request, all refused; failure + three callers at
  the deadline = 2 (one shared); three failures at 0, 5s, (refused at 10s−1ms), 10s = 3; failure, recovery at 5s, login
  at 5s+1ms = 2; stale held 503 after reset and a newer success, then a later login = 2 (no stale clear or cooldown);
  failure then reset then login = 2.
- Green: focused `idam`, `password-grant`, `client-credentials` 67/67. Full validation: lint clean (one pre-existing
  biome schema-version info), build clean; app 107 files / 2251 tests (+6); deed-poll 1204, api-client 778,
  cloud-native-platform 157, express-govuk-starter 127, simple-router 41, express-session-postgres 23,
  express-session-redis 7; no skips; `src/session-store.test.ts` ran (7 tests).

### Task 3 (20 October 2026)

- Starting commit `3fd6538`. Changed files: `src/auth/idam.test.ts`, `CLAUDE.md` ("Deployment and sessions"), this
  plan. No production code changed in this task; `src/auth/idam.ts` is as Task 2 left it.
- Five new tests in "discovery recovery", using the loopback discovery server and fake `Date`. Their request counts:
  `completeLogin` failing, refused inside the cooldown, then succeeding = 2 discovery requests and exactly one
  `authorizationCodeGrant`. `refreshTokens` doing the same = 2 requests and exactly one `refreshTokenGrant`; it throws
  (kept as transient by `refresh-middleware.ts`) rather than returning a refusal. Login, callback, refresh and
  end-session after one recovery = 2 requests in total, so the recovered configuration is cached. A wrong-issuer
  document is never cached: "discovered metadata issuer does not match the expected issuer", retried once per
  interval = 2 requests. `describeIdamError` of a discovery failure and of the cooldown refusal contains neither the
  client secret nor the refresh token, and no token grant was sent.
- These tests pass against Task 2's code without change: they pin integration rather than drive new behaviour. The
  existing tests for cleartext-issuer refusal, PKCE/state and subject mismatch all still pass, unchanged.
- Documented in `CLAUDE.md`: recovery within about 5 s of IDAM recovering, no restart needed, and how a misconfigured
  issuer differs (it repeats once per interval forever and is fixed in `IDAM_ISSUER_URL` or the chart).
- Full validation: lint clean (the one pre-existing Biome schema-version info), build clean; app 107 files / 2256
  tests (+5); deed-poll 1204, api-client 778, cloud-native-platform 157, express-govuk-starter 127, simple-router 41,
  express-session-postgres 23, express-session-redis 7; no skips; `src/session-store.test.ts` ran (7 tests).
- Ralphex review phases follow this task. Review fixes and revalidation are recorded below when they happen.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Publishing, merging and deployment are separate actions.
Move this plan to `docs/plans/completed/` only after implementation and review. Do not start Ralphex as
part of authoring this plan.
