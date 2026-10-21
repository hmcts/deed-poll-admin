# Plan: give the Gazette send a deadline counted from when the request arrived

## Overview

Follow-up to R03 (`docs/plans/completed/20261021-r03-gazette-submit-timeout.md`, on this branch). The submit now has
its own 20 s timeout, but a direct review found that 20 s is not an end-to-end bound: the same browser request may
already have spent time before the send. That time comes from the review re-check (`gazetteReviewsCurrent`, up to
100 case reads, ten at a time) and, when the token is near expiry, the refresh middleware's IDAM call and `/me`.
The frontend Application Gateway cuts the browser's request off at 30 s, so a slow pre-send phase plus a 20 s send can
still show the caseworker the gateway's error page instead of the success redirect or the recovery page.

Steve's decision (2026-10-21): use a deadline counted from the request's arrival. The submit gets what remains of a
fixed budget, capped at the existing 20 s; if too little remains, nothing is sent and the page says so safely.

## Context

Baseline: this branch's head (R03 plus its correction). Read `CLAUDE.md` (the Gazette paragraph, including the R03
timeout sentences, and "Abuse limits"), `.claude/rules/backend.md` and the other applicable rules first. Record the
execution baseline.

- `libs/deed-poll-api-client/src/api/client.ts`: `GAZETTE_SUBMIT_TIMEOUT_MS = 20_000`, applied in
  `submitGazetteNotice` as `config.timeoutMs ?? GAZETTE_SUBMIT_TIMEOUT_MS`. Its docblock explains the four numbers.
- `libs/deed-poll/src/api/deed-poll-api.ts`: `apiConfig` sets `timeoutMs` from `DEED_POLL_API_TIMEOUT_MS` when that
  is set; `callGazetteApi(caller, call)` builds the config and classifies failures.
- `libs/deed-poll/src/gazette/service.ts`: `sendGazetteSelection(input, key, caller)`.
- `src/pages/deed-polls/gazette/batch.ts`: the send (`confirmSelection` with `action=send`, which re-checks reviews
  and then calls `submit`) and the status check (`phase=recover`, `action=check`, which calls `submit` directly).
- `src/app.ts`: middleware order is pinned by `src/app.test.ts`. Nothing records a request's arrival time today.
- Layer rules (`.claude/rules/backend.md`): `Caller` is `{ accessToken }` and nothing else; pages never build an
  `ApiConfig`; HTTP concerns stay out of the domain. A time budget is not an identity, so it must not go on
  `Caller`.

## Development Approach

1. **Record arrival once, as early as possible.** A tiny middleware mounted first in `src/app.ts` (before sessions
   and refresh) sets the arrival time on `res.locals` (for example `res.locals.receivedAt = Date.now()`). Pin its
   position in `src/app.test.ts` as the other order-sensitive middleware is pinned. Nothing else uses it yet; do not
   build a general request-timing framework.
2. **A budget and a floor, beside the page that uses them.** In the Gazette area: a total budget measured from arrival
   (25 s: inside the frontend gateway's 30 s, leaving about 5 s to render and respond), and a minimum useful send
   time (5 s). Document both against the four timeouts already listed at `GAZETTE_SUBMIT_TIMEOUT_MS`.
3. **The submit's timeout is the smallest of three:** the remaining budget, `GAZETTE_SUBMIT_TIMEOUT_MS` (20 s), and
   `DEED_POLL_API_TIMEOUT_MS` when an operator has set it. The operator override can shorten the wait, never extend
   it past the deadline. Pass the remaining time from the page to the domain as an explicit, optional argument
   (for example `sendGazetteSelection(input, key, caller, { timeoutMs })`), which the domain turns into the call's
   config. Keep `Caller` unchanged, and keep the adapter's own default for callers that pass nothing.
4. **Too little time left: do not send.** If the remaining budget is under the floor when the send or the status
   check is about to call api, make no api call, so nothing is admitted:
   - For a first send, re-render the confirm step with a message that nothing was sent and the caseworker can send
     again. The journey is unchanged, so its request key (derived from the visit) is unchanged; a resend is the same
     keyed request.
   - For a status check, re-render the recovery page as it is now, with a message that the check could not be made
     and can be tried again. The original key and body are kept.
   Never mint a new key, and never offer one, in either case.
5. Behaviour when the budget is ample is exactly today's: a 10–20 s send redirects to the request page; an abort, a
   gateway 504 or a dropped connection renders the recovery page with the original key.
6. **Copy:** the two new messages are caseworker-facing, so they go in the page's `en`/`cy` pairs (the Gazette pages
   carry Welsh). Where no Welsh exists yet, follow the page's existing practice for untranslated strings, and confirm
   the `yarn welsh:check` count changes only by the new strings.
7. **Out of scope:** the gateways' `request_timeout` (platform), an asynchronous send in api, and any other call's
   timeout. No new dependency.
8. Work test first. Use fake timers or an injected clock for the budget arithmetic, and keep one real-HTTP test that
   proves the remaining time reaches the request. Local task commits are appropriate; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips; distinguish baseline failures from regressions, and inspect formatting diffs. Do not send email and do not call
a live environment.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: Record when a request arrived

**Files:** `src/app.ts`, `src/app.test.ts`, and a small module for the middleware with its test.

- [x] Record the execution baseline in the execution notes.
- [x] Add failing tests: the arrival time is set on `res.locals` for every request, before any session or refresh
      middleware runs (pinned in `src/app.test.ts`).
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: Send only within the deadline

**Files:** `src/pages/deed-polls/gazette/batch.ts` and its tests (handler and `*.njk.test.ts`),
`libs/deed-poll/src/gazette/service.ts` and its test, `libs/deed-poll/src/api/deed-poll-api.ts` if the config needs
it, and `libs/deed-poll-api-client/src/api/client.ts` only if the adapter must accept a lower timeout than its default.

- [x] Add failing tests, with an injected clock:
  - ample budget: the submit gets 20 s, behaviour unchanged;
  - 12 s already spent: the submit gets 13 s;
  - `DEED_POLL_API_TIMEOUT_MS` of 5 s: the submit gets 5 s; of 60 s: still capped by the deadline;
  - under the floor on a first send: no api call, the confirm step re-renders with the not-sent message and the same
    key;
  - under the floor on a status check: no api call, the recovery page re-renders with the original key and body;
  - a real-HTTP test where the remaining time reaches the request.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Record the rule and hand off

**Files:** `CLAUDE.md`, `docs/DEPLOYMENT.md`, the `GAZETTE_SUBMIT_TIMEOUT_MS` docblock, this plan.

- [x] Update the R03 sentences in `CLAUDE.md`'s Gazette paragraph and the `docs/DEPLOYMENT.md` passage: the send's
      timeout is the remaining part of a 25 s budget from arrival, capped at 20 s and by `DEED_POLL_API_TIMEOUT_MS`,
      and below a 5 s floor nothing is sent. **Reference plans by their `docs/plans/completed/` path**, since that is
      where they will be once the run ends.
- [x] Record final commits, changed files and test counts in the execution notes.
- [x] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- The browser always gets this app's own answer (redirect, recovery page, or the new not-sent message) within the
  budget, whatever the request spent before the send.
- With ample time, behaviour is exactly as on this branch before this plan.
- Under the floor, no api call is made, nothing is admitted, and the same key is kept; no new key is ever offered.
- `DEED_POLL_API_TIMEOUT_MS` can only shorten the send's wait.
- `Caller` is unchanged, and no page builds an `ApiConfig`.
- All Validation Commands pass with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence and final results here.)

### Baseline (2026-10-21, head `bd93c66`)

- `yarn lint`: clean (509 files after Task 1; one Biome config-migration info, pre-existing).
- `yarn build`: 8/8 tasks successful.
- `yarn turbo test test:app --concurrency=1 --force` with `REDIS_URL=redis://127.0.0.1:6379`: 8/8 tasks; app 114 files
  / 2498 tests, `@hmcts/deed-poll` 68 / 1394, `@hmcts/deed-poll-api-client` 14 / 851, cloud-native-platform 13 / 157,
  express-govuk-starter 12 / 127, simple-router 4 / 41, express-session-postgres 2 / 30, express-session-redis 1 / 7.
  No failures, no skips.

### Task 1

- Red: `src/request-arrival.test.ts` failed to import the missing module; `src/app.test.ts`'s new "arrival time"
  test failed (no layer mounted).
- Green: `src/request-arrival.ts` (`recordArrival()`, sets `res.locals.receivedAt = Date.now()`), mounted as the
  first layer in `createApp`, right after `trust proxy`. `app.test.ts` pins it as `stack[0]`, matching every path,
  ahead of the session (and every other doubled layer) and `refreshMiddleware`.
- Validation: lint clean, build 8/8, tests 8/8; app 115 files / 2501 tests (+3), others unchanged. No skips.

### Task 2

- Red: with `batch.ts` at head, 7 of the 48 page tests failed (the new deadline tests and the four-argument send);
  the adapter's new 60 s cap test failed against the old `??` default.
- Green:
  - `submitGazetteNotice` treats `GAZETTE_SUBMIT_TIMEOUT_MS` as a ceiling: `Math.min(config.timeoutMs ?? 20 s, 20 s)`,
    so a configured timeout can only shorten the wait.
  - `callGazetteApi(caller, call, limit?)` and `sendGazetteSelection(input, key, caller, limit?)` take an optional
    `CallLimit` (`{ timeoutMs }`) beside the unchanged `Caller`; the config's timeout is the shorter of it and
    `DEED_POLL_API_TIMEOUT_MS`.
  - `src/gazette/send-deadline.ts`: `gazetteSendTimeLeft(res)` returns `25 s - (now - res.locals.receivedAt)`, or
    `null` under the 5 s floor; a missing or non-numeric arrival counts as now, a future one is clamped.
  - `batch.ts` `submit` checks it immediately before the call (after the review re-check). Under the floor it makes
    no call and re-renders the same journey: confirm step with `notSent`, or the recovery page with `notChecked`
    (both 503, `en`/`cy`). `confirmSelection` now passes the confirm-phase journey, and `submit` still moves to
    `recover` on an unknown outcome.
- Tests: deadline module (budget arithmetic on fake `Date`); page (0 s and 12 s spent → 25 s / 13 s passed; time
  spent in the review re-check counted; under the floor on a send in `en` and `cy`, same confirmation and key, and a
  resend uses that key; under the floor on a status check, same confirmation, then the next check replays the
  original body and key); domain (limit passed through; overrides of 5 s and 60 s against 13 s left); real HTTP on a
  scaled clock (13 s left armed; 8 s left times out after one admission; 25 s left with a 60 s override armed at 20 s);
  adapter (60 s configured capped at 20 s).
- `yarn welsh:check`: 729 → 731 strings (the two new ones), identical-in-cy count unchanged at 512.
- Validation: lint clean (511 files, the pre-existing info), build 8/8, tests 8/8; app 116 files / 2517 tests (+16),
  `@hmcts/deed-poll` 68 / 1401 (+7), `@hmcts/deed-poll-api-client` 14 / 852 (+1), others unchanged. No skips.

### Task 3

- Docs: `CLAUDE.md`'s Gazette paragraph and `docs/DEPLOYMENT.md` (the `DEED_POLL_API_TIMEOUT_MS` row and "Gazette send
  timeout follow-up") now state the 25 s budget from arrival, the 20 s cap, that `DEED_POLL_API_TIMEOUT_MS` only
  shortens it, and the 5 s floor; the `GAZETTE_SUBMIT_TIMEOUT_MS` docblock names the budget and floor. Plans are
  referenced by their `docs/plans/completed/` paths.
- Commits: `f9fd591` (Task 1), `940f3c2` (Task 2), and this task's docs commit.
- Changed files across the plan: `src/request-arrival.ts` (+test), `src/app.ts`, `src/app.test.ts`,
  `src/gazette/send-deadline.ts` (+test), `src/pages/deed-polls/gazette/batch.ts`, `batch.njk.test.ts`,
  `libs/deed-poll/src/gazette/service.ts`, `send.test.ts`, `submit-timeout.test.ts`,
  `libs/deed-poll/src/api/deed-poll-api.ts`, `libs/deed-poll-api-client/src/api/client.ts` (+test), `CLAUDE.md`,
  `docs/DEPLOYMENT.md`, this plan.
- Final validation: lint clean (511 files, the pre-existing info), build 8/8, tests 8/8; app 116 files / 2517,
  `@hmcts/deed-poll` 68 / 1401, `@hmcts/deed-poll-api-client` 14 / 852, cloud-native-platform 13 / 157,
  express-govuk-starter 12 / 127, simple-router 4 / 41, express-session-postgres 2 / 30, express-session-redis 1 / 7.
  No failures, no skips. Handed off to the Ralphex review phases.

## Post-Completion

Publishing, merging and deployment are separate from this plan.
