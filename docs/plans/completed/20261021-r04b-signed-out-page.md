# Plan: a signed-out page, so a logout fallback never signs anyone back in

## Overview

Follow-up to R04 (`docs/plans/completed/20261021-r04-timeout-during-idam-outage.md`, on this branch). A direct review
found that R04's logout fallback redirects to `/`. For a signed-out visitor `src/pages/index.ts` redirects at once to
`/login?returnTo=%2F`, which starts IDAM sign-in without a click. During an IDAM outage the IDAM session survives
(R04 accepts that), so as soon as any pod can reach IDAM again, someone who clicked "Sign out" on a shared PC can be
signed straight back in. The same was already true before R04 whenever IDAM advertised no end-session endpoint
(`away ?? "/"`).

Give logout a public "You have signed out" page with an explicit "Sign in again" link, and send both logout fallbacks
there. The timeout path already falls back to `/session-timed-out`, which needs a click, and does not change.

## Context

Baseline: this branch's head (R04). Read `CLAUDE.md` (the R04 rule under "Deployment and sessions", "Security
events", and the Welsh extractor paragraphs under "Personas and role gating"), `.claude/rules/frontend.md` and the
other applicable rules first. Record the execution baseline.

- `src/pages/logout.ts`: emits `auth.logout`, `signOut`, sets `Clear-Site-Data: "cache"`, then
  `res.redirect(away ?? "/")`, where `away` is `availableEndSessionUrl(...)` (`undefined` when IDAM advertises no
  endpoint or cannot be reached).
- `src/pages/index.ts`: an anonymous GET of `/` redirects to `/login?returnTo=%2F`.
- `src/auth/require-auth.ts`: public paths are an explicit allowlist (`PUBLIC_PATHS`); a new public page must be added
  there, and its test.
- `src/pages/session-timed-out/index.ts` and `index.njk`: the model to follow (a public page with en/cy copy and a
  "Sign in again" link). Its Welsh for "Sign in again" (`Mewngofnodi eto`) can be reused.
- The Welsh extractor (`scripts/extract-welsh-strings.mjs`) only reads directories on its `INCLUDE` list; a new page
  area that is not added contributes nothing to `yarn welsh:check`, silently.
- With IDAM healthy, logout keeps redirecting to IDAM's end-session URL (whose post-logout path is IDAM
  configuration); that path is unchanged.

## Development Approach

1. A new public GET page, `/signed-out`, extending `layouts/app.njk`: a heading that the caseworker has signed out of
   this service, one short sentence, and a "Sign in again" link to `/login` (a link, never an automatic redirect).
   During an outage IDAM may still hold its own session, so the sentence must not claim the user is signed out
   everywhere; keep it true in both cases (for example "You have signed out of this service."). Use GOV.UK classes
   only.
2. Add `/signed-out` to `PUBLIC_PATHS`, and to the Welsh extractor's `INCLUDE` if its directory is not already covered.
3. `src/pages/logout.ts` redirects to `/signed-out` whenever `away` is `undefined`, for both the no-endpoint and the
   outage cases. Nothing else about logout changes: event before `signOut`, `Clear-Site-Data` before the redirect,
   exactly one `auth.logout` event.
4. **Copy:** en and cy pairs. Reuse existing Welsh where the same words exist (`Mewngofnodi eto`); for new wording,
   follow the repo's practice for untranslated strings, and confirm the `yarn welsh:check` count changes only by the
   new strings.
5. **Out of scope:** the timeout path, IDAM configuration, the post-logout path registered with IDAM, R05 and R06.
6. Work test first. Local task commits are appropriate; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips; distinguish baseline failures from regressions. Run `yarn welsh:check` before and after (it exits 1 by design)
and record both counts.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: The signed-out page

**Files:** `src/pages/signed-out/` (handler, template, tests), `src/auth/require-auth.ts` and its test,
`scripts/extract-welsh-strings.mjs` if needed.

- [x] Record the execution baseline and the `welsh:check` counts in the execution notes.
- [x] Add failing tests: an anonymous GET of `/signed-out` renders 200 with the heading and a "Sign in again" link to
      `/login`, without redirecting; it renders in Welsh with `?lng=cy`; it is public; the layout test still passes.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: Send both logout fallbacks there

**Files:** `src/pages/logout.ts` and its tests (including `logout-idam-outage.test.ts`).

- [x] Add failing tests: with IDAM unreachable, and with IDAM advertising no end-session endpoint, logout redirects to
      `/signed-out` (not `/`), with `Clear-Site-Data` set and exactly one `auth.logout` event; following that redirect
      starts no sign-in. With IDAM healthy it still redirects to IDAM's end-session URL.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Record the rule and hand off

**Files:** `CLAUDE.md`, this plan.

- [x] Extend the R04 rule in `CLAUDE.md`: a logout that cannot reach IDAM's end-session page lands on `/signed-out`,
      never on `/`, because `/` signs an anonymous visitor straight back in through a surviving IDAM session.
      **Reference plans by their `docs/plans/completed/` path**, since that is where they will be once the run ends.
- [x] Record final commits, changed files, test counts and `welsh:check` counts in the execution notes.
- [x] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- No logout fallback leads to an automatic sign-in: it lands on `/signed-out`, and signing in again takes a click.
- With IDAM healthy, logout is unchanged.
- `/signed-out` is public, bilingual and on the Welsh extractor's scope.
- All Validation Commands pass with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence and final results here.)

### Baseline (branch head `d8c6c85`, REDIS_URL=redis://127.0.0.1:6379)

- `yarn lint`: clean (510 files, one config-migration info). `yarn build`: 8/8 tasks.
- `yarn turbo test test:app --concurrency=1 --force`: all pass, no skips. app 117 files / 2517 tests;
  deed-poll 1389; deed-poll-api-client 847; cloud-native-platform 157; express-govuk-starter 127;
  simple-router 41; express-session-postgres 30; express-session-redis 7.
- `yarn welsh:check` (exits 1 by design): 729 strings, 512 still identical in cy (505 prose, 7 not prose).

### Task 1

- Red: `allows the signed-out page` (require-auth) and the app.test public-pages sweep failed; both signed-out test
  files failed to import the missing handler.
- Green: `src/pages/signed-out/index.ts`, `index.njk`, `index.test.ts`, `index.njk.test.ts` (markup en/cy, plus an
  anonymous HTTP GET through the real `requireAuth` and the starter's `localeMiddleware`: 200, no `Location`, and
  `?lng=cy` renders "Mewngofnodi eto"). `/signed-out` added to `PUBLIC_PATHS` and the extractor's `INCLUDE`.
  Title and body are English pending translation (`...en`, the repo's practice); "Sign in again" reuses
  "Mewngofnodi eto".
- `yarn welsh:check`: 732 strings, 514 identical (507 prose): +3 strings, +2 identical, exactly the new ones.
- Validation: lint clean (513 files), build 8/8, all tests pass with no skips; app 119 files / 2525 tests, libraries
  unchanged.

### Task 2

- Red: five failures, all receiving `/` — logout.test's no-endpoint and outage cases, the outage file's 503 and
  cooldown cases, and a new HTTP test (`requireAuth` in front of `/logout` and `/signed-out`, the followed redirect
  arriving anonymous) that got `Location: /`.
- Green: `logout.ts` redirects to `SIGNED_OUT_PATH` when `away` is `undefined`; event, `signOut` and
  `Clear-Site-Data` order unchanged. The followed redirect answers 200 with no `Location` and makes no further
  discovery request; the healthy-IDAM test still gets IDAM's end-session URL.
- `yarn welsh:check`: unchanged at 732 strings, 514 identical (507 prose).
- Validation: lint clean (513 files), build 8/8, all tests pass with no skips; app 119 files / 2526 tests (+1),
  libraries unchanged.

### Task 3

- `CLAUDE.md`: the R04 rule's logout fallback now reads `/signed-out`, and a new bullet beside it says why a logout
  without IDAM's end-session page must never land on `/`, citing `docs/plans/completed/20261021-r04b-signed-out-page.md`.
- Commits: `59f4c97` (Task 1, the page), `b625c33` (Task 2, logout fallbacks), and this Task 3 commit.
- Changed files since `d8c6c85`: `CLAUDE.md`, this plan, `scripts/extract-welsh-strings.mjs`, `src/app.test.ts`,
  `src/auth/require-auth.ts` and its test, `src/pages/logout.ts`, `logout.test.ts`, `logout-idam-outage.test.ts`,
  `src/pages/signed-out/index.ts`, `index.njk`, `index.test.ts`, `index.njk.test.ts`.
- Final validation: lint clean (513 files), build 8/8, all tests pass with no skips; app 119 files / 2526 tests
  (baseline 117 / 2517); deed-poll 1389, deed-poll-api-client 847, cloud-native-platform 157, express-govuk-starter
  127, simple-router 41, express-session-postgres 30, express-session-redis 7 (all unchanged).
- `yarn welsh:check`: 732 strings, 514 identical (507 prose), against the baseline 729 / 512 (505): only the page's
  three new strings, two of them pending translation.
- Handed off to the Ralphex review phases.

### Verification before PR (21 October 2026, Arbor)

- Covers the whole branch: R04 and this signed-out page. ralphex (13m34s) ran after a green baseline; clean on the
  first external pass. Tree clean, signals genuine. One stale plan path in a test comment fixed in `1e09d17`.
- Against `origin/master`: audit exit 0; lint exit 0; forced build exit 0; tests exit 0: 232 files, 5,124 tests,
  none failed or skipped. `yarn welsh:check`: 732 strings, 514 identical (the page's title and body await
  translation; "Sign in again" reuses the existing Welsh).
- Red against master's source (the four changed source files restored, new modules kept): 23 of 116 of the new and
  changed tests fail. All pass with this branch's code.
- Direct scoped Copilot review (gpt-6-astra, read-only, whole branch against `origin/master`, 76 tool calls): no
  issues found. An earlier review of R04 alone found the `/` fallback re-sign-in this plan fixes.

## Post-Completion

Publishing, merging and deployment are separate from this plan.
