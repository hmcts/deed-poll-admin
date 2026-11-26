# Plan: permanent document deletion with a reason, audit and case note — Admin

## Overview

Status: in progress, 2026-11-26 (Tasks 1 to 4 done).

Steve confirmed: office staff who can already access an application's documents (caseworkers, Team leaders and
Delivery Managers) can permanently delete one, and **Masters are read-only** (Steve, 2026-11-25);
the user must enter a reason (for example "Uploaded in error"), deletion is recorded in the audit table **and as a
case note**, and a document in active use must be refused with a user-friendly message. A confirmation page must
identify the document and warn that deletion cannot be undone.

This replaces the proposed Delivery Manager-only gate, fixed reason choices and uploaded-documents-only limit.
There is no new privileged DELETE_DOCUMENT capability, uploader-only ownership rule or grace period/Restore action.
**Review by Aspen, Steve's answers 2026-11-25:** no judicial journey; "in use" is api's check of queued or unsettled
work; api deletes **while the user waits**, so the usual answer is Completed at once and the progress page is needed only
when api answers 202 (a step uncertain or failed) or the outcome is unknown.
The existing whole-application deletion/grace/restore implementation is separate and stays unchanged.

Prerequisite: `deed-poll-api:docs/plans/20261125-permanent-document-deletion.md`, implemented/reviewed/merged.
API owns permission, active-use checks, versioning, permanent cleanup, audit, case note and recovery. Admin never
creates a note or audit event separately. Execute this plan in its own repo/worktree after API publishes the contract;
deploy API before exposing Admin controls in an environment. api's recovery sweep is on by default, so nothing
needs switching on for deletions to complete.

## Context

Planning baseline: Admin `43997276fde4d97ec039fe0ef802dcc66b533f69` (#422; re-check at execution), API
`d632cdc3e8e08ea88d4711955974867a42f88c5f` (api#179 merged, the document deletion contract). Fetch/rebase and record execution commits. Read CLAUDE.md in full,
`.claude/rules/{backend,frontend,testing,e2e-testing}.md`, and:

- `src/pages/deed-polls/[id].ts`, `detail.njk` and tests, `libs/deed-poll/src/documents/{service,documents-view}.ts`:
  document list/view links and domain boundaries.
- `src/pages/judicial/referrals/[referralId].ts` and `referral.njk`, only to confirm the Master's view gains no Delete
  control (Masters are read-only).
- `src/pages/deed-polls/[id]/delete.ts`, `deletions/` templates/routes,
  `src/application-deletion/{journey,progress,status-page,paths}.ts` and tests: now-merged confirmation, signed
  per-session journey, API-coded refusals and unknown-outcome recovery. Reuse generic mechanics, not application
  reasons, Delivery Manager gates, grace-period settings or Restore wording.
- `libs/deed-poll/src/{deletion,api,errors.ts}` and `libs/deed-poll-api-client/src/{api,mock}/`:
  typed admission errors, sealed original request, mock-ledger parity, API-only identity/audit ownership.
- `libs/deed-poll-api-client/{openapi.json,SPEC-PROVENANCE.md}`, contract tests,
  `src/auth/{same-origin,require-role,current-user}.ts`, `src/app.ts` and boundary tests.
- `e2e-tests/playwright.application-deletion.config.ts`, `e2e-tests/tests/application-deletion.spec.ts`, persona fixtures
  and `scripts/extract-welsh-strings.mjs`. Tests use private servers/data/ports; do not reset a shared mock.

## Development Approach

### API boundary

The companion API plan proposes case-scoped admission/status:

| Operation | Purpose |
|---|---|
| `POST /caseworker/cases/{id}/documents/{documentId}/deletion-requests` | Closed `{ reason, expectedDocumentVersion }`, UUID Idempotency-Key; 200 `{ requestId, status: "Completed" }` usually, 202 `{ requestId, status }` (`InProgress`/`NeedsAttention`) when api could not finish in the request |
| `GET /caseworker/cases/{id}/document-deletions/{requestId}` | `InProgress`/`NeedsAttention`/`Completed` and typed status metadata, still readable after document removal |

The exact merged OpenAPI artifact wins. Refresh it in Task 1 and account for the entire delta before adding mock
or page behaviour. Reasons are free text; proposed API bound 1–500 Unicode code points after trimming, no control
characters or malformed Unicode. Mirror the final published contract. Do not reuse application's 10-character
minimum, fixed reason enum, `expectedLastChangedOn` or application idempotency/body types by accident.

No page asserts a role, user name, audit author or permission to API. Existing staff authentication/access and
the Master stays read-only. An application-deletion fence still denies document mutation.

### User journey

1. Add **Delete** alongside each document in the staff Documents tab, for every staff user. Include generated and
   scanned entries; do not silently restrict deletion to uploaded documents or Delivery Managers. The Master's
   referral view gains **no** Delete control. API is authoritative on eligibility.
2. Open a dedicated confirmation page for that document, showing existing permitted application/reference context,
   document name/type/date, a view link if readable, and required **Why are you deleting this document?** textarea.
   Hint: "For example, uploaded in error. Do not include unnecessary personal information." No reason prefilled.
   Warn: "This will permanently delete the document. You cannot undo this. The reason will be recorded in the
   audit trail and as a case note." Button **Permanently delete document**; Cancel returns to the originating list.
   The application and other documents are not described as deleted.
3. Bind document ID, the case, the API-published documentVersion and a once-minted UUID key in
   signed session-bound journey state. API checks the exact version. Independent tabs do not overwrite each other.
   Only the explicit delete submit can write. A GET, Cancel or forged/expired/cross-session token causes no write.
4. Local/API validation failure: preserve entered reason and original journey; error summary focuses/links to the
   textarea. On `DOCUMENT_IN_USE`, status 409, preserve the reason and display exactly:
   **"This document is currently being used and cannot be deleted. Try again once the operation has finished."**
   No automatic retry, guessed waiting time or disabled button without an explanation. Once a definite refusal
   is known, the original confirmation can be deliberately resubmitted; a changed-document refusal requires review.
5. A 200 `Completed` redirects 303 to the application's Documents tab with a **Document deleted** banner; the list
   omits the document and the Notes tab shows the API-created note identifying the document and reason.
6. A 202 redirects 303 to a scoped progress page, which reads only the request. `InProgress` says **Document deletion
   in progress** (api will finish it); `NeedsAttention` says **Document deletion has not completed** and gives safe
   investigation guidance. Refresh is a read, not another deletion. No Restore, Undo or new-request button. Only
   `Completed` says **Document deleted**.
7. A timeout, 5xx or unreadable admission response is an unknown outcome. Seal reason/version/key/scope as
   submitted and offer **Check deletion request**, replaying that exact original POST. Do not read the case/document
   and treat its 404 as completion or mint a fresh key. Expired recovery state says the result is still unknown and
   directs investigation. Loss of access follows API refusal; never bypass it using a request ID.

Suggested staff page paths: `/deed-polls/{id}/documents/{documentId}/delete` and
`/deed-polls/{id}/document-deletions/{requestId}`; no judicial paths. Derive
return links from the verified route context, never an arbitrary posted return URL. Encode IDs with existing helpers.
Typed refusal codes select page-owned copy; unknown codes use a generic safe sentence, not provider prose.

In-use means an actual operation or queued/uncertain consumer, not an indefinitely open browser tab. Explain no
implementation machinery to the user. Permanent deletion cannot recall a copy already downloaded or emailed.
No bulk delete, restoration, audit browser, new role-management UI or whole-application policy change is in scope.

### Presentation and accessibility

Escape reason/document names in every template; never log the reason or place it in URLs. Keep reason only in the
protected form/recovery state for as long as needed. Follow application deletion's no-store and session-bound
recovery conventions. Add `en`/`cy` using the existing translation workflow; do not invent an approved translation.
The reason label, warning, error summary, in-use refusal, progress states and Cancel remain usable by keyboard and
screen reader. Unavailable progress must be visibly different from success.

## Validation Commands

From this repository root, install at setup with `yarn install --immutable`, then baseline and per-task focused
tests plus these, which must be green after every task (baseline at the plan commit: green, Aspen 2026-11-25):

```bash
yarn lint
yarn build
git diff --check
```

Final gate. Redis must actually be reachable, or the four session suites skip and the gate is not met: start a private
one first (`docker run -d --rm --name docdel-redis -p 127.0.0.1:6391:6379 redis:7-alpine`, stopped afterwards) and
record executed and skipped counts:

```bash
REDIS_URL=redis://127.0.0.1:6391 yarn turbo test test:app --concurrency=1 --force
REDIS_URL=redis://127.0.0.1:6391 yarn test:coverage
yarn npm audit --recursive --environment production
```

Run in the foreground and preserve Sonar thresholds. The browser journeys need the local IDAM simulator on 5556 and
Redis on 6379: start the repo's own stopped containers (`docker start deed-poll-idam deed-poll-redis`), seed users
(`yarn idam:users`), run the dedicated private-port config, then stop both containers again; never use a deployed
dataset or a shared developer mock. Follow E2E rules: minimal complete staff journeys with inline validation, Welsh
and axe/keyboard checks; exercise detailed errors/races at handler/API layers. Regenerate Welsh extraction and report
untranslated inventory honestly.

## Implementation Steps

### Task 1: Consume the merged API contract and model it in the client/mock

**Files:** API client's openapi.json/SPEC-PROVENANCE.md, API client/wire/contract tests, mock document/deletion routes,
staff fixtures and domain exports.

- [x] Record execution and merged API SHAs/artifact hash; compare the full generated spec delta, document every
  added/changed operation/schema and reconcile this proposal before refreshing the vendored copy.
- [x] Add the typed staff admission (200/202) and status operations and documentVersion, free-text reason
  limits, statuses and coded conflicts. Preserve the adapter-never-throws boundary and token-only Caller identity.
- [x] Mirror API auth/ownership, active-use/storage refusal, idempotency and status-after-row-removal in the mock;
  add deterministic test-only in-progress/failure/completion control without production-accessible controls.
- [x] Test all staff roles (not just Delivery Managers) and a judge refused, wrong parent/access, encoded IDs,
  invalid/missing body/key/version, exact replay and key/body conflict. Run focused client/contract/mock tests.

### Task 2: Add document deletion domain calls, validation and sealed journey

**Files:** new `libs/deed-poll/src/documents/deletion/` modules, domain API error seam if needed,
new `src/document-deletion/` modules and co-located tests; inspect application-deletion/journey.ts first.

- [x] Implement the document-specific reason form schema, caller-only service functions, unknown-admission seam
  and code-bearing errors; do not duplicate API eligibility logic or separately create a case note.
- [x] Bind case/document/version/key/session in the signed journey; seal the first submitted body for
  uncertain outcomes. Preserve reason on definite errors and require fresh review for DOCUMENT_CHANGED.
- [x] Test blank/length/Unicode/non-string reasons, tamper/expiry/cross-parent/session cases, independent tabs,
  back/double submit, exact recovery replay, access loss and no new key after an uncertain result.

### Task 3: Build the staff confirmation, progress and recovery pages

**Files:** new delete/status/recovery page routes under the staff document path,
new shared document-deletion templates/helpers as appropriate, app route boundary tests and co-located tests.

- [x] Implement the journey above with the existing authentication and staff gates, same-origin protection,
  no-store headers and safe return links. Add no DELETE_APPLICATION or manager-only gate to these paths.
- [x] Implement reason/confirmation, exact user-friendly DOCUMENT_IN_USE copy, typed stale/storage/shared refusal,
  303 to the Documents tab on 200 and to progress on 202, the in-progress/needs-attention/completed states and
  original-key unknown-outcome recovery.
- [x] Test both locales/contexts, meaningful statuses, error-summary targets, safe escaping, no writes on GET/Cancel,
  status after document removal, unreadable status, access revocation, and routes not captured by dynamic IDs.

### Task 4: Link document lists and prove the complete user journeys

**Files:** staff detail/document view model and tests, a pin that the judicial referral view has no Delete,
dedicated `e2e-tests/tests/document-deletion.spec.ts` plus isolated server/config fixtures.

- [x] Add per-document Delete links for all authorised users and exposed document types; preserve existing View/
  Download and responsive table semantics. Avoid per-row API eligibility calls. Deleted rows disappear on refresh.
- [x] Prove a normal caseworker enters a reason, confirms, reaches Completed, sees other documents survive and
  the API-created case note contains document identity/reason. Include Cancel, validation, Welsh and accessibility inline.
- [x] Prove a judge sees no Delete control on a referral's documents and is refused the staff delete URL and POST.
  Cover the in-use friendly refusal, a 202 and recovery at handler level; keep the browser test count small and
  record isolated results.

### Task 5: Complete validation, translation and release handoff

**Files:** changed files, README.md, CLAUDE.md, generated translation inventory, this plan and deployment guidance.

- [ ] Run final full gates/coverage/audit and isolated journeys. Record exact commands/counts and outstanding
  external checks without lowering coverage or equating mock deletion with a real permanent CDAM purge.
- [ ] Document permanent document deletion for all existing authorised users, mandatory free text, audit plus
  note ownership, active-use copy, status/recovery and no Restore. Regenerate Welsh inventory; amend stale guidance
  saying document deletion has no consumer while keeping application-deletion/grace behaviour intact.
- [ ] Prepare API-before-Admin rollout and disposable-fixture rehearsal checklist for filesystem/CDAM and
  note/audit verification. Record worker availability/activation prerequisites and local review results. No live
  deletion/deployment occurs as part of these implementation tasks; move to completed after review.

## Success criteria

An ordinary member of staff, not just a Delivery Manager (and never a Master), can permanently delete one document
after entering a reason and confirming, usually seeing it deleted at once. An actively used document is refused with the agreed sentence and no side effects. Only
confirmed completion says deleted; partial/unknown outcomes remain explicit and recoverable under the same key.
API creates the audit event and case note exactly once with the original user/reason. Other documents, the Master's read-only
view and whole-application grace/restore remain correct. There is no new direct data access in Admin.

## Execution notes

Record execution baseline, merged API/spec provenance, focused/full validation and review findings.
Plan structure/whitespace checks do not prove feature behaviour. Keep actionable checkboxes only in Task sections.

**Task 1 (2026-11-26).** Execution baseline: admin `99d0991` on master `4399727` (#422, unchanged since planning); api
`origin/master` `d632cdc` (#179), whose spec was generated in a throwaway detached api worktree (raw SHA-256
`48dc8026…c6c2ee`); full provenance and delta in `libs/deed-poll-api-client/SPEC-PROVENANCE.md`. The delta matched this
plan's proposal except: the reason is 1–500 code points after Java's `strip()` with bidirectional controls refused too;
the status is case-scoped and carries `documentId` but no reason or name; and #179 also added
`DOCUMENT_DELETION_UNRESOLVED` to application deletion's refusals and failures, so the application deletion page gained a
sentence for it (its test pins every admission code). #177's ten Gazette description changes rode along (no behaviour).
Added `requestDocumentDeletion`/`getDocumentDeletion`, the four wire schemas, strict `documentVersion`, the vocabularies,
and `ConflictError.code` widened to both refusal vocabularies. Mock: `src/mock/document-deletions.ts` (staff gate, api's
order and words, JSON-integer version read from source text, fence at admission, note at completion under the
requester, `/__mock/document-deletions` and `/__mock/document-deletion-outcome`), and application deletion refused
`DOCUMENT_DELETION_UNRESOLVED` while one is unconfirmed. Focused: `contract.test.ts` 339 and
`client-document-deletion.test.ts` 36 passed. Gates: `yarn lint`, `yarn build`, `git diff --check` green; `yarn test`
green in every workspace (app 3623 passed, 93 skipped: the Redis suites, no `REDIS_URL` set for this per-task run).

**Task 2 (2026-11-26).** Domain: `libs/deed-poll/src/documents/deletion/` holds `documentDeletionFormSchema` (one
`reason` control, Java `strip()` then 1–500 code points; refuses ISO controls, inner line breaks and tabs, U+2028/9,
api's bidirectional controls and lone surrogates, exactly as the mock restates api), `requestDocumentDeletion` /
`findDocumentDeletion` (body copied field by field, caller-owned key, status read under its case) and
`DocumentDeletionOutcomeUnknownError`. `callDocumentDeletionAdmissionApi` sits beside `callDeletionAdmissionApi`, both
now one private `callAdmissionApi`, so a 409 keeps api's `DocumentDeletionRefusal` code and a timeout, transport
failure, 5xx, unreadable answer or 429 is unknown. No note or audit write and no eligibility check here. Journey:
`src/document-deletion/journey.ts` signs `{ key, caseId, documentId, documentVersion, issuedAt, confirmed? }` under
its own HMAC domain (`document-deletion-v1`), 8 h, session-bound, refused for another case or document; a sealed
reason is never edited by a recovery; `afterDefiniteRefusal` unseals (same key, reason kept to redraw) after a 400 or
any 409 except `DOCUMENT_CHANGED` and `KEY_REUSED`, which need a fresh review. Focused: deed-poll `documents/deletion`
plus `api` 39 passed, app `journey.test.ts` 16 passed. Gates: `yarn lint`, `yarn build`, `git diff --check` green;
`yarn test` green in every workspace (deed-poll 1867, client 1673, app 3639 passed and 93 skipped: the Redis suites,
no `REDIS_URL` for this per-task run).
**Task 3 (2026-11-26).** Pages: `src/pages/deed-polls/[id]/documents/[documentId]/delete.ts` (+ `document-delete.njk`)
and `src/pages/deed-polls/[id]/document-deletions/[requestId].ts` (+ `document-deletion-status.njk`), addresses in
`src/document-deletion/paths.ts`. No new gate: the existing `requireStaff` on `/deed-polls`, same-origin and the global
no-store cover both, and `app.test.ts` pins that the application deletion gate reaches neither and the staff gate reaches
both. GET reads the case once, 404s a document not on it, and binds the published `documentVersion` and a fresh key.
`Completed` is a 303 to `/deed-polls/{id}?document=deleted#documents`, where the case page draws a fixed "Document
deleted" banner (user input like the restore banner, so it names no document); `InProgress`/`NeedsAttention` a 303 to the
progress page, which reads only the request (503 "could not check" on an unreadable read, 404/403/401/429 to the
existing flows, no POST). In-use, storage, shared, application-pending and unknown codes redraw the form at 409 with the
reason and the same key, the sentence as the error summary's first item (no field link); `DOCUMENT_CHANGED` and
`KEY_REUSED` stop with links only. Unknown outcome: 503 recovery with one `check` control replaying the sealed body.
Content `cy` mirrors `en` (Welsh pending; covered by the extractor's `src/pages/deed-polls`). Focused: delete 39,
progress 14, templates 11 (axe, escaping, error-summary targets), routes 4, `app.test.ts` 52, detail banner. Gates:
`yarn lint`, `yarn build`, `git diff --check` green; `yarn test` green in every workspace (app 3709 passed, 93 skipped:
the Redis suites, no `REDIS_URL` for this per-task run).

**Task 4 (2026-11-26).** The case page's Documents tab gives every row a **Delete** link
(`deleteHref` from `documentDeletionConfirmationPath`, built in `[id].ts` beside `viewHref`), in an "Actions" column,
with the document's name as visually hidden text. It is drawn for every staff user and every document, attached file or
not, with no capability check and no per-row read; the referral queue's check view (which shares `DOCUMENT_COLUMNS`)
and the Master's referral page get none, the latter pinned in `referral.njk.test.ts`. Browser: `yarn
test:document-deletion` (mock 3221, app 3321, Redis database 7, out of `yarn test:e2e`), two journeys, both passed
(11.9 s): a caseworker deletes one of two uploaded documents (Delete link by accessible name, confirmation, Cancel,
Welsh toggle, empty-reason error summary focusing `#reason`, keyboard submit, banner, other document kept, api's note
naming the document and reason, old confirmation now 404, axe at four points); a judge sees no Delete on the referral
and gets 403 for the staff page and a forged POST, the document still on the case. In-use, 202 and unknown outcome stay
at handler level (Task 3). Gates: `yarn lint`, `yarn build`, `git diff --check` green; `yarn test` green in every
workspace (app 3712 passed, 93 skipped: the Redis suites, no `REDIS_URL` for this per-task run).

## Post-Completion

API must serve the published contract and have the permanent document-cleanup prerequisites verified before
Admin activation. Browser mock results are not environment deletion evidence; record rehearsal separately.
