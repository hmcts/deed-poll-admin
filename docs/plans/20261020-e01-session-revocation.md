# Plan: prevent stale requests from restoring revoked sessions

## Overview

Address review finding **E01 (High)**: a request waiting for token refresh can save its authenticated
session snapshot after another request logs out, recreating the deleted session. Make revocation
authoritative over subsequent writes and prevent concurrent refreshes from replacing newer tokens
with older ones. The guarantee must hold across application instances sharing Redis.

This plan covers session persistence and refresh coordination. It does not change the API's authority
over case data or permissions.

## Context

Reviewed baseline: `649c30e01870abe2b57be43d6c17a02fbfffad72` on admin `origin/master`.
Read `CLAUDE.md` and applicable `.claude/rules/` before implementation. Record the execution branch's
actual starting commit and recheck the finding there. The checkout used to author these plans is on
`fix/api-transport-tls`; do not implement against that older branch or switch another agent's checkout.
Use an isolated feature worktree based on the intended current integration branch.

At the reviewed baseline, `src/auth/session.ts` saves a request snapshot in `updateTokens`, while
`signOut` destroys the stored session. `touchLastSeen`, access updates and Express's own saves are
additional writers. The refresh middleware waits for IDAM and `/me` before saving.

The review reproduced resurrection with real Express sessions and `MemoryStore`. Inspection found
unconditional `SET` in the installed Redis store, but no live Redis race was run. Do not claim a
demonstrated production exploit or assume IDAM revocation semantics.

Optional historical evidence is in workspace
`local-notes/deed-poll-admin/20261020-ellis-quality-security-review.md` and its adjacent
`20261020-ellis-review-evidence/` directory. Those probes assert the defect. Adapt their barriers and
invert the expectations into portable regression tests; do not import workspace notes into tests.

## Development Approach

1. Enforce the invariant at the persistence boundary. An authenticated update must atomically verify
   that its session incarnation is still live and that it cannot overwrite a newer revision. A missing
   or revoked session is not permission to create it. Distinguish explicit fresh/regenerated session
   creation from updates; preserve the anonymous OIDC login flow.
2. Prefer an app-owned store/coordinator using the existing Redis client and session integration seam.
   Keep changes to template libraries limited to a demonstrated missing seam. No new database,
   framework, dependency or process-local-only protection.
3. Coordinate refresh across instances, with a bounded wait and ownership/fencing that prevents an
   expired lease holder from publishing. Re-read authoritative session state after obtaining ownership;
   waiting requests consume the winner's current state instead of refreshing an old token. A lost lease
   or uncertain token-rotation outcome must fail closed, not blindly retry a potentially consumed token.
4. Protect every authenticated persistence path, including activity, access refresh, explicit saves,
   automatic end-of-response saves, touch, destruction and regeneration. Reload-then-save is not atomic.
   A lock around only `updateTokens` does not address the other writers.
5. Preserve idle/absolute lifetime rules, cookie settings, session-ID rotation, `/me` authority, persona
   switching and existing logout routing. A stale request must not continue authenticated using its
   discarded in-memory snapshot after persistence is refused. Do not log session IDs, tokens or user data.
6. Keep Redis operations bounded and document their atomicity and TTL rules. Missing/expired sessions
   must stay dead even after coordination keys expire. Never fall back to an unguarded write on errors.
   Define a safe legacy-session and mixed-version rollout policy before claiming the invariant.
7. Work test first, complete each task before the next, and preserve other agents' changes. Record the
   starting commit for review. Local task commits are appropriate during implementation; publication,
   merging, deployment and live-account testing are outside this plan.

## Validation Commands

Run from the admin repository root before implementation and after each completed task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed Yarn dependencies. Ensure local Redis is available; the Redis regression suite is a
required gate, not an optional skipped check. Use a unique test key prefix and remove only keys owned
by the test; never flush a shared database. Record failures, skips and test counts. Separate existing
baseline failures from regressions and inspect formatting diffs for unrelated edits.

Use focused `yarn vitest run` commands during red/green cycles. Also run `yarn test:session` once the
implementation is integrated, following its documented local Redis/mock/IDAM prerequisites. Record any
unavailable browser prerequisites as an outstanding validation item, not a passing check.

## Implementation Steps

### Task 1: Pin the race and enforce guarded session persistence

**Files:** `src/auth/session.ts`, `src/auth/session.test.ts`,
`src/auth/session-lifetime-refresh.test.ts`, `src/session-store.test.ts`, `src/app.ts`;
create an app-owned store module and colocated tests under `src/auth/` (outside `src/pages`).
Read `src/auth/refresh-middleware.ts`, `src/auth/session-lifetime.ts` and
`libs/express-session-redis/src/index.ts`. Modify the library seam only if the existing configuration
cannot support the guard. Record the resulting design in this plan's Execution notes.

- [ ] Inventory all session creation, save, touch, destroy and regeneration paths, including automatic
      Express behaviour. Trace how loaded session objects reach the configured store.
- [ ] Add a deterministic real Express regression: sign in, hold a refresh before persistence, log out
      through another request, verify the original cookie is anonymous, release the refresh and verify
      that cookie remains anonymous. Show the new expectation fails on the execution baseline.
- [ ] Specify the concrete Redis record/revision and creation protocol, atomic operations, refresh
      ownership/fencing, TTL bounds and stale-write error handling. Explain how automatic saves carry
      the expected revision without trusting browser-supplied metadata.
- [ ] Resolve legacy records and rolling upgrades in that design: old application instances can still
      perform unguarded writes. Document the required rollout boundary and fail-closed handling of old
      records; do not claim mixed-version safety unless it is implemented and tested.
- [ ] Add contract tests for fresh login, regeneration, missing/revoked update refusal and stale revision
      refusal. Record the red evidence before implementing the guard.
- [ ] Implement the documented atomic creation/update/revocation protocol using existing Redis tooling.
      Wire it into the app and session lifecycle. Ensure an update of a missing or expired session
      cannot create a record.
- [ ] Make destroy/revoke win over a stale save in either ordering. Protect touch and automatic saves as
      well as explicit writes; never permit a stale whole-session snapshot to roll back tokens or access.
- [ ] Bound session and coordination TTLs consistently with existing idle/absolute limits. Test expiration
      followed by a delayed write, metadata expiry and regeneration of a different session ID.
- [ ] Exercise real Redis with two separately constructed store instances. Test both race orderings with
      barriers and assert stored state and subsequent authentication, not just mock method calls.
- [ ] Run focused tests and all Validation Commands. The delayed-save/logout regression and new store
      contract tests must be green before completing this task.

### Task 2: Coordinate refreshes and reject stale request state

**Files:** `src/auth/refresh-middleware.ts`, `src/auth/session.ts`, their colocated tests,
`src/auth/session-lifetime-refresh.test.ts` and the persistence module from Task 1.

- [ ] Add failing tests for simultaneous refreshes from two app instances, a delayed refresh after logout,
      and a refresh whose coordination lease expires before it publishes.
- [ ] Obtain bounded per-session refresh ownership, re-read current session state, and skip redundant
      refresh when another request has already installed suitable tokens and access.
- [ ] Publish tokens and the associated `/me` answer together under the persistence guard. Waiting
      requests must observe that state without reusing their stale token/access snapshot.
- [ ] Ensure losing/revoked requests cannot proceed down the authenticated middleware chain. Preserve
      the existing distinction between authentication failure and dependency failure where safe.
- [ ] Cover IDAM failure, `/me` failure, Redis failure, lost ownership and aborted requests. Release only
      an owned lease, bound waits, and never blindly replay a refresh with an uncertain rotation outcome.
- [ ] Run focused tests and all Validation Commands; the original logout regression must now be green.

### Task 3: Close other writers and verify application lifecycle

**Files:** `src/auth/session.ts`, `src/auth/session-lifetime.ts`, their tests, `src/session-store.test.ts`,
`src/app.test.ts` and existing login/logout/persona tests where the lifecycle is exercised.

- [ ] Reconcile activity and access updates with revision conflicts without copying stale authentication
      fields back over the winner. Verify timeout restart, sign-in regeneration and persona changes.
- [ ] Test logout racing with activity saves, access updates and Express's automatic response save.
      Include a non-refresh request loaded before logout and completed afterward.
- [ ] Run the complete race suite with real Redis and two app instances sharing the store namespace.
      Assert no old-session resurrection, no stale token overwrite, no post-expiry revival and successful
      fresh login with a new session ID.
- [ ] Verify idle and absolute deadlines, cookie flags and existing security event names remain correct.
      Check failures emit useful bounded diagnostics without session IDs or token contents.
- [ ] Run all Validation Commands and the local session browser suite; record actual results and limits.

### Task 4: Document and review the guarantee

**Files:** `CLAUDE.md`, the existing session/deployment documentation appropriate to the final design,
and this plan's Execution notes.

- [ ] Document the atomic session-write contract, refresh ownership, stale-write handling and the rule
      every future authenticated writer must follow. Include TTL, legacy-record and rollback behaviour.
- [ ] Record the required rollout procedure for eliminating unguarded old writers. Do not deploy or
      invalidate live sessions while executing this plan.
- [ ] Record starting/final commits, changed files, red/green evidence, real Redis topology, browser
      results, counts and skips. Distinguish local persistence guarantees from IDAM token revocation.
- [ ] Run all Validation Commands and leave the change ready for Ralphex review phases. Record review
      findings and revalidate any code fixes before declaring implementation complete.

## Acceptance Criteria

- Once logout/revocation succeeds, the old cookie stays unauthenticated after every delayed writer.
- Concurrent requests cannot replace newer tokens/access with an older session snapshot.
- The invariant is proven against real Redis across two app instances, including automatic saves.
- Fresh login, session regeneration, activity tracking and lifetime enforcement still work.
- Redis/coordination failures fail closed and remain bounded; no credentials enter diagnostics.
- Legacy-session and mixed-version rollout limits are explicitly documented and tested where supported.

## Execution notes

Planning only, 20 October 2026. Ellis authored this plan from review finding E01. No implementation,
new validation run or Ralphex execution has been performed for this plan. Append execution evidence here.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Deployment and any live session migration/invalidation
are separate actions. Move this plan to `docs/plans/completed/` only after implementation and review.
Do not start Ralphex as part of authoring this plan.
