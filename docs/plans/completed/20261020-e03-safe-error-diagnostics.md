# Plan: keep sensitive request values out of error diagnostics

## Overview

Address review finding **E03 (Medium)**: case-list search values enter API parse-error messages, and
CSRF/judicial refusals copy the original request URL into logged errors. Replace those diagnostic
inputs with bounded, safe operation context while preserving useful failure information.

## Context

Reviewed baseline: `649c30e01870abe2b57be43d6c17a02fbfffad72` on admin `origin/master`.
Read `CLAUDE.md` and applicable `.claude/rules/` before implementation. Record the execution baseline
and recheck these paths there. Use an isolated feature worktree on the intended integration branch;
the authoring checkout is the older `fix/api-transport-tls` branch and must not be repurposed.

Relevant paths:

- `libs/deed-poll-api-client/src/api/client.ts`: `parseResponse` includes the full request path in
  malformed-JSON and schema-mismatch errors; list paths can contain `q` and `where`.
- `src/auth/same-origin.ts` and `src/auth/require-role.ts`: refusals include `req.originalUrl`.
  Inspect refusal reasons too: raw origin/header text can reintroduce submitted values.
- `src/errors.ts` and the starter's generic error handler: final logging boundaries.
- `libs/cloud-native-platform/src/monitoring/`: URL span redaction exists, but does not sanitize
  arbitrary error messages or console strings. `forLog` bounds text and strips controls; it is not a
  privacy filter.

The review reproduced synthetic search markers in an API schema error and a final CSRF-refusal log.
It did not inspect production telemetry or establish that real applicant data has been logged.
Optional evidence lives in workspace `local-notes/deed-poll-admin/20261020-ellis-review-evidence/`;
tests must remain portable without those files.

## Development Approach

1. Use fixed operation/route labels where practical. Where a request path is necessary, remove query
   and fragment data before composing the error; do not copy arbitrary absolute URLs or raw headers.
   Prefer a tiny pure helper at the owning boundary over a generic logging framework.
2. Keep HTTP method, operation, safe status and bounded schema-field information. Do not include
   request/response bodies, search expressions, raw provider diagnostics, tokens or origin strings.
   For CSRF reasons, use fixed descriptions or existing bounded reason codes.
3. Apply the same policy to error messages and the final logging path. Telemetry URL redaction alone
   cannot repair an exception that already embeds sensitive values. Avoid global console monkey
   patching or a blacklist of known query parameter names.
4. Preserve error classes, response status/rendering, CSRF decisions, judicial gating and the existing
   security event vocabulary. Redaction must never change what request is sent to the API.
5. Respect package boundaries: the API client cannot import app helpers. Reuse an existing suitable
   package-local utility or add a minimal one. Do not create a cross-package dependency for a trivial
   transformation or modify shared starter logging unless the traced sink requires it.
6. Work test first and preserve others' changes. Record the starting commit and use local task commits
   as appropriate. Publication, merging, deployment and retrospective production-log cleanup are
   outside this implementation plan.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis; record actual counts, failures and skipped tests. Establish
a baseline first, distinguish unrelated failures and inspect formatting diffs. Use focused Vitest
tests during red/green work, running library tests through their package's existing test command when
necessary. Do not send synthetic payloads to a live API or inspect production logs.

## Implementation Steps

### Task 1: Remove sensitive values from API response errors

**Files:** `libs/deed-poll-api-client/src/api/client.ts`, its colocated tests, and a package-local
diagnostic helper/test only if needed. Read the domain error conversion in
`libs/deed-poll/src/api/deed-poll-api.ts`.

- [x] Trace malformed-JSON and schema-mismatch failures through `ApiResult` into the domain error.
      Inventory the diagnostics built from request paths within this client.
- [x] Add failing tests using a real local HTTP response and synthetic markers in `q`, structured
      `where`, encoded characters and other query keys. Cover malformed JSON and valid JSON with the
      wrong schema. Assert markers are absent from error messages and nested diagnostic properties.
- [x] Replace unsafe context with fixed operation labels or sanitized paths before constructing errors.
      Preserve method/status/schema context without serializing payload values.
- [x] Assert the outgoing API request still contains the intended encoded search/filter values and
      retains existing call counts, result types and status mapping.
- [x] Cover unusual/malformed diagnostic path input and fragments if the helper accepts them. Keep the
      fallback fixed and safe; a sanitization exception must not log the original input.
      (The helper is a private `String.search`/`slice` over a `string` and cannot throw; fragments are
      covered by cutting at `?` or `#`, and an encoded `?`/`#` inside an id stays in the path.)
- [x] Run focused tests and all Validation Commands; record red/green evidence.

### Task 2: Remove request values from authentication refusals

**Files:** `src/auth/same-origin.ts`, `src/auth/require-role.ts`, their colocated tests,
`src/errors.test.ts`; inspect `requireCapability` in `src/auth/require-role.ts` and the existing
security-event helper.

- [x] Add failing tests for CSRF and judicial refusals carrying synthetic sensitive query values.
      Exercise both middleware and `domainErrorHandler`, capturing actual logged arguments.
- [x] Replace `originalUrl` interpolation with safe route/operation context. Replace raw origin and
      fetch-metadata values in refusal prose with bounded reasons; ensure the error object is safe
      before it reaches any sink.
- [x] Cover cross-origin, same-site and malformed-header refusal paths already supported by the code.
      Assert origin/header markers and control characters do not reappear in logs or exception text.
- [x] Retain response status, render target, allow/refuse decisions, authenticated-area boundaries and
      existing security event names/counts. Keep useful method and refusal reason information.
- [x] Run focused tests and all Validation Commands; record results.

### Task 3: Verify final exception and logging boundaries

**Files:** `src/errors.test.ts` and an app integration test outside `src/pages` if needed; client/domain
tests and monitoring tests only where the traced boundaries require coverage.

- [x] Exercise an API parse failure through the actual domain conversion and configured generic error
      logging path using local HTTP and synthetic data. Assert markers are absent from final console/
      logger arguments, error message, stack and any attached cause inspected by that sink.
- [x] Cover both malformed JSON and schema mismatch, plus CSRF and judicial refusals through their
      actual final handler. Do not substitute a test logger that silently sanitizes otherwise unsafe data.
- [x] Verify logging retains enough fixed context to distinguish the operation and failure category;
      assertions must not merely disable logging or replace every error with an indistinguishable string.
- [x] Search adjacent diagnostic construction in the touched modules for raw URL/header/body values,
      trace the sinks and account for remaining occurrences. Keep unrelated log redesign out of scope.
- [x] Retain existing telemetry URL-redaction tests. Record that this proves the exercised application
      diagnostics, not a comprehensive audit of every external telemetry processor.
- [x] Run focused tests and all Validation Commands; record results.

### Task 4: Document the diagnostic contract and handoff

**Files:** `CLAUDE.md` or the existing logging guidance, and this plan's Execution notes.

- [x] Document safe diagnostic inputs and the distinction between bounded/control-cleaned text and
      removal of sensitive values. State that request query values and raw headers never belong in
      these error messages.
- [x] Record starting/final commits, changed files, exercised sink paths, synthetic-marker evidence,
      test counts and skips. Do not paste real applicant data, tokens or raw production logs.
- [x] Run all Validation Commands and hand off to Ralphex review phases. Record review findings and
      revalidation for any fixes. (Validation run and recorded below; the review phases run after this task
      loop, and their findings and revalidation are recorded by those phases.)

## Acceptance Criteria

- Synthetic sensitive markers are absent from messages and final logs for both API parse failures,
  CSRF refusals and judicial refusals.
- Query/header value removal is independent of parameter names and covers encoded search values.
- Useful safe operation/failure context remains, and status, security decisions and API requests
  preserve their existing behaviour.
- No new logging framework, app-to-library dependency inversion or production data access is introduced.

## Execution notes

Ellis authored this plan from review finding E03 on 20 October 2026. Status: implemented on
`fix/e03-safe-error-diagnostics` (Tasks 1-4 complete, evidence below); Ralphex review and Steve's review are
pending, so the plan stays in `docs/plans/` until then.

### Task 1 evidence (20 October 2026)

Starting commit `c9d8da0` on `fix/e03-safe-error-diagnostics`. Inventory: in
`libs/deed-poll-api-client/src/api/client.ts` a request path reached a diagnostic in `parseResponse`
(malformed JSON and schema mismatch, reached from `request` and `gazetteRequest`) and in `download`'s
no-body message (no query on any download path). `callApi` wraps each into
`deed-poll-api call failed (invalid-response): <message>`. Non-2xx messages are api's own prose or a fixed
`deed-poll-api answered <status>` and carry no request path. Fix: a private `withoutQuery` cuts the path at
the first `?` or `#` before `parseResponse` composes either message; method, status and schema issue paths
are kept. Red: 3 of 6 new tests failed with the full query (`q`, repeated `where`, `filter`, `sort`, paging,
and Gazette/judicial paging) in the message; the encoded-id case already passed. Green: client suite
158/158. Validation: lint clean (one Biome schema-version info), build 8/8, tests app 2351,
deed-poll 1204, api-client 784, cloud-native-platform 157, express-govuk-starter 127, simple-router 41,
express-session-postgres 23, express-session-redis 7; no failures, no skips (`REDIS_URL` set).

### Task 2 evidence (20 October 2026)

Starting commit `29167e1`. `requireSameOrigin` built `${method} ${originalUrl}` plus the raw `Sec-Fetch-Site`
or `Origin` text; `requireJudicial` built `${originalUrl}`; `requireCapability` built `${req.path}`, which under
its `/deed-polls/gazette` mount lost the area prefix (`/history requires ACCESS_GAZETTE`). All three now use
`${method} ${baseUrl}${path}`, the route the security event already records, and the CSRF prose is fixed:
`from a same-site|cross-site initiator`, `from an unrecognised Sec-Fetch-Site value`, `from a cross-origin
Origin`. Bounded `fetchSite`/`originHost` details, reasons, statuses, the 404 view and event names are
unchanged. Red: 8 middleware tests (query markers in `q`, structured `where`, other keys and a fragment;
marker/CR/LF/ANSI header values; unparseable and pathful origins) and 5 supertest journeys through
`domainErrorHandler` with the gates mounted as `app.ts` mounts them, which capture the actual
`console.error` arguments and `trackEvent` calls. Green: 57/57 middleware, errors suite 29/29.
Validation: lint clean (one Biome schema-version info), build 8/8, tests app 2364, deed-poll 1204,
api-client 784, cloud-native-platform 157, express-govuk-starter 127, simple-router 41,
express-session-postgres 23, express-session-redis 7; no failures, no skips (`REDIS_URL` set).

### Task 3 evidence (20 October 2026)

Starting commit `7a5840a`. New `src/error-diagnostics.test.ts` mounts the chain `app.ts` mounts — `requireSameOrigin`,
the `/judicial` and `/deed-polls/gazette` gates, a page calling the real `findDeedPolls`, `domainErrorHandler`, then
the starter's real `errorHandler()` on the real `console` — against a local `node:http` api. A recording error
middleware before the handlers captures the thrown error so its message, stack, `util.inspect` (own properties) and
`cause` are checked alongside every `console.error` argument and `trackEvent` call. Malformed JSON and a
wrong-shape body (itself carrying a marker) reach `errorHandler` as `Error:` with
`deed-poll-api call failed (invalid-response): GET /caseworker/cases returned …`, distinguishing operation and
category; CSRF (cross-site, unrecognised `Sec-Fetch-Site`), judicial and Gazette refusals end at the single
`forbidden: <METHOD> <route> <reason>` line and never reach `errorHandler`. The api still receives the encoded `q`,
the `where` condition and `filter`. Red: with `withoutQuery` disabled and the pre-fix `require-role.ts` restored,
4 of 7 failed (both parse failures, judicial and Gazette); CSRF prose was already covered by Task 2. Sweep of the
touched modules: `download`'s `GET ${path} returned no body` (download paths carry no query), transport errors
(fixed text), the readiness line (`/health/liveness`), `failureFromResponse` (api's own prose — api's concern, out of
scope), the 401 handler's `returnTo: req.originalUrl` (a render back to the user, not a log) and the schema issue
paths (`z.record` keys are field-rule and template placeholder names, not applicant data). Monitoring URL-redaction
tests are unchanged and pass. This proves the exercised application diagnostics, not every external telemetry
processor. Validation: lint clean (one Biome schema-version info), build 8/8, tests app 2371, deed-poll 1204,
api-client 784, cloud-native-platform 157, express-govuk-starter 127, simple-router 41,
express-session-postgres 23, express-session-redis 7; no failures, no skips (`REDIS_URL` set).

### Task 4 evidence (20 October 2026)

Starting commit `adab07e`; the final commit is this task's, the branch head of `fix/e03-safe-error-diagnostics`.
`CLAUDE.md`'s Security events section now states the contract beside `forLog`: safe inputs are method,
`baseUrl + path`, fixed operation/reason phrases, status and schema field paths; query values and raw headers never
enter an error message; `forLog` bounds and control-cleans text but removes nothing sensitive. Changed files from
`c9d8da0`: `libs/deed-poll-api-client/src/api/client.ts` and `client.test.ts`, `src/auth/same-origin.ts` and
`same-origin.test.ts`, `src/auth/require-role.ts` and `require-role.test.ts`, `src/errors.test.ts`, the new
`src/error-diagnostics.test.ts`, `CLAUDE.md` and this plan. Exercised sinks: `parseResponse` → `callApi` →
the starter's `errorHandler` `console.error`; the three gates → `domainErrorHandler`'s single `forbidden:` line and
`trackEvent`. Synthetic markers only (no real applicant data, tokens or production logs). Validation: lint clean (one
Biome schema-version info), build 8/8, tests app 2371, deed-poll 1204, api-client 784, cloud-native-platform 157,
express-govuk-starter 127, simple-router 41, express-session-postgres 23, express-session-redis 7; no failures, no
skips (`REDIS_URL` set).

### Verification before PR (20 October 2026, Arbor)

- Merged admin `origin/master` `f4340f1` (E02 #205, E04 #208) into the branch, cleanly.
- On the merged tree: `yarn lint` exit 0; `yarn turbo build build:app --force` exit 0;
  `yarn turbo test test:app --concurrency=1 --force` exit 0: 222 files, 4,875 tests, none failed or skipped.
- Direct scoped Copilot review (gpt-6-astra, read-only; 45 tool calls across `client.ts`, `deed-poll-api.ts`,
  `same-origin.ts`, `require-role.ts`, `errors.ts` and the diagnostics tests): no issues found.
- Checked separately: every path segment `client.ts` builds is an id, a Gazette batch id or an email template name,
  so cutting the query and fragment leaves no search text in a diagnostic.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Any production telemetry investigation or historical
log handling is a separate task. Move this plan to `docs/plans/completed/` only after implementation
and review. Do not start Ralphex as part of authoring this plan.
