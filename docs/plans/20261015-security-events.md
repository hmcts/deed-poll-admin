# Plan: security events for sign-in, sign-out, persona switches and refusals

## Overview

Record who signed in, who was signed out and why, who switched persona, and who was refused. The events go to App
Insights as `customEvents`, through one emitter with a closed vocabulary and a closed set of properties. Today the
app logs these as free text with no subject, or not at all. Nothing calls `trackEvent`.

This is the admin half of the service's audit work. The api's append-only audit trail of writes and reads is merged
(api #107). Alert rules over these events are a later infra plan. **The admin app does not duplicate the api's audit
of writes:** it records security events about the session only.

## Decisions: implement these, do not revisit

Agreed with Steve on 2026-10-15.

1. **Events are App Insights `customEvents`**, sent through a new `trackEvent` helper beside `track-exception.ts`
   (`libs/cloud-native-platform/src/monitoring/`), using the same `appInsights.defaultClient` pattern. There is no
   second sink. When `defaultClient` is absent (dev/test), the helper writes one JSON `console.info` line instead.
2. **The vocabulary is fixed**, as a closed TS union, `SecurityEventName`:
   - `auth.login.succeeded`
   - `auth.login.failed` (`reason`: `idam_error` | `exchange_failed`)
   - `auth.logout`
   - `auth.session.ended` (`reason`: `no_refresh_token` | `no_subject` | `refresh_refused` | `refresh_failed_expired` |
     `subject_mismatch` | `api_401` | `idle` | `absolute` | `untimed`). The last three are the session lifetime limits
     from #175, which already log `session ended: <reason>` as a plain line. Keep that line and add the event.
   - `auth.persona.switched` / `auth.persona.switch_failed`
   - `authz.denied` (`source`: `role` | `api`, plus `requiredCapability` when known)
   - `csrf.refused` (`fetchSite`, or `originHost`)
3. **The property allowlist is a closed TS type:** `subject`, `fromSubject`, `toSubject`, `personaId`, `sid`,
   `outcome`, `reason`, `source`, `requiredCapability`, `method`, `route`, `fetchSite`, `originHost`, `env`. An unknown
   key is a compile error.
   - `route` is `req.baseUrl + req.path`, **never `originalUrl` or `url`**: a search's query string carries names.
   - `sid` is the first 16 hex characters of `sha256(req.sessionID)`. Read it **before** `signOut`, and after
     `signIn` for the new session. Never record the raw session id.
   - `subject` is the IDAM subject from `sessionSubject(req)`. Never an email address or a display name.
4. **One emitter:** `securityEvent(name, req, props)` in `src/auth/security-events.ts`. It fills in `sid`, `env` (from
   `ENVIRONMENT_NAME`), `method`, `route`, and `subject` unless the caller gives one.
5. **Every 403 is emitted in one place, `src/errors.ts`.** `ForbiddenError` (`libs/deed-poll/src/errors.ts`) gets an
   optional `reason: "role" | "same-origin" | "api"`, defaulting to `"api"`, which is what `callApi` raises.
   `require-role.ts` (`requireJudicial`, `requireCapability`) and `same-origin.ts` set it, and `errors.ts` maps it to
   `authz.denied` or `csrf.refused`. The existing `console.error` lines stay, so the change is additive and easy to
   revert.
6. **`refreshTokens` returns a discriminated result:** `{ ok: true, tokens }` | `{ ok: false, reason: "invalid_grant" |
   "subject_mismatch" }`. Then `subject_mismatch` can be told apart from an ordinary refusal and alerted on. Keep
   `refresh-middleware.ts`'s redirects and sign-outs exactly as they are.
7. **Never put a token, secret, raw session id, cookie, email address, display name or applicant data** in an event
   property or a log line. Test fixtures included.

## Constraints

- Run every build and test command in the foreground. Never background one: a session that ends mid-run is
  restarted, and the restart runs over it and wipes its results.
- Keep #175's session invariant: `signIn` is the only writer of `authenticatedAt` and `lastSeenAt`, and
  `updateTokens` never writes `authenticatedAt`. `src/auth/session-lifetime-refresh.test.ts` stays green.
- Do not change `require-auth.ts`'s public paths or #179's timeout warning files.
- Do not push, and do not change any environment's configuration.
- Each task is test-first: the new test is seen failing before the change.

## Validation Commands

**Everything here must be green after every task.**

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
npx turbo test test:app --concurrency=1 --force
```

- Redis must be running (`docker compose up -d redis`), or `src/session-store.test.ts` skips silently. Confirm it ran.
- Use `127.0.0.1`, not `localhost`: in this devcontainer `localhost` resolves to IPv6 first, and Docker publishes IPv4
  only.
- `yarn build` is here because vitest does not type-check, and Task 1's `@ts-expect-error` test only bites at compile
  time.
- `--force` stops Turbo replaying cached results.
- Biome warnings count: fix them, even though `yarn lint` exits 0.
- Never quote bare `yarn test` as evidence. Record the actual test counts after each task.

## Implementation Steps

### Task 1: The emitter

**Files:** new `libs/cloud-native-platform/src/monitoring/track-event.ts` (and its export); new
`src/auth/security-events.ts`; tests beside both.

- [x] Add `trackEvent`, mirroring `track-exception.ts`, with the console fallback (decision 1).
- [x] Add `securityEvent` with the closed names and properties (decisions 2–4).
- [x] Tests:
  - the vocabulary is exactly decision 2;
  - an unknown property key is a type error (a `@ts-expect-error` line, which only `yarn build` checks);
  - `sid` is never the raw session id, and is stable within a session;
  - `route` drops the query string;
  - the console fallback runs when there is no client.
- [x] No caller yet.
- [x] Mark completed

### Task 2: Login and logout

**Files:** `src/pages/oauth2/callback.ts`, `src/pages/logout.ts`; their tests.

- [x] Emit `auth.login.succeeded` after `signIn`, with the new session's `sid`.
- [x] Emit `auth.login.failed`:
  - on IDAM's `?error=` (`reason: idam_error`; record IDAM's `error` code only, never `error_description`);
  - on a failed code exchange (`exchange_failed`).
- [x] Emit `auth.logout` before `signOut`, so it carries the old `sid`.
- [x] Tests assert each event and its properties. The serialised call contains no token, email or name.
- [x] Mark completed

### Task 3: Forced sign-outs

**Files:** `src/auth/idam.ts` (`refreshTokens`), `src/auth/refresh-middleware.ts`, `src/errors.ts` (the api-401
path), `src/auth/session-lifetime.ts`; their tests.

- [x] Apply decision 6. Update `refreshTokens`'s callers and tests.
- [x] Emit `auth.session.ended` with the right reason on each refresh-middleware sign-out path, in `errors.ts`'s api-401
  path (`api_401`), and in `session-lifetime.ts`'s `endTimedOutSession` (`idle` | `absolute` | `untimed`). Read the
  `sid` before the session is ended.
- [x] Test each branch, including `subject_mismatch` as distinct from `refresh_refused`.
- [x] Existing refresh and session-lifetime tests are unchanged in behaviour (the same redirects, sign-outs and
  renders), and `session-lifetime-refresh.test.ts` is green.
- [x] Mark completed

### Task 4: Persona switch

**Files:** `src/pages/switch-persona.ts`; `switch-persona.test.ts`.

- [x] Emit `auth.persona.switched` with `fromSubject` (read before `signIn`), `toSubject`, `personaId` and the new
  `sid`.
- [x] Emit `auth.persona.switch_failed` on the 503 path.
- [x] Tests cover both events. The disabled-switcher path emits nothing.
- [x] Mark completed

### Task 5: One emission point for 403s

**Files:** `libs/deed-poll/src/errors.ts`, `src/auth/require-role.ts`, `src/auth/same-origin.ts`, `src/errors.ts`;
their tests.

- [ ] Apply decision 5. `requireCapability` sets `requiredCapability`. `same-origin.ts` sets `fetchSite`, or the
  `originHost` host only, never a full URL.
- [ ] `errors.test.ts` covers role, api and same-origin, each emitting exactly one event of the right name.
- [ ] The existing `same-origin.test.ts` and `require-role.test.ts` tests pass unchanged.
- [ ] Mark completed

### Task 6: Neutralise log injection

**Files:** a new helper beside `src/errors.ts`; every `console.*` that interpolates an api `error.message`.

- [ ] Add `forLog(text)`. It strips CR, LF and C0/C1 control characters (including ANSI escapes) and caps the text at
  500 characters.
- [ ] Apply it to every `console.*` under `src/pages/**` and in `src/errors.ts` that interpolates an api error message.
- [ ] Unit tests for CR/LF, ANSI escapes and the cap. A source-scanning test: no `console.*(` call under `src/pages`
  interpolates `.message` without `forLog`.
- [ ] Mark completed

### Task 7: Documentation and handoff

- [ ] Document the vocabulary and the property rules in `CLAUDE.md`. A new security-relevant path emits through
  `securityEvent`; nothing calls `trackEvent` directly.
- [ ] Add a KQL query to `docs/DEPLOYMENT.md` for checking the events in AAT: `customEvents` where
  `name startswith "auth."` or `name in ("authz.denied", "csrf.refused")`, projecting `subject`, `sid`, `reason` and
  `route`. Expect no `route` containing `?` and no `subject` containing `@`.
- [ ] Record the validation counts and the branch SHA in Execution notes. Do not claim any live verification.
- [ ] Mark completed

## Execution notes

Baseline, 2026-10-15, on `bb26f2d` (#181's merge), with the validation commands above: `yarn lint` exit 0 with no
findings; `yarn build` exit 0; the suite **200 files / 3,948 tests, 0 skipped**:
- app 93 / 1,720
- deed-poll 66 / 1,169
- api-client 10 / 708
- cloud-native-platform 12 / 153
- express-govuk-starter 12 / 127
- express-session-postgres 2 / 23
- simple-router 4 / 41
- express-session-redis 1 / 7

`session-store.test.ts` ran (7 tests). Re-run 2026-10-16 after merging master (`f7dcf82`, js-yaml 5.4.3): identical counts, lint and build clean.

Task 1, 2026-10-16: `yarn lint` exit 0 (one info only: `biome.json`'s schema 2.5.13 against CLI 2.5.15, present before
this task); `yarn build` exit 0; the suite **203 files / 3,964 tests, 0 skipped, no type errors** — app 95 / 1,732,
cloud-native-platform 13 / 157, the rest unchanged; `session-store.test.ts` ran (7 tests). One correction to the plan:
`yarn build` does **not** check test files, because every tsconfig excludes `*.test.ts`. The `@ts-expect-error` checks
are therefore in `src/auth/security-events.test-d.ts`, run through `tsc` by vitest's typecheck mode
(`vitest.config.ts`, narrowed by `tsconfig.typecheck.json` because the root `tsconfig.json` has no `include`). Seen
failing with an unused directive before being restored.

Task 2, 2026-10-16: `yarn lint` exit 0 (the same one info); `yarn build` exit 0; the suite **203 files / 3,972 tests,
0 skipped, no type errors** — app 95 / 1,740, the rest unchanged; `session-store.test.ts` ran (7 tests). IDAM's `error`
code goes in `outcome`, the only allowlisted key that fits. Because the browser writes that query, a value that is not
an RFC 6749-shaped code (`^[a-z_]{1,64}$`) is recorded as `unrecognised` rather than as attacker-chosen text. A
bookmarked `/logout` with no session still emits `auth.logout`, with no subject.

Task 3, 2026-10-16: `yarn lint` exit 0 (the same one info); `yarn build` exit 0; the suite **203 files / 3,986 tests,
0 skipped, no type errors** — app 95 / 1,754, the rest unchanged; `session-store.test.ts` ran (7 tests).
`refreshTokens` answers `{ ok: false, reason: "invalid_grant" }`, which the middleware records as `refresh_refused`,
or `subject_mismatch`, recorded as itself. A refresh that throws while the token still works ends nothing and emits
nothing. `switch-persona.test.ts`'s `refreshTokens` stub moved to the new shape; its assertions are unchanged.

Task 4, 2026-10-16: `yarn lint` exit 0 (the same one info); `yarn build` exit 0; the suite **203 files / 3,989 tests,
0 skipped, no type errors** — app 95 / 1,757, the rest unchanged; `session-store.test.ts` ran (7 tests).
`auth.persona.switch_failed` carries the persona id and the current session's subject and sid, but **not**
`loginAsPersona`'s reason: that is prose which may quote IDAM's error text. `switch-persona.test.ts`'s session
subjects were emails; they are now opaque IDAM-subject fixtures (decision 7), with the assertions unchanged.

## Post-Completion

- Alert rules over these events (denial bursts, login-failure bursts, any `subject_mismatch`, any persona switch
  outside AAT) are a later infra plan. Destinations are App Insights and Dynatrace (decided 2026-10-15).
- Verify in AAT with the Task 7 query after deploying.
