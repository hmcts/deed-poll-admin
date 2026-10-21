# Plan: a persona switch cannot outlive its logout, and expired sessions are not refreshed

## Overview

Address review findings **R05 (Lower)** and **R06 (Lower)** from the repeat quality and security review (workspace
`local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`). Both are edges of the session lifecycle that
E01 and R04 left:

- **R05:** a persona switch (a POST that waits on IDAM's password grant) that is still in flight when the same session
  is logged out on another instance finishes by signing the browser back in, as the persona. `signIn` regenerates the
  session without checking that the session it replaces still exists, so the logout's intent is undone. Non-production
  only: the switcher is gated by a chart flag and an environment allowlist.
- **R06:** `/session/status` and `/session-timed-out` refresh IDAM tokens for a session already past its absolute
  limit. The lifetime middleware exempts the timed-out page and only *answers* the status path, and
  `refreshMiddleware` still runs for both. That contradicts `src/app.ts`'s comment that no refresh can renew a session
  past its absolute limit, and costs IDAM token issuance for a session that is over.

## Context

Baseline: admin `origin/master` `06693df`. Read `CLAUDE.md` ("Session writes", "Security events", the persona
switcher section, and the R04 rule under "Deployment and sessions") and the applicable `.claude/rules/` first. Record
the execution baseline and recheck both findings there.

### R05

- `src/pages/switch-persona.ts` (around line 87) calls `signIn(req, user, subject, tokens)` after the IDAM grant.
- `src/auth/session.ts` `signIn` calls `req.session.regenerate`, which destroys the old id and creates a new one.
- `src/auth/guarded-session-store.ts`: `destroy` runs a plain `DEL` and calls back with no result, so "the old
  session was already gone" is indistinguishable from "it was just deleted". Only a never-stored, freshly generated id
  can create a key (`CREATE`).
- `src/pages/oauth2/callback.ts` also calls `signIn`, on an *anonymous* session (the login flow). It must keep
  regenerating unconditionally: there is no signed-in session to protect, and a sign-in must always produce a new id
  (session fixation).
- The sessions suites (`src/auth/guarded-session-store.test.ts`, `refresh-coordination.test.ts`,
  `session-lifecycle.test.ts`, `src/session-store.test.ts`) run against real Redis with two app instances and a
  per-run prefix; reuse that approach.

### R06

- `src/auth/session-lifetime.ts`: `EXEMPT_PATHS` contains `/logout` and `TIMED_OUT_PATH`; `STATUS_PATH` is answered
  without enforcement. Both still reach `refreshMiddleware` (`src/auth/refresh-middleware.ts`), mounted after
  `requireAuth` in `src/app.ts`.
- `refreshMiddleware` refreshes when the token is inside its 5-minute window, and also backfills `/me` for a session
  holding no answer.
- The status path's answer (`absoluteRemaining`, `idleRemaining`) must stay exactly as it is: the session-timeout
  warning depends on it. The timed-out page must keep rendering as it does.

Review evidence (portable reproductions to adapt into real tests; do not import workspace files):
`local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-sessions.probe.test.ts`, tests "A1" (R05) and
"A2" (R06).

## Development Approach

1. **R05: a re-sign-in replaces its session only if that session still exists.** Give the store an atomic way to
   delete a key and report whether one was there (for example a `DEL` whose count is returned, or a small dedicated
   method), and give `session.ts` a re-sign-in path that uses it: if the old session is already gone, refuse with the
   existing "session gone" outcome (`SessionWriteRefusedError` reason `missing`, so `isSessionGone` is true) and create
   nothing. The persona switch uses that path and handles the refusal like every other gone session
   (`endedElsewhere`: signed out, redirected to `/login`, no event). The OAuth callback keeps the unconditional
   regenerate. Do not add a fallback to a plain write, a retry, or a second path that bypasses the store.
2. **R06: no refresh on the two lifetime paths.** `refreshMiddleware` (and its `/me` backfill) does nothing for
   `STATUS_PATH` and `TIMED_OUT_PATH`, for the same reason it already skips `/logout`. Prefer naming the paths once
   (import the constants from `session-lifetime.ts`) over a second copy of the strings. Do not change what either path
   answers or renders, and do not add a refresh anywhere else.
3. Keep every other behaviour exactly: an ordinary persona switch still rotates the id and emits
   `auth.persona.switched`; logout, timeouts and the R04 fallbacks are unchanged; refresh on every other path is
   unchanged.
4. **Out of scope:** the other review findings; any change to the persona switcher's gating; IDAM token revocation.
   No new dependency, no UI copy change.
5. Work test first. Use real Redis with two app instances for R05, and the real middleware stack for R06. Local task
   commits are appropriate; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. **Never flush Redis: it is shared**; any Redis test uses a unique
per-run prefix and deletes only its own keys. Record actual counts, failures and skips; distinguish baseline failures
from regressions, and inspect formatting diffs. The Redis session suites must stay green.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: A persona switch cannot outlive its session's logout (R05)

**Files:** `src/auth/guarded-session-store.ts` and its test, `src/auth/session.ts` and its test,
`src/pages/switch-persona.ts` and its tests.

- [x] Record the execution baseline in the execution notes.
- [x] Add failing tests, with real Redis and two instances: a switch whose IDAM grant is held at a barrier while
      logout lands on the other instance issues no new session cookie, leaves the browser signed out on both
      instances, and emits no `auth.persona.switched`; the store's delete-and-report operation reports a key that was
      there and one that was not, atomically. Keep, or add, tests that an ordinary switch still rotates the id and
      emits its event, and that the OAuth callback still signs in from an anonymous session.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: No refresh for an expired session's status or timed-out page (R06)

**Files:** `src/auth/refresh-middleware.ts` and its tests, `src/auth/session-lifetime.ts` (to export or share the
path constants, if needed).

- [ ] Add failing tests: on a session 60 s past its absolute limit with its token inside the refresh window,
      `GET /session/status` answers as before (`absoluteRemaining: 0`) and makes no IDAM refresh and no `/me` call,
      and stored tokens are unchanged; the same for `GET /session-timed-out`; on any other path a session inside the
      window is still refreshed.
- [ ] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Record the rules and hand off

**Files:** `CLAUDE.md`, this plan.

- [ ] In `CLAUDE.md`'s "Session writes" section: a re-sign-in (persona switch) replaces its session only if it still
      exists, and the OAuth callback is the one unconditional regenerate. Beside the refresh rules: the lifetime paths
      are never refreshed. **Reference this plan by its `docs/plans/completed/` path**, since that is where it will be
      once the run ends.
- [ ] Record final commits, changed files and test counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- A persona switch that finishes after its session was logged out issues no cookie, signs nobody in and emits no
  switch event; an ordinary switch still rotates the session id.
- The OAuth callback's sign-in is unchanged.
- `/session/status` and `/session-timed-out` never refresh tokens or backfill `/me`, and answer exactly as before.
- Refresh on every other path is unchanged.
- All Validation Commands pass with no new failures or skips, including the Redis session suites.

## Execution notes

### Baseline (Task 1)

Branch `fix/r05-r06-session-edges` at `e51a5f8` (plan only, on top of `origin/master` `06693df`), local Redis at
`redis://127.0.0.1:6379`. `yarn lint`: clean, 518 files, 1 info, which is Biome's configuration-migration notice. `yarn build`: 8/8 tasks.
`yarn turbo test test:app --concurrency=1 --force`: 8/8 tasks, no failures, no skips. App 121 files / 2551 tests;
deed-poll 68 / 1401; api-client 14 / 852; express-govuk-starter 12 / 127; cloud-native-platform 13 / 157;
simple-router 4 / 41; express-session-postgres 2 / 30; express-session-redis 1 / 7.

Both findings confirmed at the baseline: `switch-persona.ts` called `signIn`, which regenerates unconditionally,
and `refreshMiddleware` skips only `/logout`.

### Task 1 (R05)

- Red: the new two-instance test in `src/auth/session-lifecycle.test.ts` (switch held inside `loginAsPersona`, logout
  on instance B) answered `302 /` with a new cookie, so the browser was signed in as the persona. The store tests failed
  with `destroyExisting is not a function`.
- Green: `GuardedSessionStore.destroyExisting(sid)` runs one `DEL` and reports whether it removed a key.
  `reSignIn` in `src/auth/session.ts` calls it first. A `false` rejects with `SessionWriteRefusedError("missing")` and
  creates nothing, and a store without the method fails closed. Otherwise it continues with `signIn`, whose
  regenerate deletes the key again as a no-op. `switch-persona.ts` uses `reSignIn` and hands `isSessionGone` to
  `endedElsewhere`. That means no cookie, `/login?returnTo=%2Fswitch-persona`, and no `auth.persona.switched` event.
  The OAuth callback still calls `signIn`, and `callback.test.ts` now pins that it never consults the store.
- Validation: lint clean; build 8/8; tests 8/8 tasks, no skips. The app suite is 121 files / 2563 tests (+12), and
  every other package is unchanged from the baseline.

## Post-Completion

Publishing, merging and deployment are separate from this plan.
