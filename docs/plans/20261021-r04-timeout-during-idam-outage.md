# Plan: end a timed-out session, and sign out cleanly, even while IDAM is unreachable

## Overview

Address review finding **R04 (Lower)** from the repeat quality and security review (workspace
`local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`). While IDAM discovery is failing:

- a session past its idle or absolute limit is reported ended (`auth.session.ended`) on every request but is never
  ended: each request answers 500 and the old Redis key survives;
- logout deletes the local session but answers 500, without `Clear-Site-Data`.

Both happen because the IDAM end-session URL, which needs discovery, is awaited before the local work is finished.
Fix the order, and treat an unavailable end-session URL like an absent one.

## Context

Baseline: admin `origin/master` `6b438d4`. Read `CLAUDE.md` (especially "Session writes", "Security events" and the
IDAM discovery paragraph under "Deployment and sessions") and the applicable `.claude/rules/` before implementation.
Record the execution baseline and recheck the finding there.

- `src/auth/session-lifetime.ts` `endTimedOutSession`: emits `auth.session.ended` (around line 94), then awaits
  `endSessionUrl(idamSettings(), idToken, …)` (around line 97), and only then calls `restartAfterTimeout` (around line
  100). With discovery failing, `endSessionUrl` throws, so the session is never regenerated and the request is a 500.
  The next request does the same, emitting the event again.
- `src/pages/logout.ts`: emits `auth.logout`, then `signOut` (local first, correctly), then awaits `endSessionUrl`,
  and only then sets `Clear-Site-Data` and redirects. With discovery failing, the throw skips the header and the
  redirect.
- `src/auth/idam.ts` `endSessionUrl` returns `undefined` when IDAM advertises no end-session endpoint; both callers
  already handle `undefined` (`TIMED_OUT_PATH` or `/`). A discovery failure (including the 5 s cooldown's "IDAM
  discovery failed recently") throws instead.
- **Security-event rule to keep:** an ending event must carry the **old** session's `sid`, so it is emitted before the
  session is regenerated or destroyed (`CLAUDE.md`, "Security events"). So the fix is to move the IDAM lookup after
  the local end, not to move the event.

Review evidence (a portable reproduction to adapt into real tests; do not import workspace files):
`local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-sessions.probe.test.ts`, test "A3". It uses
the real openid-client against a loopback discovery endpoint answering 503, and real Redis with a per-run prefix.

## Development Approach

1. **Timeout:** keep the event before the local end (old `sid`), then end the session locally
   (`restartAfterTimeout` for a GET, and whatever the non-GET branch does today), then look up the end-session URL.
   If the lookup fails, use the same fallback as an absent endpoint. The session is then ended on the first request,
   and the event is emitted once for it.
2. **Logout:** keep the order event, `signOut`; then set `Clear-Site-Data`; then look up the end-session URL and fall
   back to `/` if it fails. The redirect always happens.
3. **One small helper, not a framework:** a local "end-session URL or `undefined`" that catches the lookup failure and
   logs a fixed line (no token, no URL, no error prose beyond a bounded reason). Do not change `endSessionUrl`'s own
   contract for other callers unless every caller wants the same; check its callers.
4. Do not change the discovery cooldown, the refresh middleware, the session store or any other path. Keep the
   existing behaviour when IDAM is healthy exactly as it is (including redirecting to IDAM's end-session page).
5. **Out of scope:** the other review findings, including R05 (persona switch racing logout) and R06 (status paths
   refreshing past the absolute limit). No new dependency, no UI copy change.
6. Work test first. Preserve others' changes. Local task commits are appropriate; publishing, merging and deployment
   are separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared; any Redis test uses a unique per-run
prefix and deletes only its own keys. Record actual counts, failures and skips; distinguish baseline failures from
regressions, and inspect formatting diffs for unrelated changes. The Redis session suites
(`src/auth/guarded-session-store.test.ts`, `refresh-coordination.test.ts`, `session-lifecycle.test.ts`,
`src/session-store.test.ts`) must stay green.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: End a timed-out session first, then ask IDAM (R04)

**Files:** `src/auth/session-lifetime.ts` and its tests.

- [x] Record the execution baseline in the execution notes.
- [x] Add failing tests, with discovery failing (a loopback endpoint answering 503, or the cooldown): an idle-expired
      GET is regenerated on the first request and redirected to the timed-out page; the old Redis key is gone; exactly
      one `auth.session.ended` event is emitted, carrying the old `sid`; the non-GET branch ends the session too. With
      IDAM healthy, the redirect to IDAM's end-session page is unchanged.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: Sign out cleanly while IDAM is unreachable (R04)

**Files:** `src/pages/logout.ts` and its tests.

- [ ] Add failing tests: with discovery failing, logout destroys the session, sets `Clear-Site-Data: "cache"`, and
      redirects to `/`, with exactly one `auth.logout` event; with IDAM healthy, it still redirects to IDAM's
      end-session page.
- [ ] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Record the order and hand off

**Files:** `CLAUDE.md`, this plan.

- [ ] Add a short rule to `CLAUDE.md` (near the IDAM discovery paragraph or "Session writes"): ending a session is
      local first, the IDAM end-session lookup comes after and its failure falls back like an absent endpoint, and the
      ending event is still emitted before the local end so it carries the old `sid`. Reference this plan and R04.
- [ ] Record final commits, changed files and test counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- During an IDAM discovery outage, a timed-out session is ended on the first request (302, or 401 for the keep-alive),
  its old key is gone, and exactly one `auth.session.ended` event is emitted with the old `sid`.
- During an outage, logout answers a redirect with `Clear-Site-Data`, not a 500.
- With IDAM healthy, both paths behave exactly as today.
- All Validation Commands pass with no new failures or skips, including the Redis session suites.

## Execution notes

(Record baseline, red/green evidence and final results here.)

### Task 1 (2026-10-21)

- Baseline: `4ac848a` (plan commit on `origin/master` `6b438d4`). Finding confirmed there: `endTimedOutSession` awaited
  `endSessionUrl` before `restartAfterTimeout`, and `src/pages/logout.ts` awaited it before `Clear-Site-Data`. Those
  are its only two callers, and both want the same fallback, so the catch lives in a new
  `src/auth/end-session.ts` (`availableEndSessionUrl`) rather than in `endSessionUrl` itself. Its log line is fixed
  prose, with no error, URL or token.
- Red: with the baseline `session-lifetime.ts`, 8 of the new tests failed (5 unit tests in
  `session-lifetime.test.ts`; 3 in the new Redis plus real `openid-client` suite
  `src/auth/session-lifetime-idam-outage.test.ts`, whose loopback discovery answers 503), all with
  "IDAM discovery failed recently" or a 500. The healthy-IDAM tests passed before and after.
- Green: focused suites 54/54 (including `session-lifecycle.test.ts` and `session-lifetime-refresh.test.ts`).
  `yarn lint` clean (only the existing biome-migrate info), `yarn build` 8/8, and
  `yarn turbo test test:app --concurrency=1 --force` with `REDIS_URL` set: 8/8 tasks; app 116 files / 2509 tests;
  deed-poll 1389, api-client 847, cloud-native-platform 157, govuk-starter 127, simple-router 41, session-postgres 30,
  session-redis 7. No failures and no skips.

## Post-Completion

Publishing, merging and deployment are separate from this plan.
