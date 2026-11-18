# Plan: Delivery Manager permanent application deletion — Admin

## Overview

Status: planned, 2026-11-18. Steve confirmed permanent deletion of applications created in error or duplicated,
with the reason retained in the audit trail. Do not implement voiding, archiving or a retained read-only application.

Add a Delivery Manager-only action on the application detail page, a reason/confirmation page and a deletion
progress page. API owns permission, eligibility, permanent cleanup, idempotency and audit. Admin never deletes
data directly and never reports an accepted deletion request as completed deletion.

**Prerequisite:** `deed-poll-api:docs/plans/20261118-dm-application-deletion.md`, implemented, reviewed and merged.
The API plan proposes durable asynchronous deletion and publishes the contract before this plan consumes it.
Deploying Admin additionally requires that API contract on every target replica and verified cleanup activation.

## Context

Planning baseline: Admin `origin/master` `17b28c7`, API `origin/master` `35bf235`. Fetch/rebase onto current master
and record execution SHAs. Work in this repository only; the API plan runs independently in its own checkout.
Read `CLAUDE.md` in full, `.claude/rules/{backend,frontend,testing,e2e-testing}.md` and:

- `src/pages/deed-polls/[id].ts`, `detail.njk` and their handler/template tests: application detail and tab rendering.
- `src/pages/deed-polls/queries/[queryId]/delete.ts` and `queries/delete.njk`: the existing confirmation pattern.
- `src/auth/{require-role,current-user,same-origin}.ts`, `src/app.ts` and `app.test.ts`: session/capability gates,
  authenticated caller forwarding and the global browser write protection. There is no need to invent a CSRF scheme.
- `libs/deed-poll/src/auth/capabilities.ts`, `libs/deed-poll-api-client/src/mock/caller-access.ts` and tests:
  API `/me` grants UI access. Existing sessions refresh grants at token refresh or sign-in.
- `libs/deed-poll-api-client/{openapi.json,SPEC-PROVENANCE.md}`, `src/api/{client,wire}.ts` and
  `contract.test.ts` within that library. Refresh the generated spec, never hand-write a desired endpoint into it.
- `libs/deed-poll/src/deed-poll/service.ts`, `src/api/deed-poll-api.ts` and `src/errors.ts` within that library:
  the adapter/domain/page boundary and existing typed 400/403/404/409/unavailable handling.
- `src/gazette/` and the Gazette batch pages: a request key must survive failed/lost responses and independent
  tabs. Reuse the principle, not the Gazette's publication-specific state machine.
- `e2e-tests/playwright.referrals.config.ts`, associated fixture/server configuration and journey tests:
  private ports/mock data, local IDAM, Redis and axe checks. `scripts/extract-welsh-strings.mjs` for new copy.

The current UI/client/domain deliberately have no application delete. The API's existing short-form local delete
is insufficient: its companion plan adds remote cleanup and a reason-bearing actor audit before this feature ships.

## Development Approach

### Behaviour and contract

Use API's published `DELETE_APPLICATION` capability; only Delivery Managers receive it. Do not derive this from
`admin`, a role substring, or another privilege such as Gazette access. API still enforces every request.

Proposed API contract, to be checked against the merged generated spec in Task 1:

- `POST /caseworker/cases/{id}/deletion-requests`, UUID `Idempotency-Key`, body `{ reason, expectedModifiedOn }`, 202 with
  `{ requestId, status }`. Reasons `CREATED_IN_ERROR` and `DUPLICATE`, mandatory; no free text or duplicate target.
- `GET /caseworker/application-deletions/{requestId}` gives identifiers, reason, timestamps, status and optional
  allowlisted failure code. Statuses `Pending`, `InProgress`, `NeedsAttention`, `Completed`.
- Both require the capability. API rejects protected/unsafe deletion with 409; unknown IDs 404. Repeating the
  original key/body retrieves the same request even when the application has already gone.

If the merged contract differs, reconcile the plan/client with that contract and document the delta before writing
pages. Never ship a mock-only route or a guessed request shape.

### Journey

1. The detail page shows **Delete application** to capability holders only, linking to
   `/deed-polls/{id}/delete`. Do not copy API eligibility rules into Admin or infer eligibility from dates/status.
2. GET confirmation loads the application once and shows its reference and enough existing identity context to
   distinguish it, following current detail-page privacy rules. Require one reason radio: **Created in error** or
   **Duplicate application**, with neither preselected. Warn that deletion permanently removes the application
   and associated records/documents, cannot be undone, and retains an audit record of who deleted it and why.
   Provide a warning-styled **Permanently delete application** submit and Cancel returning to the application.
   Do not promise deletion of externally delivered emails or backups, or display database/storage implementation detail.
3. Bind a UUID key, application ID and its authoritative `modifiedOn` timestamp to that rendered confirmation using
   the repository's signed/session-bound form approach; send the timestamp as `expectedModifiedOn`. API refuses a
   first admission if the application changed since review. Carry the exact key/body through retries and independent tabs. A changed reason after an uncertain
   submission must not generate a new request. Invalid/forged journey state causes no write.
4. POST validates reason and explicit confirmation, then calls API with the original key. 202 redirects with 303
   to `/deed-polls/deletions/{requestId}`. Page routes use encoded IDs. Cancel/GET never writes.
5. Status GET reads only the deletion resource, so it still works after the application is gone. Pending/InProgress
   says deletion is in progress; NeedsAttention says it has not completed and needs investigation. Both offer
   Refresh and Back to applications, no new-delete/resend/cancel button. Completed alone says **Application deleted**
   and displays the reason and completion time. It does not attempt to reload the deleted application.
6. A timeout/transport failure admitting a request is an **unknown outcome**. Preserve the original signed request,
   reason and key and offer **Check deletion request**, which replays only that same POST. Do not interpret a later
   case GET 404 as completion, silently retry with a new key, or claim nothing happened. Existing API authentication
   expiry/sign-in behaviour still applies; if recovery state is lost, give investigation guidance without a new-key
   action. The durable API request remains recoverable independently of the browser.
7. A definite 400 preserves valid input/key and maps reason errors to its field; unknown/unplaceable API fields use
   page-owned wording. A 409 shows page-owned refusal/reload guidance and no automatic resubmit. A 403 follows the
   existing forbidden flow, a definite unknown application/request 404 the existing not-found flow. Status-read
   failures visibly say progress could not be checked, without changing the known operation outcome.

New copy uses the repo's `en`/`cy` convention and extraction workflow; untranslated text is recorded honestly.
The reason codes are audit data; translated labels belong in the page. API writes the audit, not this app's logs
or session. A standalone audit browser, bulk deletion, restoration, routine retention disposal and refunds are out
of scope. Historic or permanently retained/Gazette-protected eligibility remains API's decision.

## Validation Commands

Run from this repository root. Baseline before changes; focused meaningful suites after each task, plus:

```bash
yarn lint
yarn build
git diff --check
```

Install with `yarn install --immutable` at setup. Before handoff run:

```bash
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
yarn test:coverage
yarn npm audit --recursive --environment production
```

Redis must be running for the session suites; record executed/skipped counts, do not call a skipped suite passed.
Run builds/tests in the foreground. Use a dedicated private-port browser config for the new journeys; never reset
a shared developer mock or run a destructive test against a deployed environment. Regenerate Welsh extraction;
`welsh:check` may report untranslated existing copy, which is an inventory result rather than an invented translation.
Record changed-code coverage and keep the existing Sonar thresholds. No production dependency exceptions added
merely to obtain a green check.

## Implementation Steps

### Task 1: Consume the merged API contract and capability

**Files:** `libs/deed-poll-api-client/{openapi.json,SPEC-PROVENANCE.md}`, its API client/wire/contract tests,
mock routes/store and capability fixtures; `libs/deed-poll/src/auth/capabilities.ts` and export indexes.

- [ ] Record execution baselines and the API merge/spec SHA/hash. Compare the complete generated contract delta;
  account for every changed operation/schema, including unrelated intervening changes, before refreshing it.
- [ ] Add admission/status operations, reason/status validation and typed errors through the existing adapter.
  Add `DELETE_APPLICATION` to capability parsing and the mock's Delivery Manager grants only.
- [ ] Implement mock admission/replay/status/guards and explicit deterministic test controls for completion and
  unknown outcomes, with no production-accessible test controls. No real remote deletion in the mock.
- [ ] Test spec equality, encoded IDs, closed body/key validation, role denials, same-key replay after removal,
  conflicting reason, status after disappearance and no applicant data in status. Run focused library tests.

### Task 2: Add deletion domain services and recoverable confirmation state

**Files:** new `libs/deed-poll/src/deletion/{service,schemas}.ts`, library export index, new
`src/application-deletion/` journey module and co-located tests. Read existing Gazette journey seams first.

- [ ] Add functions that forward only caller token, case/key/reason/confirmation timestamp or request ID through `callApi`. Validate form
  reason against API's enum; reject missing/repeated/object-shaped controls rather than stringifying them.
- [ ] Bind case/key/original timestamp/confirmed body to tamper-resistant journey state. Keep independent tabs independent and preserve
  the original state on lost responses; a recovery action cannot edit the body or mint a replacement key.
- [ ] Test expiry, tampering, cross-case/session replay, reason changes, double submits, unavailable API and a repeat
  after application deletion. Keep audit attribution exclusively in API.

### Task 3: Build the gated confirmation, status and unknown-outcome pages

**Files:** new `src/pages/deed-polls/[id]/delete.ts`, confirmation template, new deletion status/recovery routes
under `src/pages/deed-polls/deletions/`, `src/app.ts`, gate tests, co-located handler/template tests.

- [ ] Add explicit capability gates covering parameterised confirmation and fixed status/recovery paths, after
  authentication. Prove route matching does not treat `deletions` as a case ID or interfere with other case pages.
- [ ] Implement the journey and error states above, status codes/303 redirects, no-store behaviour and same-origin
  protection. The only initial write requires the literal confirmation action; Cancel writes nothing.
- [ ] Test both locales, all reason/error/progress states, refusal with no new write, audit-safe text, XSS escaping,
  keyboard-accessible warning form, and every error-summary target. Status survives a deleted case and failed reads.

### Task 4: Link from application detail and prove the complete browser journey

**Files:** `src/pages/deed-polls/[id].ts`, `detail.njk`, associated tests, new
`e2e-tests/tests/application-deletion.spec.ts` and dedicated Playwright configuration/fixtures.

- [ ] Show the action only for capability holders without extra eligibility calls. A stale session without the
  capability has no link and forged requests still meet API enforcement; document sign-in/refresh behaviour.
- [ ] Drive both reasons from application detail through confirmation to actual mock removal and Completed;
  verify absence from search/worklists and old links, and that another application/duplicate target survives.
- [ ] Cover Cancel, wrong-role direct URL/POST, stale-confirmation API409, audit failure represented as rejection, lost admission
  response followed by same-key recovery, persistent NeedsAttention and failed status reads. Never claim remote
  permanent cleanup from a browser mock result; that proof belongs to the API plan.
- [ ] Run the isolated journeys with local IDAM/Redis, include axe and keyboard checks, and record browser results.

### Task 5: Validate, document and hand off the feature

**Files:** changed files, `README.md`, `CLAUDE.md`, generated Welsh extraction and this plan.

- [ ] Run the full validation/coverage/audit gates and focused browser suite; record exact commands/results and
  outstanding environment prerequisites. Do not weaken global coverage or mock away the meaningful failure cases.
- [ ] Update current guidance that no delete consumer exists. Document permanent deletion, the two reasons,
  capability, progress/recovery behaviour, API refusals and API-owned audit. Preserve old decisions as history and
  record Steve's 2026-11-18 supersession explicitly. Regenerate translation inventory.
- [ ] Prepare a reviewable release note requiring API compatibility on all replicas and its cleanup rehearsal/
  activation evidence before Admin exposure. Record the spec provenance and deployment order; no live delete or
  deployment is part of executing these implementation tasks. Move to completed only after review finishes.

## Success criteria

A Delivery Manager can deliberately confirm permanent deletion with either reason, cancel without a write and
track a request without creating a second one. Other roles have no action and API rejects forged requests. Only
API-confirmed Completed is labelled deleted; unknown/partial outcomes remain explicit and recoverable. The audit
reason and actor survive in API after application data is gone. There is no retained voided application or local
Admin data access layer.

## Execution notes

Not started. No tests, API contract refresh, browser journey, implementation or deployment has run for this plan.
Record baselines, per-task validation, merged API artifact and review findings here.

## Post-Completion

Deploy API and verify its permanent-cleanup prerequisites before Admin exposure. Any environment rehearsal uses
disposable fixtures under its own execution authority; keep local test evidence distinct from external deletion proof.
