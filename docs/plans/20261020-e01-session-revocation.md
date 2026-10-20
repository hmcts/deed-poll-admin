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

- [x] Inventory all session creation, save, touch, destroy and regeneration paths, including automatic
      Express behaviour. Trace how loaded session objects reach the configured store.
- [x] Add a deterministic real Express regression: sign in, hold a refresh before persistence, log out
      through another request, verify the original cookie is anonymous, release the refresh and verify
      that cookie remains anonymous. Show the new expectation fails on the execution baseline.
- [x] Specify the concrete Redis record/revision and creation protocol, atomic operations, refresh
      ownership/fencing, TTL bounds and stale-write error handling. Explain how automatic saves carry
      the expected revision without trusting browser-supplied metadata.
- [x] Resolve legacy records and rolling upgrades in that design: old application instances can still
      perform unguarded writes. Document the required rollout boundary and fail-closed handling of old
      records; do not claim mixed-version safety unless it is implemented and tested.
- [x] Add contract tests for fresh login, regeneration, missing/revoked update refusal and stale revision
      refusal. Record the red evidence before implementing the guard.
- [x] Implement the documented atomic creation/update/revocation protocol using existing Redis tooling.
      Wire it into the app and session lifecycle. Ensure an update of a missing or expired session
      cannot create a record.
- [x] Make destroy/revoke win over a stale save in either ordering. Protect touch and automatic saves as
      well as explicit writes; never permit a stale whole-session snapshot to roll back tokens or access.
- [x] Bound session and coordination TTLs consistently with existing idle/absolute limits. Test expiration
      followed by a delayed write, metadata expiry and regeneration of a different session ID.
- [x] Exercise real Redis with two separately constructed store instances. Test both race orderings with
      barriers and assert stored state and subsequent authentication, not just mock method calls.
- [x] Run focused tests and all Validation Commands. The delayed-save/logout regression and new store
      contract tests must be green before completing this task.

### Task 2: Coordinate refreshes and reject stale request state

**Files:** `src/auth/refresh-middleware.ts`, `src/auth/session.ts`, their colocated tests,
`src/auth/session-lifetime-refresh.test.ts` and the persistence module from Task 1.

- [x] Add failing tests for simultaneous refreshes from two app instances, a delayed refresh after logout,
      and a refresh whose coordination lease expires before it publishes.
- [x] Obtain bounded per-session refresh ownership, re-read current session state, and skip redundant
      refresh when another request has already installed suitable tokens and access.
- [x] Publish tokens and the associated `/me` answer together under the persistence guard. Waiting
      requests must observe that state without reusing their stale token/access snapshot.
- [x] Ensure losing/revoked requests cannot proceed down the authenticated middleware chain. Preserve
      the existing distinction between authentication failure and dependency failure where safe.
- [x] Cover IDAM failure, `/me` failure, Redis failure, lost ownership and aborted requests. Release only
      an owned lease, bound waits, and never blindly replay a refresh with an uncertain rotation outcome.
- [x] Run focused tests and all Validation Commands; the original logout regression must now be green.

### Task 3: Close other writers and verify application lifecycle

**Files:** `src/auth/session.ts`, `src/auth/session-lifetime.ts`, their tests, `src/session-store.test.ts`,
`src/app.test.ts` and existing login/logout/persona tests where the lifecycle is exercised.

- [x] Reconcile activity and access updates with revision conflicts without copying stale authentication
      fields back over the winner. Verify timeout restart, sign-in regeneration and persona changes.
- [x] Test logout racing with activity saves, access updates and Express's automatic response save.
      Include a non-refresh request loaded before logout and completed afterward.
- [x] Run the complete race suite with real Redis and two app instances sharing the store namespace.
      Assert no old-session resurrection, no stale token overwrite, no post-expiry revival and successful
      fresh login with a new session ID.
- [x] Verify idle and absolute deadlines, cookie flags and existing security event names remain correct.
      Check failures emit useful bounded diagnostics without session IDs or token contents.
- [x] Run all Validation Commands and the local session browser suite; record actual results and limits.

### Task 4: Document and review the guarantee

**Files:** `CLAUDE.md`, the existing session/deployment documentation appropriate to the final design,
and this plan's Execution notes.

- [x] Document the atomic session-write contract, refresh ownership, stale-write handling and the rule
      every future authenticated writer must follow. Include TTL, legacy-record and rollback behaviour.
- [x] Record the required rollout procedure for eliminating unguarded old writers. Do not deploy or
      invalidate live sessions while executing this plan.
- [x] Record starting/final commits, changed files, red/green evidence, real Redis topology, browser
      results, counts and skips. Distinguish local persistence guarantees from IDAM token revocation.
- [x] Run all Validation Commands and leave the change ready for Ralphex review phases. Record review
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

### Task 1 — guarded session persistence (20 October 2026)

Starting commit `f61aa0b` on `fix/e01-session-revocation` (plan commit on top of `6c5f92b`, master after #198).
Baseline Validation Commands, with `REDIS_URL=redis://127.0.0.1:6379` (local Redis, database 0): lint and build
green, 4,570 tests passed across eight tasks (app 2,241), no failures and no skipped Redis suites.

**Writer inventory.** express-session 1.19.0 reaches the store through: `store.get` when a request's cookie names
a session, and through `Session#reload` (`storeAccess`); `store.set` from `Session#save` (`signIn`, `touchLastSeen`,
`storeAccess`, `updateTokens`, `restartAfterTimeout`, `pages/login.ts`) and from the end-of-response autosave in
`res.end` whenever the session's hash changed or a regenerated id was never saved (`takeFlow`, any direct
mutation); `store.touch` at the end of every response for a loaded session that was not saved; `store.destroy` from
`Session#destroy` (`signOut`) and from `Store#regenerate` (`signIn`, `restartAfterTimeout`). `store.set` receives
`req.session` itself, which `store.createSession` built from the object `store.get` returned. connect-redis 9.0.0
writes with an unconditional `SET … EX` and touches with `EXPIRE`, so any loaded snapshot could recreate a
deleted key.

**Design.** `src/auth/guarded-session-store.ts` (`GuardedSessionStore`, an express-session `Store`) replaces
connect-redis, passed as `sessionOptions.store` through the unchanged `expressSessionRedis` seam, whose spread
already lets it override the library's store. Records are Redis hashes `{ inc, rev, sess }`: `inc` a random UUID
minted at creation (the incarnation), `rev` a counter, `sess` the JSON session. All operations are single Lua
scripts, which Redis executes atomically:

- read: `HMGET inc rev sess`; a missing or malformed record (bad `rev`, unparsable `sess`, no `cookie`) is no
  session, with a warning that names no id. The `{ inc, rev }` read is kept in a per-store `WeakMap` keyed on the
  returned object, and `createSession` moves it onto the `Session` it builds. The browser supplies only the id;
  the version never leaves the server and is not in the session's JSON, so express-session's change hash is
  unaffected.
- create (a session with no recorded version — generated by express-session, never stored): refused unless the
  key does not exist; writes `rev 1` and `EXPIRE ttl`.
- update (a session with a recorded version): refused `missing` if the key is gone, `conflict` if `inc` or `rev`
  differ; otherwise `HINCRBY rev`, `HSET sess`, `EXPIRE ttl`, and the new rev is recorded on the same object so
  that request's later saves (including the autosave after an explicit save) still match.
- touch: `EXPIRE` only if `inc` matches; `EXPIRE` never creates a key.
- destroy: `DEL`, unconditional, so it wins in either order — a stale write before it is deleted, a stale write
  after it finds no key.

A refusal fails the callback with `SessionWriteRefusedError` (`reason` `missing | conflict | exists`, message without
the id), so explicit saves reject and an autosave error goes to Express's error handling. There is no fallback to an
unguarded write anywhere, and no tombstone: a missing key cannot be updated, and only a fresh generated id can be
created. `rev` and data share one key and one TTL, so no metadata can expire separately. TTL is still
`sessionStoreTtl` (signed-in: absolute deadline + 900 s; anonymous: 600 s; never below 1 s). Every store command runs
on `redisConnection.withCommandOptions({ timeout: 2_000 })`; a timed-out write is never retried, and its session
object can no longer match the stored version, so nothing is written blind.

**Legacy records and rollout.** The keyspace moved from `admin-sess:` to `admin-sess-v2:`. Old connect-redis string
records are never read by the new store (users sign in once more), and they expire on their existing TTL (at most
the absolute limit plus 15 minutes). An instance still on the old store reads and writes only `admin-sess:`, so it
cannot read, rewrite or resurrect a guarded record, and a guarded instance never sees its records: crossing versions
during a rolling deploy signs the user out, never in. The invariant therefore holds for every `admin-sess-v2:`
session from the first new pod; old pods keep the E01 defect for their own old-keyspace sessions until they are gone.
Both directions are tested with a connect-redis instance beside a guarded one. Rollback to an old image returns
everyone to the old keyspace (another sign-in) and to the old defect.

**Not yet addressed (Tasks 2 and 3).** Refreshes are not coordinated: a refresh whose save is refused (`conflict`
after another request wrote, or `missing` after logout) now rejects and the request gets the 500 page rather than
continuing; a rotated refresh token from such a refresh is lost. `touchLastSeen`/`storeAccess` conflicts likewise
reject rather than reconcile. Both fail closed; Task 2 adds ownership and Task 3 reconciliation.

**Red evidence.** The new real-Express regression (sign in; hold `/slow-refresh` before `updateTokens`; log out from
another request; the cookie is anonymous; release; the cookie must stay anonymous) failed on the baseline wiring
(connect-redis on real Redis): the last assertion received `true` — resurrected. The full new suite run with
connect-redis's `RedisStore` in place of the guarded store: 16 failed, 8 passed of 24 — every race (held refresh
after logout, autosave after logout, activity save after logout, older snapshot over newer tokens, write after
expiry, write after regeneration) and the contract refusals failed; the 8 that passed are behaviours connect-redis
already had (touch on a missing key, TTL bounds, refresh-then-logout ordering, fresh login, anonymous flow, keyspace
isolation).

**Green evidence.** `src/auth/guarded-session-store.test.ts`, 24 tests on real Redis with two app instances, each
with its own client and store sharing one per-run prefix (`test-e01-<uuid>:`, removed by `SCAN MATCH` afterwards,
never flushed). `src/session-store.test.ts` now drives the guarded store under the app's prefix and deletes the ids
it wrote. Both suites skip only when `REDIS_URL` is unset and Redis is unreachable; with `REDIS_URL` set an
unreachable Redis fails them. Validation Commands after Task 1: lint and build green, 4,595 tests passed across
eight tasks (app 2,266), none skipped. `yarn test:session` not run in this task (planned for Task 3).

### Task 2 — refresh coordination (20 October 2026)

Starting commit `56124ad` (Task 1). **Design.** The refresh lease lives in the session's own hash (`lease`, `leaseUntil`),
so `DEL` on logout removes it with the session and no coordination key can outlive, or resurrect, a session. Its
deadline is Redis's `TIME`, not a pod clock. Three new Lua scripts in `src/auth/guarded-session-store.ts`:

- `CLAIM`: `missing` if the key is gone, `conflict` for another incarnation, `busy` while an unexpired lease is held,
  otherwise writes a fresh UUID lease for `refreshLeaseMs` (default 45 s, raised to 60 s in Task 4).
  `claimRefresh` polls every 100 ms up to `refreshWaitMs` (default 10 s). Taking a lease moves no revision.
- `PUBLISH`: the update script plus a lease check, made **before** the revision check so a lost lease (`lease`) is never
  mistaken for a retryable `conflict`; on success it writes the session and deletes the lease in one step.
- `RELEASE`: deletes the lease only if it is still the caller's.

`attachRefreshLease` marks the session object (beside its version in the `WeakMap`) so its next save is a `PUBLISH`.
`src/auth/session.ts` adds `claimRefresh` (claim, then `req.session.reload` so the decision is made from the stored
state), `publishRefresh` (tokens and `/me` answer in one save under the lease; on `conflict` it reloads and re-applies
the **same** tokens, up to three attempts, so a concurrent activity write is kept and IDAM is never asked again) and
`releaseRefresh` (errors logged by name only and swallowed; the lease expires anyway). A store without these methods
makes the refresh throw rather than refresh unguarded. `refreshMiddleware` now: snapshot checks as before (no refresh
token, no subject); claim; `missing` → signed out with a redirect to `/login`, no event (the logout already emitted
one); `busy` → continue on a still-valid token, else fail the request without signing out; `acquired` → re-check
the reloaded session (a waiter normally finds the winner's tokens and continues refreshing nothing), then the existing
IDAM/`/me` branches, then publish; `missing` on publish → signed out; `lease` or any other refusal → the request
fails (500), never retried. The lease is released in `finally` on every path.

The store also stopped writing saves that change nothing but the cookie: express-session moves `cookie.expires` on
every response but excludes the cookie from its own change hash, so a waiter's reload otherwise made its autosave a
write that bumped `rev` and could refuse a concurrent writer. Such a save now only renews the TTL (`KEEP`, which still
refuses a gone key or another incarnation).

**Red evidence.** `src/auth/refresh-coordination.test.ts` (11 tests: two app instances, real Redis, real
`refreshMiddleware`, IDAM held at a barrier) against the Task 1 sources: 8 failed — double IDAM call and an extra
revision on concurrent refresh, a 500 rather than a clean signed-out redirect after logout, no bounded wait, a
concurrent write losing the refresh, no single `/me`+tokens write, a 500 after an IDAM failure, and Redis failure on
claim not failing closed. The 3 that passed already held for other reasons (lease takeover ended in a conflict 500,
IDAM refusal signs out, an abandoned browser's refresh still saved).

**Green evidence.** Coordination suite 11/11; store contract suite now 33 (lease grant/busy/expiry/takeover,
publish refusal after expiry with and without takeover, release of only one's own lease, destroy removes the lease,
another incarnation is a conflict, cookie-only save moves no revision); `refresh-middleware.test.ts` gains 11 unit
tests for the claim outcomes, the reload-before-decide rule, the publish retry and fail-closed paths. Both Redis
suites were run five times consecutively without a failure. Validation Commands with `REDIS_URL=redis://127.0.0.1:6379`
(Redis 8.10.1): lint green (one pre-existing Biome schema-version info), build green, 4,626 tests passed across eight
tasks (app 2,297), none skipped. Aborted requests: Node keeps running the middleware after the client goes, so the
refresh still publishes and frees the lease (tested). `yarn test:session` is still scheduled for Task 3.

**Limits.** Reload-then-save in `storeAccess` and `touchLastSeen` conflicts still reject rather than reconcile (Task 3).
A lost lease or a lease expiring mid-refresh can leave the session holding a refresh token IDAM may already have
rotated; the next refresh is then refused and signs the user out, which is the intended fail-closed outcome. Both
lease scripts touch one key, so they work on a clustered Redis as well, though the deployed cache is not clustered.

### Task 3 — the other writers and the lifecycle (20 October 2026)

Starting commit `5af6118` (Task 2). **Design.** `src/auth/session.ts` gains one write path for every authenticated
writer that is not a sign-in: `saveReconciled(req, change)` applies a change, saves, and on `conflict` reloads and
applies the same change to what the store now holds, at most three attempts (`RECONCILE_ATTEMPTS`, formerly the
publish's own `PUBLISH_ATTEMPTS`). The change is re-derived from the re-read session each time, so nothing from the
request's snapshot is copied back:

- `touchLastSeen` moves only `lastSeenAt`, to `max(stored, now)` so a re-read can never move the clock back, and
  writes nothing if the re-read session is no longer signed in. The request then goes on with the winner's tokens.
- `storeAccess` reloads first (as before), writes the user only if the re-read holds no `/me` answer, and on a
  conflict reads again rather than failing: reload-then-save is not atomic, the store's revision check is what
  catches the gap.
- `publishRefresh` now uses the same loop, re-attaching the lease on each attempt.

A session that has gone is now one typed outcome everywhere. `express-session` 1.19's `reload` reports a session the
store no longer holds only as `Error("failed to load session")`; the private `reload` maps exactly that message to
`SessionWriteRefusedError("missing")`, and `isSessionGone(error)` is the test callers use. `src/auth/ended-elsewhere.ts`
(moved out of `refresh-middleware.ts`) destroys the request's session — a no-op `DEL` that also leaves
`express-session` nothing to autosave or touch — and redirects to `/login?returnTo=…`, emitting no event because
whatever ended the session already did. It is used by `sessionLifetime` (activity save), the `/me` backfill in
`refreshMiddleware`, and the refresh claim's reload; the keep-alive page answers 401 instead, as for any signed-out
request. Any other refusal or store failure still fails the request: nothing falls back to an unguarded write.

Unchanged and re-verified: `signIn` and `restartAfterTimeout` regenerate (destroy the old key, create a fresh id
through the store's create-only path), so sign-in, persona switch and timeout restart all leave the old id dead;
`authenticatedAt` is written only by `signIn`; the cookie flags in `src/app.ts` (`app.test.ts` still pins them);
security event names (`auth.session.ended` with `idle` on a timeout; nothing on an ended-elsewhere path). The new log
line names no session id, subject or token, which the lifecycle suite asserts over everything logged in its races.
Express's autosave of a changed session after logout is refused by the store and goes to Express's error handling;
its touch of an unchanged one is refused by the incarnation check. `updateTokens` (revision-guarded, no lease) now has
no production caller and is kept for the store suite's stale-snapshot races.

**Red evidence.** New `src/auth/session-lifecycle.test.ts` (11 tests: two app instances, own clients and stores, one
per-run prefix, real `sessionLifetime` → `requireAuth` → `refreshMiddleware`, holds after session load, inside a page
and inside the `/me` call) against the Task 2 sources: 6 failed — an activity save after logout, after expiry and
after a sign-in replaced the id each gave a 500 rather than a signed-out redirect, keep-alive after logout a 500
rather than 401, a backfill after logout a 500, and an activity save conflicting with another instance's refresh a
500 rather than reconciling. The 5 that passed were already held by the store (autosave and touch after logout, the
backfill's reload keeping newer tokens, timeout restart, fresh login after logout) — none resurrected a session.

**Green evidence.** Lifecycle suite 11/11; 25 new unit tests in `session.test.ts` (reconcile, clock never backwards,
bounded attempts, no write for a signed-out re-read, gone before and after the conflict, backfill retry),
`session-lifetime.test.ts`, `keep-alive.test.ts` and `refresh-middleware.test.ts`. The four Redis suites (lifecycle,
coordination, store contract, `session-store.test.ts`: 62 tests) passed five consecutive runs. Validation Commands
with `REDIS_URL=redis://127.0.0.1:6379` (local Redis 8, database 0): lint green (the pre-existing Biome schema info),
build green, 4,651 tests passed across eight tasks (app 2,322), none skipped. `yarn test:session` (Redis database 2,
local IDAM simulator on 5556 started from the existing `deed-poll-idam` container and seeded with `yarn idam:users`,
stopped again afterwards): 2 passed in 9.5 minutes — warning, keep-alive extension and timeout with JavaScript, and
the server-side timeout without it.

**Limits.** An autosave refused after logout reaches Express's error handling once headers are written, so that
response may be cut short; the request was already rendering for a session that has since ended, and nothing is
stored. Three consecutive conflicts still fail the request (500) rather than retry without bound.

### Task 4 — documentation and review (20 October 2026)

Starting commit `2d13bcc` (Task 3); the final commit is the Task 4 commit directly on top of it, which also records
this note. Branch `fix/e01-session-revocation`, from master `6c5f92b` (after #198), plan commit `f61aa0b`.

**Documentation.** `CLAUDE.md` gains "Session writes": the record shape and atomic scripts, create-only creation,
`saveReconciled` as the one write path for every future authenticated writer and the rule that its change is
re-derived from the re-read session, `isSessionGone`/`endedElsewhere`, refresh lease ownership and fencing, TTL,
legacy keyspace, rollback, the Redis suites as a gate, and the limit that this is not IDAM token revocation.
`docs/DEPLOYMENT.md` gains "Session writes and rollout" (the one-off sign-out, mixed-version direction, the procedure:
ordinary rolling deploy, confirm no previous-ReplicaSet pod serves before treating E01 as closed, no manual key
deletion on the Redis shared with `deed-poll-web`, rollback, failure modes) and the `redis-url` row names
`admin-sess-v2:`. `docs/ARCHITECTURE.md`'s session store section was stale on both the prefix and the cookie lifetime
(it said 24 hours; it is the absolute limit) and is corrected. Nothing was deployed and no live session was touched.

**Review.** A read-only code review of `6c5f92b..2d13bcc -- src` found no defect in the guarantee (scripts,
version tracking through `createSession`/`regenerate`, `saveReconciled`, the middleware's paths, logging) and two
low-severity availability findings, both fixed:

1. The 45 s lease was shorter than the worst refresh it covers — openid-client's default 30 s token call, api's 10 s
   `/me` and up to six 2 s Redis commands, about 52 s — so a slow refresh could lose its lease and a second request
   could refresh the same token concurrently. Default raised to 60 s, with the budget stated at the constant.
2. A claim whose reply was lost to the command timeout after Redis had granted it left a lease nobody could release,
   making every request on the session wait 10 s and report `busy` until it expired. `claimRefresh` now releases the
   lease id it generated (owner-checked, errors swallowed) before rethrowing. New store test: red without the release
   (the lease survived), green with it.

**Validation.** Before the fixes, and again after them, with `REDIS_URL=redis://127.0.0.1:6379` (local Redis 8,
database 0, one per-run prefix per suite, never flushed): lint green (the pre-existing Biome schema-version info),
build green; tests 4,651 before the fixes and 4,652 after across eight tasks (app 2,322, then 2,323), no failures, none
skipped. The six session suites (196 tests) passed after the fixes. `yarn test:session` was run in Task 3 (2 passed);
the Task 4 fixes change only the lease length and a failure path its browser journeys do not reach, so it was not
re-run.

**What is guaranteed, and what is not.** Locally guaranteed and tested on real Redis across two app instances: once a
session key is deleted (logout, timeout, regeneration) or expired, no delayed writer recreates it; no older snapshot
overwrites newer tokens or access; one refresh per session at a time, fenced. Not guaranteed by this change: IDAM-side
revocation of tokens already issued, sessions on pods still running the old image (old keyspace) during a rollout, and
Jenkins coverage — no pipeline stage provides Redis, so the Redis suites run where `REDIS_URL` is set.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Deployment and any live session migration/invalidation
are separate actions. Move this plan to `docs/plans/completed/` only after implementation and review.
Do not start Ralphex as part of authoring this plan.
