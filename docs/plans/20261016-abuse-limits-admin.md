# Plan: abuse limits, admin half (OWASP M6)

## Overview

deed-poll-api now limits each IDAM subject's searches, email previews, email sends and uploads (api#113, merged
2026-10-16 as `fb6a00a`). It answers 429 with `Retry-After`. Today admin classifies every 429 as `unavailable`, so a
caseworker who reaches a limit sees the "problem with the service" page.

This is the admin half of OWASP plan 06 (`owasp-remediation-06-abuse-limits.local.md`, Tasks 7–10). It does four
things:

- takes in api's refreshed OpenAPI document;
- gives a 429 its own error kind and a GOV.UK "too many requests" page;
- adds a Redis fixed-window limiter in front of the same four actions;
- adds a per-pod in-flight upload cap.

**api stays authoritative.** Admin's limiter is for UX and to protect admin's own pods; it is never the control.

## Decisions: implement these, do not revisit

Agreed with Steve on 2026-10-15 (the plan) and 2026-10-16 (the numbers and this half).

1. **The api spec refresh is exactly six 429 responses.** It was regenerated at api `fb6a00a` by api's
   `OpenAPIPublisherTest`, raw SHA-256 `8ba16665e913b31c8a45ca873e742cae12fa6f8e8d989b37076d14b40f73bf33`, saved at
   `/tmp/openapi-fb6a00a-keep.json`. A parsed comparison against the committed `openapi.json` shows:
   - no operation, path or schema added or removed (52 operations, 37 paths, 56 schemas);
   - 429 added to `GET /caseworker/cases`, `POST /caseworker/cases/{id}/documents`,
     `POST /caseworker/cases/{id}/emails/{template}`, `POST /caseworker/cases/{id}/emails/{template}/preview`,
     `POST /caseworker/gazette-notice-previews` and `POST /caseworker/gazette-notices`;
   - every other response on those six operations identical.

   Copy it in as 2-space JSON, then Biome, and record it in `SPEC-PROVENANCE.md` in the existing table's style. If the
   copied file's parsed delta is anything else, stop.
2. **A new adapter error kind, `rate-limited`, for 429 only.**
   - It carries `retryAfterSeconds`, parsed from `Retry-After` as a non-negative integer number of seconds; absent or
     invalid is `null`.
   - 408 and 5xx stay `unavailable`.
3. **A new domain error, `TooManyRequestsError`**, which `callApi` raises for `rate-limited`, carrying
   `retryAfterSeconds`.
4. **Gazette is unchanged.** `callGazetteApi` already treats anything except a published Gazette refusal,
   `unauthorized` or `forbidden` as `GazetteOutcomeUnknownError`. A 429 must keep reaching that branch, because only a
   published Gazette refusal proves that nothing was admitted. Pin this with a test.
5. **The 429 page.**
   - `src/errors.ts` gains a `TooManyRequestsError` branch: status 429, a `Retry-After` header when known, and
     `errors/429`.
   - The page extends `layouts/app.njk`.
   - It says "try again in N minutes" (rounded up, at least 1) when the wait is known, and a generic sentence when it is
     not.
   - Copy goes in `src/locales/en.ts` and `cy.ts`, never hard-coded.
6. **The admin limiter, `src/rate-limit/limiter.ts`: a hand-rolled fixed window in Redis.**
   - It runs `MULTI INCR admin-rl:{bucket}:{subject}:{windowIndex}; EXPIRE … {windowSeconds}` on the existing Redis
     client. `EXPIRE` has no `NX`, because Azure Cache may predate Redis 7; the window index in the key makes a repeated
     `EXPIRE` harmless.
   - Keyed on `sessionSubject(req)`, falling back to `req.sessionID`. **Never** on IP or `X-Forwarded-For`.
   - It **fails open** with a `console.warn` when Redis errors, because Redis being down already means no sessions.
   - No new dependency: not express-rate-limit, not rate-limiter-flexible.
   - It takes the Redis client as a parameter, so the logic is tested against a fake. A real-Redis test is an extra,
     skipped when Redis is unreachable, as `src/session-store.test.ts` is.
7. **Admin's buckets mirror api's numbers, so admin never refuses what api would allow:**

   | Bucket | Route | Limit |
   |---|---|---|
   | `search` | `GET /deed-polls` when `req.query.q` is non-blank (**`q` only**, not `where`) | 120 per 1 min |
   | `email-preview` | `POST /deed-polls/:id/emails/:template/preview` | 30 per 10 min |
   | `email-send` | `POST /deed-polls/:id/emails/:template/send` | 20 per 1 h |
   | `upload` | `POST /deed-polls/:id/documents/upload` | 30 per 10 min |

   Only `q` for search, because saved-query and worklist links carry `where` in their URLs. The Gazette batch page is
   not limited here: api limits it, and decision 4 handles api's 429.
8. **Modes `off | observe | enforce`**: `rateLimit.mode` ← `RATE_LIMIT_MODE`, default `observe` in
   `config/default.json` and the chart's `values.yaml`.
   - `observe` counts and logs exactly what `enforce` would refuse, and refuses nothing.
   - `enforce` raises `TooManyRequestsError` with the seconds left in the window.
   - Use an explicit config value, never `NODE_ENV`.
   - Per-bucket limits and windows are config too (`rateLimit.buckets.<bucket>.limit` / `.windowSeconds`), with
     `__format: json` for numbers.
9. **One log line per refusal or would-refuse:** `rate_limit bucket=<b> mode=<m> subject=<sub> count=<n> limit=<l>`.
   No case data, no query text.
10. **A per-pod in-flight upload cap**: a module-level counter, default 4, `rateLimit.uploadInFlight`.
    - It raises `TooManyRequestsError` with `retryAfterSeconds: 5`, and is released on response finish **and** on
      close.
    - **It enforces from day one, whatever the mode.**
    - The upload `POST` becomes `[uploadInFlightCap(), rateLimit("upload"), uploadSingleFile(), handler]`, so a refusal
      never reaches multer.
11. **Bump `charts/deed-poll-admin/Chart.yaml` from 0.0.3 to 0.0.4**, because `values.yaml` changes. Flux reconciles on
    chart version, so without the bump the new value never deploys. Check master's version just before finishing.

## Constraints

- Run every build and test command in the foreground. Never background one: a session that ends mid-run is
  restarted, and the restart runs over it and wipes its results.
- Never key a limit on IP or `X-Forwarded-For`. Never limit the dashboard's internal count reads, saved-query or
  worklist links without `q`.
- The limiter and the in-flight cap go **before** `uploadSingleFile()`. A limiter after parsing protects nothing.
- Do not change Gazette's outcome handling (decision 4), `require-auth.ts`'s public paths, or the security-events
  vocabulary.
- No new dependency. If one becomes unavoidable, stop.
- `yarn welsh:check` exits 1 by design. Confirm that the count of identical `en`/`cy` strings moved only by this plan's
  new keys.
- Do not push, and do not change any environment's configuration.
- Each task is test-first: the new test is seen failing before the change.

## Validation Commands

**Everything here must be green after every task.** Run them before Task 1 too: never start red.

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
npx turbo test test:app --concurrency=1 --force
```

- Redis must be running (`docker compose up -d redis`), or the real-Redis tests skip silently. Confirm they ran.
- Use `127.0.0.1`, not `localhost`: in this devcontainer `localhost` resolves to IPv6 first, and Docker publishes IPv4
  only.
- `--force` stops Turbo replaying cached results.
- Biome warnings count: fix them, even though `yarn lint` exits 0.
- Never quote bare `yarn test` as evidence. Record the actual test counts after each task.
- Jenkins runs `yarn test` with **no** prior build, so nothing may depend on a built `libs/*/dist`.

## Implementation Steps

### Task 1: Refresh the api spec

**Files:** `libs/deed-poll-api-client/openapi.json`; `SPEC-PROVENANCE.md`; any `contract.test.ts` assertion the six
429s break.

- [x] Copy decision 1's document in; confirm the parsed delta is exactly the six 429s.
- [x] Record it in `SPEC-PROVENANCE.md`: api `fb6a00a`, the SHA-256, the method, and the delta.
- [x] Update any contract assertion that pins those operations' responses, and nothing else. (none needed: no assertion pins those six operations' responses; all tests green)
- [x] Mark completed

### Task 2: Classify 429 as `rate-limited`

**Files:** `libs/deed-poll-api-client/src/api/client.ts`; `libs/deed-poll/src/errors.ts`;
`libs/deed-poll/src/api/deed-poll-api.ts`.

- [x] `client.test.ts`: 429 is `rate-limited` with `retryAfterSeconds` from `Retry-After`; absent, negative or
  non-numeric gives `null`; 408 and 5xx stay `unavailable`.
- [x] `callApi` raises `TooManyRequestsError`, carrying the seconds.
- [x] `callGazetteApi` still raises `GazetteOutcomeUnknownError` for a 429.
- [x] Mark completed

### Task 3: The 429 page

**Files:** `src/errors.ts`; `src/pages/errors/429.njk`; `src/locales/en.ts` and `cy.ts`.

- [x] `errors.test.ts`: status 429, the `Retry-After` header when known, "try again in N minutes" (rounded up, at least
  1), and the generic sentence when unknown.
- [x] `429.njk.test.ts` follows the template-test spread order (`.claude/rules/testing.md`), and the page extends
  `layouts/app.njk`.
- [x] The Welsh count moved only by the new keys. (686 → 691 strings, identical stayed 474)
- [x] Mark completed

### Task 4: The Redis limiter

**Files:** `src/rate-limit/limiter.ts`; `config/default.json`; `config/custom-environment-variables.json`;
`charts/deed-poll-admin/values.yaml`; `charts/deed-poll-admin/Chart.yaml`.

- [x] Fake-client tests: counts per subject, not per IP; falls back to the session id; resets in the next window;
  `enforce` raises with the remaining seconds; `observe` logs and passes; `off` does nothing; a Redis error passes and
  warns.
- [x] A real-Redis test (skipped when unreachable): two requests in one window count 2 and the key carries a TTL.
- [x] `src/deployment-chart.test.ts` pins the mode mapping structurally and that `values.yaml` says `observe`.
- [x] `Chart.yaml` is 0.0.4.
- [x] Mark completed (`app.ts` does not read `rateLimit` yet; Task 5 wires it when it mounts the routes)

### Task 5: Mount the limiter and the in-flight upload cap

**Files:** the four routes in decision 7; `src/rate-limit/` for the cap.

- [x] Route tests: a refused upload never reaches multer (no `req.file`, no buffer); the counter is released on finish
  and on error.
- [x] A dashboard view, a worklist tab and a saved-query link without `q` do not count; `GET /deed-polls?q=Smith` does.
- [x] The cap enforces in every mode.
- [x] Mark completed (mounted by `mountAbuseLimits` in `src/rate-limit/routes.ts`, called from `app.ts` ahead of the
  router, rather than in the page's `POST` array: the limiter needs the Redis client `createApp` connects. The order
  is the same, cap then limiter then multer, and `app.test.ts` pins it. The cap's count is per `createApp`, which is
  per pod, and `rateLimit.uploadInFlight` ← `RATE_LIMIT_UPLOAD_IN_FLIGHT`)

### Task 6: Documentation

- [x] `CLAUDE.md`: a short section on the limiter. Cover that api is authoritative; that admin fails open; what 429
  and 409 each mean here; the order rule (the cap and limiter before multer); and that Gazette's 429 stays an unknown
  outcome.
- [x] Mark completed

## Post-Completion

Manual, not for this run:

- Deploy to AAT in `observe`, alongside api, and check `rate_limit … mode=observe` lines from both under deliberate
  load.
- Check the 429 page in a browser by setting a bucket's limit to 1 in a local `enforce` run.
- Tune and enforce together with api (OWASP plan 06 Task 11).
