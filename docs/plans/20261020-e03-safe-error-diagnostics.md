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

- [ ] Trace malformed-JSON and schema-mismatch failures through `ApiResult` into the domain error.
      Inventory the diagnostics built from request paths within this client.
- [ ] Add failing tests using a real local HTTP response and synthetic markers in `q`, structured
      `where`, encoded characters and other query keys. Cover malformed JSON and valid JSON with the
      wrong schema. Assert markers are absent from error messages and nested diagnostic properties.
- [ ] Replace unsafe context with fixed operation labels or sanitized paths before constructing errors.
      Preserve method/status/schema context without serializing payload values.
- [ ] Assert the outgoing API request still contains the intended encoded search/filter values and
      retains existing call counts, result types and status mapping.
- [ ] Cover unusual/malformed diagnostic path input and fragments if the helper accepts them. Keep the
      fallback fixed and safe; a sanitization exception must not log the original input.
- [ ] Run focused tests and all Validation Commands; record red/green evidence.

### Task 2: Remove request values from authentication refusals

**Files:** `src/auth/same-origin.ts`, `src/auth/require-role.ts`, their colocated tests,
`src/errors.test.ts`; inspect `requireCapability` in `src/auth/require-role.ts` and the existing
security-event helper.

- [ ] Add failing tests for CSRF and judicial refusals carrying synthetic sensitive query values.
      Exercise both middleware and `domainErrorHandler`, capturing actual logged arguments.
- [ ] Replace `originalUrl` interpolation with safe route/operation context. Replace raw origin and
      fetch-metadata values in refusal prose with bounded reasons; ensure the error object is safe
      before it reaches any sink.
- [ ] Cover cross-origin, same-site and malformed-header refusal paths already supported by the code.
      Assert origin/header markers and control characters do not reappear in logs or exception text.
- [ ] Retain response status, render target, allow/refuse decisions, authenticated-area boundaries and
      existing security event names/counts. Keep useful method and refusal reason information.
- [ ] Run focused tests and all Validation Commands; record results.

### Task 3: Verify final exception and logging boundaries

**Files:** `src/errors.test.ts` and an app integration test outside `src/pages` if needed; client/domain
tests and monitoring tests only where the traced boundaries require coverage.

- [ ] Exercise an API parse failure through the actual domain conversion and configured generic error
      logging path using local HTTP and synthetic data. Assert markers are absent from final console/
      logger arguments, error message, stack and any attached cause inspected by that sink.
- [ ] Cover both malformed JSON and schema mismatch, plus CSRF and judicial refusals through their
      actual final handler. Do not substitute a test logger that silently sanitizes otherwise unsafe data.
- [ ] Verify logging retains enough fixed context to distinguish the operation and failure category;
      assertions must not merely disable logging or replace every error with an indistinguishable string.
- [ ] Search adjacent diagnostic construction in the touched modules for raw URL/header/body values,
      trace the sinks and account for remaining occurrences. Keep unrelated log redesign out of scope.
- [ ] Retain existing telemetry URL-redaction tests. Record that this proves the exercised application
      diagnostics, not a comprehensive audit of every external telemetry processor.
- [ ] Run focused tests and all Validation Commands; record results.

### Task 4: Document the diagnostic contract and handoff

**Files:** `CLAUDE.md` or the existing logging guidance, and this plan's Execution notes.

- [ ] Document safe diagnostic inputs and the distinction between bounded/control-cleaned text and
      removal of sensitive values. State that request query values and raw headers never belong in
      these error messages.
- [ ] Record starting/final commits, changed files, exercised sink paths, synthetic-marker evidence,
      test counts and skips. Do not paste real applicant data, tokens or raw production logs.
- [ ] Run all Validation Commands and hand off to Ralphex review phases. Record review findings and
      revalidation for any fixes.

## Acceptance Criteria

- Synthetic sensitive markers are absent from messages and final logs for both API parse failures,
  CSRF refusals and judicial refusals.
- Query/header value removal is independent of parameter names and covers encoded search values.
- Useful safe operation/failure context remains, and status, security decisions and API requests
  preserve their existing behaviour.
- No new logging framework, app-to-library dependency inversion or production data access is introduced.

## Execution notes

Planning only, 20 October 2026. Ellis authored this plan from review finding E03. No implementation,
new validation run or Ralphex execution has been performed for this plan. Append execution evidence here.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Any production telemetry investigation or historical
log handling is a separate task. Move this plan to `docs/plans/completed/` only after implementation
and review. Do not start Ralphex as part of authoring this plan.
