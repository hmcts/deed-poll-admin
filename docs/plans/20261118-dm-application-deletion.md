# Plan: Delivery Manager permanent application deletion — Admin

## Overview

Status: planned, 2026-11-18. Steve confirmed permanent deletion of applications created in error or duplicated,
with the reason retained in the audit trail. Do not implement voiding, archiving or a retained read-only application.

**Steve's answers, 2026-11-18 (review by Aspen):** for applications created in error, now that prod creates cases again
(api#174); CCD removal goes through Retain and Dispose; documents are deleted permanently; a **mandatory free-text
reason** is required as well as the reason code; no re-import protection. The API plan carries the detail.

**Steve's answers, 2026-11-19 (api plan 20261119-deletion-grace-period-and-restore):** a confirmed deletion is a
**soft delete for a grace period** (default 14 days, a Delivery Manager process setting, 1–90), during which a
**Delivery Manager alone can restore** the application. Nothing permanent happens before then. The stale check compares
the case detail's `lastChangedOn`, not `modifiedOn`. There is no admission on/off switch in api; the capability is
the gate (Steve, 2026-11-19).

**Updated 2026-11-25 by Aspen against the merged api (api#175, `576d559`).** Sections marked *(merged contract)*
replace the proposals they superseded; where this plan and api's published spec disagree, the spec wins.

Add a Delivery Manager-only action on the application detail page, a reason/confirmation page, a deletion
progress page with a restore action during the grace period, and the grace period on the settings page. API owns permission, eligibility, permanent cleanup, idempotency and audit. Admin never deletes
data directly and never reports an accepted deletion request as completed deletion.

**Prerequisite (met):** api#175 merged to master as `576d559` on 2026-11-25 and deployed (worker and Retain and
Dispose switched off). api#178 (test-only) may follow; it does not change the contract. Read api's
`docs/APPLICATION-DELETION.md` ("HTTP contract", "Grace period and restore") as the specification.
**Admin ships deletion before cleanup is activated** (Steve, 2026-11-25): the business can delete applications
created in error now, and the permanent removal is caught up once the cleanup worker and Retain and Dispose are on.
Until then a request stays `Pending` after its restore date, so the status page must say that honestly (step 5).

## Context

Planning baseline: Admin `origin/master` `a447d8f` (re-check at execution), API `origin/master` `576d559`. Fetch/rebase onto current master
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

**Overlap:** admin#421 (Yarrow, Team leader Gazette access) edits `caller-access.ts` and the personas. Rebase onto
master after it merges; add `DELETE_APPLICATION` to the mock's Delivery Manager grants on its own line.

The current UI/client/domain deliberately have no application delete. The API's existing short-form local delete
is insufficient: its companion plan adds remote cleanup and a reason-bearing actor audit before this feature ships.

## Development Approach

### Behaviour and contract *(merged contract)*

Use API's published `DELETE_APPLICATION` capability; only Delivery Managers receive it. Do not derive this from
`admin`, a role substring, or another privilege such as Gazette access. API still enforces every request.

The contract, as merged (api `docs/APPLICATION-DELETION.md`; check it against the refreshed `openapi.json` in Task 1):

- `POST /caseworker/cases/{id}/deletion-requests`, required UUID `Idempotency-Key`, closed body
  `{ reason, note, expectedLastChangedOn }`: `reason` `CREATED_IN_ERROR` or `DUPLICATE`; `note` 10–500 characters
  after trimming, no control characters; `expectedLastChangedOn` the case detail's **`lastChangedOn`** exactly as
  published (ISO-8601 local date-time, compared to the millisecond). 202 `{ requestId, status, restorableUntil }` with
  `Location`, for a fresh admission and every replay. 413 over 16 KB; 415 unless JSON.
- `GET /caseworker/application-deletions/{requestId}`: 200 `{ requestId, caseId, reason, status, requestedAt,
  restorableUntil, completedAt, failure }`, whether or not the case still exists. No note, requester or key. Statuses
  `Pending`, `InProgress`, `AwaitingDisposal`, `NeedsAttention`, `Completed`; `failure` (a `DeletionFailure` member) only
  on `NeedsAttention`.
- `POST /caseworker/application-deletions/{requestId}/restore`, no body: 200 `{ caseId, status: "Restored" }`; 404 for an
  unknown or already restored request; 409 `RESTORE_WINDOW_CLOSED` or `CLEANUP_STARTED`.
- Every 409 is `DeletionError { error, code }`, `code` a `DeletionRefusal` member: `STALE_CONFIRMATION`,
  `RETAINED_PERMANENTLY`, `GAZETTE_EVIDENCE`, `RETAINED_DEED_PAYLOAD`, `RETAINED_STAGED_UPLOADS`,
  `DOCUMENT_STORAGE_UNRESOLVED`, `CCD_CREATION_UNRESOLVED`, `EMAIL_SEND_UNRESOLVED`, `KEY_REUSED`, `CONFLICTING_REASON`,
  `RESTORE_WINDOW_CLOSED`, `CLEANUP_STARTED`. **The page chooses its sentence by `code`, never by api's prose**: the
  adapter must carry the code on the domain error (today `ConflictError` carries only `fieldErrors`), and an
  unknown code gets a generic page-owned refusal.
- `GET /caseworker/cases/{id}` now carries `lastChangedOn` (detail only, not on the saved-case response).
- `GET/PUT /caseworker/process-settings` carry `deletionGraceDays` (integer 1–90, default 14), optional on the PUT:
  absent leaves it alone. A change affects only requests admitted afterwards.
- All three deletion operations require the capability; every other role is 403 before anything is read.

Never ship a mock-only route or a guessed request shape.

### Journey

1. The detail page shows **Delete application** to capability holders only, linking to
   `/deed-polls/{id}/delete`. Do not copy API eligibility rules into Admin or infer eligibility from dates/status.
2. GET confirmation loads the application once and shows its reference and enough existing identity context to
   distinguish it, following current detail-page privacy rules. Require one reason radio: **Created in error** or
   **Duplicate application**, with neither preselected, and a required **Why are you deleting this application?**
   textarea. Its hint says to explain the reason and **not to include the applicant's personal details**, because the
   note is kept in the audit trail after the application is gone. Enforce API's bounds and redraw the text on errors. Say that the application disappears from the service at once, that a
   Delivery Manager can restore it until a date (the grace period, read from the process settings for display; the
   authoritative date is api's `restorableUntil` on the answer), and that after that date it is permanently removed
   with its records and documents and cannot be recovered, keeping an audit record of who deleted it and why.
   Provide a warning-styled **Permanently delete application** submit and Cancel returning to the application.
   Do not promise deletion of externally delivered emails or backups, or display database/storage implementation detail.
3. Bind a UUID key, application ID and the case detail's `lastChangedOn` to that rendered confirmation using
   the repository's signed/session-bound form approach; send it unchanged as `expectedLastChangedOn` (never
   `modifiedOn`, which misses notes, documents and referrals). API refuses a first admission with 409
   `STALE_CONFIRMATION` if anything on the application changed since review; the page says so and offers a link back
   to the application to review it again, with no automatic resubmit. Carry the exact key/body through retries and independent tabs. A changed reason after an uncertain
   submission must not generate a new request. Invalid/forged journey state causes no write.
4. POST validates reason and explicit confirmation, then calls API with the original key. 202 redirects with 303
   to `/deed-polls/deletions/{requestId}`. Page routes use encoded IDs. Cancel/GET never writes.
5. Status GET reads only the deletion resource, so it still works after the application is gone. `Pending` before
   `restorableUntil` says the application has been deleted from view and **can be restored until {date}**, and shows a
   **Restore application** button (step 8) to capability holders. `Pending` at or after that date says it can no
   longer be restored and **will be permanently removed** (no date, no claim that removal is under way, because
   cleanup may not be switched on yet); `InProgress` says permanent removal is in progress; AwaitingDisposal says the application is waiting to be removed from the case platform,
   which happens in an overnight run, so it can take until the next day; NeedsAttention says it has not completed and needs investigation,
   with a page-owned sentence per `failure` code where one helps (`CDAM_REMOVED_DOCUMENT_UNPURGED`: waiting for the
   document store team to purge previously removed documents) and a generic one otherwise. All offer Refresh and Back
   to applications, and no new-delete or resend button. Whether Restore is offered is presentation from the status
   and date; api decides. Completed alone says **Application deleted**
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

8. **Restore** is a POST from the status page (a confirmation page first: "Restore this application?", saying it
   returns to the service as it was, with nothing lost). It calls the restore operation with no body. 200 redirects
   303 to the application with a "restored" banner. 409 `RESTORE_WINDOW_CLOSED`/`CLEANUP_STARTED` redraws the status
   page from a fresh read with page-owned wording; 404 (already restored or unknown) says the request no longer exists
   and links to the application. A lost response is safe to repeat: a second restore is a 404 and the application is
   visible. After a restore, a retry of the original deletion journey is 409 `STALE_CONFIRMATION`, which the page
   renders as "the application has changed", never as a failed restore.
9. **Settings.** The grace period is a new **Application deletion** tab on `/deed-polls/settings` (Delivery Managers
   already hold `MANAGE_PROCESS_CONFIG`), with its own form and Save posting to `/deed-polls/settings/deletion#deletion`
   with only `deletionGraceDays` and the process settings' current `revision`. Whole days, 1–90, digits only (the
   referral-process parser's strictness, not `readNumericInput`). 400/409 behave as the referral-process section
   (redraw with the original revision; a conflict asks for a reload). The hint says a change affects only applications
   deleted after it. The referral-process form keeps sending its own seven fields and never `deletionGraceDays`.
   It is its own tab, not a field on the referral process form (Steve, 2026-11-25).

New copy uses the repo's `en`/`cy` convention and extraction workflow; untranslated text is recorded honestly.
The reason codes are audit data; translated labels belong in the page. API writes the audit, not this app's logs
or session. A standalone audit browser, bulk deletion, restoration after the grace period, routine retention disposal and refunds
are out of scope. Historic or permanently retained/Gazette-protected eligibility remains API's decision.

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

- [x] Record execution baselines and the API merge/spec SHA/hash. Compare the complete generated contract delta;
  account for every changed operation/schema, including unrelated intervening changes, before refreshing it.
- [x] Add admission, status and restore operations, reason/status validation and typed errors through the existing
  adapter, carrying a deletion 409's `code` on the domain error.
  Add `DELETE_APPLICATION` to capability parsing and the mock's Delivery Manager grants only.
- [x] Implement mock admission/replay/status/guards and explicit deterministic test controls for completion and
  unknown outcomes, with no production-accessible test controls. No real remote deletion in the mock.
- [x] Test spec equality, encoded IDs, closed body/key validation, role denials, same-key replay after removal,
  conflicting reason, status after disappearance and no applicant data in status. Run focused library tests.

### Task 1b: Grace period on the settings page

**Files:** `libs/deed-poll/src/settings/{schemas,service}.ts`, `src/service-settings/`, the settings page template and
tests, the mock's process settings.

- [x] Add `deletionGraceDays` to the settings read model and the mock (seed 14, bounds pinned to `openapi.json`).
- [x] Add the Application deletion tab, panel id and fragment, its form, schema and POST, as journey step 9. Prove
  the referral-process save never sends `deletionGraceDays`, and this form sends only it and the revision.
- [x] Tests: bounds and digits-only, absent/blank, 400 and 409 redraws, the gate, both locales, and the tab, panel and
  fragment pins in `index.njk.test.ts`.

### Task 2: Add deletion domain services and recoverable confirmation state

**Files:** new `libs/deed-poll/src/deletion/{service,schemas}.ts`, library export index, new
`src/application-deletion/` journey module and co-located tests. Read existing Gazette journey seams first.

- [x] Add functions that forward only caller token, case/key/reason/note/`lastChangedOn` or request ID through
  `callApi`, including restore. Validate form
  reason against API's enum; reject missing/repeated/object-shaped controls rather than stringifying them.
- [x] Bind case/key/original timestamp/confirmed body to tamper-resistant journey state. Keep independent tabs independent and preserve
  the original state on lost responses; a recovery action cannot edit the body or mint a replacement key.
- [x] Test expiry, tampering, cross-case/session replay, reason changes, double submits, unavailable API and a repeat
  after application deletion. Keep audit attribution exclusively in API.

### Task 3: Build the gated confirmation, status and unknown-outcome pages

**Files:** new `src/pages/deed-polls/[id]/delete.ts`, confirmation template, new deletion status/recovery routes
under `src/pages/deed-polls/deletions/`, `src/app.ts`, gate tests, co-located handler/template tests.

- [x] Add explicit capability gates covering parameterised confirmation and fixed status/recovery paths, after
  authentication. Prove route matching does not treat `deletions` as a case ID or interfere with other case pages.
- [x] Implement the journey and error states above, including restore's confirmation page and POST, status
  codes/303 redirects, no-store behaviour and same-origin protection. The only initial write requires the literal confirmation action; Cancel writes nothing.
- [x] Test both locales, all reason/error/progress states, refusal with no new write, audit-safe text, XSS escaping,
  keyboard-accessible warning form, and every error-summary target. Status survives a deleted case and failed reads.

### Task 4: Link from application detail and prove the complete browser journey

**Files:** `src/pages/deed-polls/[id].ts`, `detail.njk`, associated tests, new
`e2e-tests/tests/application-deletion.spec.ts` and dedicated Playwright configuration/fixtures.

- [x] Show the action only for capability holders without extra eligibility calls. A stale session without the
  capability has no link and forged requests still meet API enforcement; document sign-in/refresh behaviour.
- [x] Drive both reasons from application detail through confirmation to actual mock removal and Completed;
  verify absence from search/worklists and old links, and that another application/duplicate target survives.
- [x] Cover restore inside the grace period (the application is back on the list and detail), restore after it
  (409, page-owned sentence), Cancel, wrong-role direct URL/POST, stale-confirmation API409, audit failure represented as rejection, lost admission
  response followed by same-key recovery, persistent NeedsAttention and failed status reads. Never claim remote
  permanent cleanup from a browser mock result; that proof belongs to the API plan.
- [x] Run the isolated journeys with local IDAM/Redis, include axe and keyboard checks, and record browser results.
  (written, type-checked and listed; browser run skipped - no local IDAM or Redis in this environment, see notes)

### Task 5: Validate, document and hand off the feature

**Files:** changed files, `README.md`, `CLAUDE.md`, generated Welsh extraction and this plan.

- [x] Run the full validation/coverage/audit gates and focused browser suite; record exact commands/results and
  outstanding environment prerequisites. Do not weaken global coverage or mock away the meaningful failure cases.
- [x] Update current guidance that no delete consumer exists. Document permanent deletion, the two reasons,
  capability, the grace period and restore, the settings tab, progress/recovery behaviour, API refusals by code and
  API-owned audit. Preserve old decisions as history and
  record Steve's 2026-11-18 supersession explicitly. Regenerate translation inventory.
- [x] Prepare a reviewable release note requiring API compatibility on all replicas and its cleanup rehearsal/
  activation evidence before Admin exposure. Record the spec provenance and deployment order; no live delete or
  deployment is part of executing these implementation tasks. Move to completed only after review finishes.
  (release note in `docs/DEPLOYMENT.md#application-deletion`; the plan stays here until review finishes)

## Success criteria

A Delivery Manager can deliberately confirm deletion with either reason, cancel without a write, track a request
without creating a second one, restore it during the grace period, and set the grace period on the settings page. Other roles have no action and API rejects forged requests. Only
API-confirmed Completed is labelled deleted; unknown/partial outcomes remain explicit and recoverable. The audit
reason and actor survive in API after application data is gone. There is no retained voided application or local
Admin data access layer.

## Execution notes

Record baselines, per-task validation, merged API artifact and review findings here.

**Task 1 (2026-11-25).** Baselines: Admin `origin/master` still `a447d8f` (admin#421 not yet merged, so no rebase was
needed; re-check before Task 4's persona work), API `origin/master` `e6a84c3` (api#178, test-only: `git diff 576d559
e6a84c3` touches seven `src/test/` files). Spec generated in a clean detached api worktree at `e6a84c3`, raw SHA-256
`78570861d4e64dec501c93e80590fb5c95332fa0eb77e265ae849076af0fa49a`, parsed equal to the committed copy. Whole-document
parsed delta against `e7ee862`: three operations and five schemas added; `GET`/`PUT /caseworker/process-settings`,
`CallerAccessResponse`, `CaseDetailResponse` (`lastChangedOn`), `ProcessSettingsResponse` and
`UpdateProcessSettingsRequest` (`deletionGraceDays`) changed; nothing removed and nothing unrelated
(`SPEC-PROVENANCE.md`). Decisions: `lastChangedOn` stays api's **text** on the wire schema, because api parses
`expectedLastChangedOn` with `LocalDateTime.parse` and a re-serialised `Date` (`…Z`) would be refused. The adapter's
`deletionRequest` keeps a 409's `DeletionError.code` on `ApiError.code`, and `callApi` puts it on `ConflictError.code`
(null otherwise). The wire and mock already carry `deletionGraceDays` (seed 14, optional on the PUT) because the
refreshed contract requires it; `updateProcessSettings` still sends only its seven fields, and the admin read model,
form and its own write are Task 1b's. The mock fences an admitted case (gone from every read until restored), never
removes anything remotely, and moves a request only through `/__mock/application-deletions` (status, failure, closed
restore window) and `/__mock/application-deletion-outcome` (lost admission response, one refused admission by code,
status reads down); `Completed` drops the fenced case from memory. Validation: `yarn build` and `yarn lint` clean,
`git diff --check` clean; `libs/deed-poll-api-client` 25 files / 1616 tests passed (28 new deletion adapter tests, 5
mock-control tests, deletion contract pins, path-segment cases); `libs/deed-poll` 77 files / 1781 passed; app
`vitest run` 174 files / 3467 tests passed, 4 files / 93 tests **skipped** (the Redis session suites: no Redis was
running in this environment, so those were not run).

**Task 1b (2026-11-25).** **Spec over plan:** step 9 says the form sends only `deletionGraceDays` and the revision, but
api's `UpdateProcessSettingsRequest` requires `referralClaimExpiryMinutes` on every PUT. So the Application deletion
form also carries the stored processing window back, in minutes, as a hidden control read at the same revision: at
that revision api sees no change to it, at any other it is 409 first, and a forged or missing value is a reload with no
write. The read model is api's row (the wire already held `deletionGraceDays`, mock seed 14, from Task 1); the page
reads it **once** for both the Referral process and Application deletion tabs, so a refused save of either redraws
that section from the body and re-reads the row only for the other. The tab sits after Bank holidays, before Staff and
access, with panel id and fragment `deletion`; `POST /deed-polls/settings/deletion` (with a `GET` 302 to `#deletion`)
saves through `saveDeletionSection` (`src/service-settings/page.ts`), parsed by `deletionSettingsFormSchema`
(`libs/deed-poll/src/settings/schemas.ts`, digits only, bounds from `PROCESS_SETTINGS_LIMITS`, pinned to `openapi.json`
in Task 1). The section shows no "Last changed": api's attribution is the whole row's. Tests prove the referral-process
save drops a posted `deletionGraceDays` and the deletion save sends exactly `{ deletionGraceDays,
referralClaimExpiryMinutes, revision }`. The area gate needed no change (`app.test.ts` reads the directory). Validation:
`yarn lint` clean (Biome's existing version info), `yarn build` clean, `git diff --check` clean; `libs/deed-poll` 77
files / 1812 passed; app `vitest run` 175 files / 3498 passed, 4 files / 93 **skipped** (Redis session suites, no Redis
here). `yarn welsh:extract` added the 12 new strings, untranslated (`cy` mirrors `en`). The new `service-settings.spec.ts`
journey and the updated tab list were **not run**: no local IDAM (5556) or Redis (6316) in this environment; run
`yarn test:gazette` before Task 4's browser work.

**Task 2 (2026-11-25).** Domain: `libs/deed-poll/src/deletion/` holds `requestDeletion`, `findDeletion` and
`restoreDeletion` (each forwarding only the token and the ids, plus the key and the three body fields for an
admission) and `deletionFormSchema`, which reads `reason` against api's enum and `note` by api's rule exactly: spaces
trimmed, 10–500 code points, no control character and no lone surrogate. **A line break or tab in the note is refused,
not rewritten**, because api refuses it (`CreateDeletionRequest.note`, "no control characters but ordinary spaces") and
the note is audit text; Task 3's hint should say so. A repeated or bracketed control is refused, never stringified.
**An admission's unknown outcome is its own error:** `callDeletionAdmissionApi` (`api/deed-poll-api.ts`, beside
`callGazetteApi`) maps only a 400, 401, 403, 404 or 409 through `callApi`'s mapping, and a timeout, transport failure,
5xx, unreadable 202 or 429 to `DeletionOutcomeUnknownError` with a fixed message. Status and restore keep `callApi`. The
deletion schemas re-export `DELETION_REASON` and `DELETION_NOTE_LIMITS`, because the app does not depend on the client
package. Journey: `src/application-deletion/journey.ts`, one signed hidden `journey` control like the Gazette batch's
(HMAC over the session id, domain `application-deletion-v1`), holding the key minted at render, the case id, the
reviewed `lastChangedOn` and `issuedAt`, and, once confirmed, the reason and note. `openDeletionJourney` answers
`open`, `expired` (over 8 hours, or issued in the future) or `invalid` (forged, altered, another session, another
application, malformed); only `open` may write. `confirmDeletionJourney` leaves an already confirmed journey unchanged,
so the recovery action replays its sealed body and cannot edit it; a back-navigated form keeps its key, so a changed
reason is api's reused-key 409, never a second request. Validation: `yarn lint` clean (Biome's existing version info),
`yarn build` clean, `git diff --check` clean; `libs/deed-poll` 79 files / 1837 passed (25 new); app `vitest run` 176
files / 3508 passed (11 new), 4 files / 93 **skipped** (Redis session suites, no Redis here).

**Task 3 (2026-11-25).** One gate, `requireCapability(DELETE_APPLICATION)` on `["/deed-polls/deletions",
"/deed-polls/:id/delete"]` in `app.ts` after `requireStaff` and before the router; `app.test.ts` reads
`src/pages/deed-polls/deletions/` off the filesystem and proves the mount misses `/deed-polls/<id>`, a case's edit and
note pages and the saved-query delete. `src/application-deletion/routes.test.ts` drives the real route table:
`simple-router` sorts the static `deletions` before `[id]`, so a request id is never read as a case id. Pages:
`[id]/delete.ts` (`application-delete.njk`: form, `unknown` and `stopped` states), `deletions/[requestId].ts` (status,
drawn by `src/application-deletion/status-page.ts`, reading only the request, with `progress.ts` deciding the state)
and `deletions/[requestId]/restore.ts` (confirmation, POST). Decisions: **the restore address carries `?case=`**,
because api answers 404 for a restored request (`docs/APPLICATION-DELETION.md`), so a 404 can still link to the
application; a missing or repeated `case` is a 404 before any read. A sealed (recovery) journey replays only on
`check`, and any other action with it is a 303 back with no write. A 400 redraws the form with the **same key,
unsealed**, because api admitted nothing; its field errors are page-owned sentences, an unplaceable one on `#reason`.
The confirmation reads the process settings for "can restore it for N days" (display only, degrading to no number);
it shows the case list's fields (reference, new forename and surname, type, status, date received). A case detail
with no `lastChangedOn` offers no form (503). Restore's 200 is a 303 to `/deed-polls/{caseId}?deletion=restored`, and
the detail page draws a success banner for it (true of any case that page can render, since a deleted one is a 404).
`no-store` and same-origin protection are the global layers, unchanged. `src/application-deletion` is on the Welsh
extractor's `INCLUDE`; all new copy is untranslated (`cy` mirrors `en`). Validation: `yarn lint` clean (Biome's
existing version info), `yarn build` clean, `git diff --check` clean; app `vitest run` 184 files / 3600 passed (93 new
across 8 new test files plus the gate, banner and template additions), 4 files / 93 **skipped** (Redis session suites,
no Redis here). No browser journey was run: that is Task 4.

**Task 4 (2026-11-25).** Admin `origin/master` moved to `4d4bcd8` (admin#421, Team leader Gazette access); the branch
was rebased onto it after this task's commit (see below). The detail page draws **Delete application** (a
warning-styled button link under the case header) from `can(user, DELETE_APPLICATION)` alone, with no api read; the
href is `deletionConfirmationPath(found.id)`, so the id is encoded. Sign-in/refresh: the capability comes from the
session's `/me` answer, so a session granted or stripped of it since sign-in sees the change within one token lifetime
(or at once on signing in again); a stale session that still draws the link meets the area gate and api on the next
request, and one without it that forges the URL or POST is 403 at the gate. Browser journeys:
`e2e-tests/tests/application-deletion.spec.ts`, run by `yarn test:application-deletion`
(`playwright.application-deletion.config.ts`: mock 3220, app 3320, Redis database 6, local IDAM 5556), and excluded
from `yarn test:e2e` by the base config's `testIgnore` because they switch the mock's deletion outcomes. Seven
journeys: a duplicate deleted by keyboard (error summary targets, focus, axe), gone from search, the referral queue
and its old link while the same-named original survives, then `Completed` via the mock control as the only
"Application deleted"; Cancel, a created-in-error deletion restored (confirmation, its Cancel, the banner, back on
search), a repeated restore as the 404 "no longer exists", and the original confirmation resubmitted after the restore
as `STALE_CONFIRMATION`; a restore whose window closed while its confirmation was open (409, page-owned banner, no
Restore); a note added after review (stale), api's own `RETAINED_PERMANENTLY`, and an injected `EMAIL_SEND_UNRESOLVED`
standing for api refusing an admission it cannot complete (the plan's "audit failure represented as rejection": api
writes the audit in the admission's transaction, so a failed audit admits nothing), each with no write and no
resubmit; a lost admission response recovered by **Check deletion request** onto the same request id twice;
`NeedsAttention` with `CDAM_REMOVED_DOCUMENT_UNPURGED` over two refreshes and a 503 status read; and a Team leader
with no link and 403 on the confirmation, its forged POST, the status and the restore addresses. Welsh is not
checked in the browser: every new string's `cy` mirrors its `en`. **Not run in a browser:** no rse-idam-simulator
image or listener on 5556 and no Redis on 6379 here (the host's existing `deed-poll-redis` container was left alone).
The spec type-checks under `tsc --strict` and `playwright test --list` lists all seven; run `yarn test:application-deletion`
locally before Task 5's handoff. Nothing here proves remote permanent cleanup, which is api's. Validation: `yarn lint`
clean (Biome's existing version info), `yarn build` clean, `git diff --check` clean; app `vitest run` 184 files / 3603
passed (3 new: the link's capability and encoding, and the template's button), 4 files / 93 **skipped** (Redis session
suites, no Redis here).

**Rebase onto `4d4bcd8` (admin#421), after Task 4.** The branch was unpushed, so its nine commits were rebased. Two
conflicts, both the Delivery Manager's grants: the mock's `caller-access.ts` now inherits `ACCESS_GAZETTE` from the
Team leader (#421), so the Delivery Manager adds `MANAGE_PROCESS_CONFIG` and, on its own line, `DELETE_APPLICATION`;
`express-doubles.ts` keeps #421's Team leader with `ACCESS_GAZETTE` and adds `DELETE_APPLICATION` to the Delivery
Manager only. The rebased tree differs from the pre-rebase one by #421's files alone. Re-validated: `yarn lint` and
`yarn build` clean; app `vitest run` 184 files / 3605 passed, 4 / 93 **skipped** (Redis); `libs/deed-poll-api-client`
25 / 1616 and `libs/deed-poll` 79 / 1837 passed.

**Task 5 (2026-11-25).** Environment: this time disposable local containers were started and removed afterwards
(`redis:7-alpine` on 16379, 6379 and 6316, and the existing `rse-idam-simulator:local` image on 5556, seeded with
`yarn idam:users`), so nothing below was skipped for want of Redis or IDAM. No shared developer mock or deployed
environment was touched. Results:
- `REDIS_URL=redis://127.0.0.1:16379 yarn turbo test test:app --concurrency=1 --force`: 8 of 8 tasks; app 188 files /
  3698 tests passed with **none skipped** (the four Redis session suites, 93 tests, ran); `libs/deed-poll` 79 / 1837,
  `libs/deed-poll-api-client` 25 / 1618, the starter, router, cloud-native-platform and both session libraries passed.
- `yarn test:coverage` (same Redis): passed; app all files 80.7 % statements, 77.9 % branches, 82.08 % lines; thresholds
  unchanged. Changed code: the app's deletion files (`src/application-deletion/*`, `[id]/delete.ts`,
  `deletions/[requestId].ts`, `restore.ts`, `settings/deletion.ts`) 158 of 159 lines and 131 of 143 branches;
  `libs/deed-poll/src/deletion` 100 % in its own run.
- `yarn npm audit --recursive --environment production`: no audit suggestions, no exception added.
- `yarn lint` clean (Biome's existing version info), `yarn build` clean, `git diff --check` clean.
- `yarn test:application-deletion`: **7 of 7 passed** in Chromium, with axe and keyboard checks. The first run failed
  one journey at `page.goBack()` (`net::ERR_CACHE_MISS`): the recovery page is a no-store POST response, which a browser
  will not redisplay without resubmitting. A test fault, not an app one: the journey now resubmits the same recovery
  form from the status page, which is the second tab or double click the step is about.
- `yarn test:gazette` (Task 1b's settings journeys): 9 of 11. **It found a real defect, now fixed:** the api client's
  `updateProcessSettings` copies a fixed list of fields onto the PUT and left out `deletionGraceDays`, so the
  Application deletion tab's save sent only the processing window and revision, the mock saw no change, answered 200, and
  the page said "saved" with the grace period unchanged. Task 1b's tests stubbed the adapter and so could not see it. The
  adapter now forwards it, and two mock-driven adapter tests pin that the grace period is sent and persisted and that a
  save without it leaves it alone; the grace-period journey then passed. **The two remaining failures are pre-existing
  on master and not this branch's:** `gazette.spec.ts` (unchanged from `origin/master`, last touched in #418) expects a
  Team leader to see no Gazette link, which #421 changed, and expects a judge to reach `/deed-polls`, which
  `requireStaff` refuses. Follow-up for master, outside this plan.
- Guidance: `CLAUDE.md` has an "Application deletion" section, a "Delete applications" column in the capability table
  and the new settings tab; `README.md` the capability and the browser suite; `docs/DEPLOYMENT.md` the api row and the
  release note (deploy order, spec provenance, Admin ahead of the clean-up activation, no live delete as evidence);
  the foundation plan's "no deletes" rule carries Steve's 2026-11-18 supersession and otherwise stands as history.
  `yarn welsh:extract` added the one string earlier tasks missed (the detail page's "Delete application"); `welsh:check`
  reports 1206 strings, 982 still identical in `cy`, all new deletion copy among them, untranslated.

## Post-Completion

Admin may be deployed before cleanup is activated (Steve, 2026-11-25). With the cleanup worker
(`APPLICATION_DELETION_WORKER_ENABLED`) and Retain and Dispose off, a deleted application is hidden at once and, after
its grace period, is neither restorable nor removed: its request stays `Pending` until cleanup is switched on, which
then works through every request past its date. The release note says so, and that the clean-up is a later, separate
activation (api `docs/APPLICATION-DELETION.md`, "Rollout order"). Any environment rehearsal uses
disposable fixtures under its own execution authority; keep local test evidence distinct from external deletion proof.
