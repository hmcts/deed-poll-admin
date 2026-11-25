# Plan: permanent document deletion with a reason, audit and case note — Admin

## Overview

Status: planned, 2026-11-25. No feature implementation has started.

Steve confirmed: anyone who is already authorised to access an application's document can permanently delete it;
the user must enter a reason (for example "Uploaded in error"), deletion is recorded in the audit table **and as a
case note**, and a document in active use must be refused with a user-friendly message. A confirmation page must
identify the document and warn that deletion cannot be undone.

This replaces the proposed Delivery Manager-only gate, fixed reason choices and uploaded-documents-only limit.
There is no new privileged DELETE_DOCUMENT capability, uploader-only ownership rule or grace period/Restore action.
The existing whole-application deletion/grace/restore implementation is separate and stays unchanged.

Prerequisite: `deed-poll-api:docs/plans/20261125-permanent-document-deletion.md`, implemented/reviewed/merged.
API owns permission, active-use checks, versioning, permanent cleanup, audit, case note and recovery. Admin never
creates a note or audit event separately. Execute this plan in its own repo/worktree after API publishes the contract;
deploy API and enable its verified document-cleanup path before exposing Admin controls in an environment.

## Context

Planning baseline: Admin `43997276fde4d97ec039fe0ef802dcc66b533f69` (#422), API
`edb705272e4840465cf031395a3f6096a4ae3034`. Fetch/rebase and record execution commits. Read CLAUDE.md in full,
`.claude/rules/{backend,frontend,testing,e2e-testing}.md`, and:

- `src/pages/deed-polls/[id].ts`, `detail.njk` and tests, `libs/deed-poll/src/documents/{service,documents-view}.ts`:
  document list/view links and domain boundaries.
- `src/pages/judicial/referrals/[referralId].ts`, `referral.njk`, their tests and document file/view routes beneath
  the referral: a judge reaches documents by a visible referral, never through a staff case URL.
- `src/pages/deed-polls/[id]/delete.ts`, `deletions/` templates/routes,
  `src/application-deletion/{journey,progress,status-page,paths}.ts` and tests: now-merged confirmation, signed
  per-session journey, API-coded refusals and unknown-outcome recovery. Reuse generic mechanics, not application
  reasons, Delivery Manager gates, grace-period settings or Restore wording.
- `libs/deed-poll/src/{deletion,api,errors.ts}` and `libs/deed-poll-api-client/src/{api,mock}/`:
  typed admission errors, sealed original request, mock-ledger parity, API-only identity/audit ownership.
- `libs/deed-poll-api-client/{openapi.json,SPEC-PROVENANCE.md}`, contract tests,
  `src/auth/{same-origin,require-role,current-user}.ts`, `src/app.ts` and boundary tests.
- `e2e-tests/playwright.application-deletion.config.ts`, `e2e-tests/tests/application-deletion.spec.ts`, judicial/referral fixtures
  and `scripts/extract-welsh-strings.mjs`. Tests use private servers/data/ports; do not reset a shared mock.

## Development Approach

### API boundary

The companion API plan proposes case-scoped admission/status:

| Operation | Purpose |
|---|---|
| `POST /caseworker/cases/{id}/documents/{documentId}/deletion-requests` | Closed `{ reason, expectedDocumentVersion }`, UUID Idempotency-Key; 202 `{ requestId, status }` |
| `GET /caseworker/cases/{id}/document-deletions/{requestId}` | Pending/InProgress/NeedsAttention/Completed and typed status metadata, still readable after document removal |
| Equivalent referral-scoped judicial operations | Same permission the judge already has for this document, no new staff-area access or case-note read permission |

The exact merged OpenAPI artifact wins. Refresh it in Task 1 and account for the entire delta before adding mock
or page behaviour. Reasons are free text; proposed API bound 1–500 Unicode code points after trimming, no control
characters or malformed Unicode. Mirror the final published contract. Do not reuse application's 10-character
minimum, fixed reason enum, `expectedLastChangedOn` or application idempotency/body types by accident.

No page asserts a role, user name, audit author or permission to API. Existing staff authentication/access and
judicial referral visibility remain enforced. An application-deletion fence still denies document mutation.

### User journey

1. Add **Delete** alongside each document in the staff Documents tab. Add the equivalent action to documents in
   the judicial application view for callers already allowed to access them. Include generated/scanned entries;
   do not silently restrict deletion to uploaded documents or Delivery Managers. API is authoritative on eligibility.
2. Open a dedicated confirmation page for that document, showing existing permitted application/reference context,
   document name/type/date, a view link if readable, and required **Why are you deleting this document?** textarea.
   Hint: "For example, uploaded in error. Do not include unnecessary personal information." No reason prefilled.
   Warn: "This will permanently delete the document. You cannot undo this. The reason will be recorded in the
   audit trail and as a case note." Button **Permanently delete document**; Cancel returns to the originating list.
   The application and other documents are not described as deleted. Judicial pages show no extra staff-only data.
3. Bind document ID, authorised parent/referral scope, API-published documentVersion and a once-minted UUID key in
   signed session-bound journey state. API checks the exact version. Independent tabs do not overwrite each other.
   Only the explicit delete submit can write. A GET, Cancel or forged/expired/cross-session token causes no write.
4. Local/API validation failure: preserve entered reason and original journey; error summary focuses/links to the
   textarea. On `DOCUMENT_IN_USE`, status 409, preserve the reason and display exactly:
   **"This document is currently being used and cannot be deleted. Try again once the operation has finished."**
   No automatic retry, guessed waiting time or disabled button without an explanation. Once a definite refusal
   is known, the original confirmation can be deliberately resubmitted; a changed-document refusal requires review.
5. Accepted 202 redirects with 303 to a scoped progress page, which reads only the request. Pending/InProgress says
   **Document deletion in progress**; NeedsAttention says **Document deletion has not completed** and gives safe
   investigation guidance. Refresh is a read, not another deletion. No Restore/Undo/new-request button.
6. Only Completed says **Document deleted**. Staff return to the application's Documents or Notes tab and see
   the API-created note identifying the document and reason. The list omits the deleted document. Judges return
   to their referral; they do not gain a notes tab just because API created a note.
7. A timeout, 5xx or unreadable admission response is an unknown outcome. Seal reason/version/key/scope as
   submitted and offer **Check deletion request**, replaying that exact original POST. Do not read the case/document
   and treat its 404 as completion or mint a fresh key. Expired recovery state says the result is still unknown and
   directs investigation. Loss of parent/referral access follows API refusal; never bypass it using a request ID.

Suggested staff page paths: `/deed-polls/{id}/documents/{documentId}/delete` and
`/deed-polls/{id}/document-deletions/{requestId}`; judicial equivalents stay beneath the visible referral. Derive
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
tests plus:

```bash
yarn lint
yarn build
git diff --check
```

Final gate:

```bash
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
yarn test:coverage
yarn npm audit --recursive --environment production
```

Redis must actually be reachable for its suites. Record counts/skips/failures, use foreground commands and preserve
Sonar thresholds. Browser journeys run with local IDAM/Redis and private mock/app ports, never a deployed dataset.
Follow E2E rules: minimal complete staff/judicial journeys with inline validation, Welsh and axe/keyboard checks;
exercise detailed errors/races at handler/API layers. Regenerate Welsh extraction and report untranslated inventory honestly.

## Implementation Steps

### Task 1: Consume the merged API contract and model it in the client/mock

**Files:** API client's openapi.json/SPEC-PROVENANCE.md, API client/wire/contract tests, mock document/deletion routes,
staff/judicial fixtures and domain exports.

- [ ] Record execution and merged API SHAs/artifact hash; compare the full generated spec delta, document every
  added/changed operation/schema and reconcile this proposal before refreshing the vendored copy.
- [ ] Add typed staff and referral-scoped admission/status operations and documentVersion, free-text reason
  limits, statuses and coded conflicts. Preserve the adapter-never-throws boundary and token-only Caller identity.
- [ ] Mirror API auth/ownership, active-use/storage refusal, idempotency and status-after-row-removal in the mock;
  add deterministic test-only pending/failure/completion control without production-accessible controls.
- [ ] Test all staff roles and visible judiciary (not just manager), wrong parent/referral/access, encoded IDs,
  invalid/missing body/key/version, exact replay and key/body conflict. Run focused client/contract/mock tests.

### Task 2: Add document deletion domain calls, validation and sealed journey

**Files:** new `libs/deed-poll/src/documents/deletion/` modules, domain API error seam if needed,
new `src/document-deletion/` modules and co-located tests; inspect application-deletion/journey.ts first.

- [ ] Implement the document-specific reason form schema, caller-only service functions, unknown-admission seam
  and code-bearing errors; do not duplicate API eligibility logic or separately create a case note.
- [ ] Bind case/referral/document/version/key/session in the signed journey; seal the first submitted body for
  uncertain outcomes. Preserve reason on definite errors and require fresh review for DOCUMENT_CHANGED.
- [ ] Test blank/length/Unicode/non-string reasons, tamper/expiry/cross-parent/session cases, independent tabs,
  back/double submit, exact recovery replay, access loss and no new key after an uncertain result.

### Task 3: Build staff and judicial confirmation/progress/recovery pages

**Files:** new delete/status/recovery page routes under the staff document and judicial referral paths,
new shared document-deletion templates/helpers as appropriate, app route boundary tests and co-located tests.

- [ ] Implement the journey above with existing authentication/staff/judicial gates, same-origin protection,
  no-store headers and safe return links. Add no DELETE_APPLICATION or manager-only gate to these paths.
- [ ] Implement reason/confirmation, exact user-friendly DOCUMENT_IN_USE copy, typed stale/storage/shared refusal,
  303 to progress, all pending/needs-attention/completed states and original-key unknown-outcome recovery.
- [ ] Test both locales/contexts, meaningful statuses, error-summary targets, safe escaping, no writes on GET/Cancel,
  status after document removal, unreadable status, access revocation, and routes not captured by dynamic IDs.

### Task 4: Link document lists and prove the complete user journeys

**Files:** staff detail/document view model, judicial referral document view model/templates and tests,
dedicated `e2e-tests/tests/document-deletion.spec.ts` plus isolated server/config fixtures.

- [ ] Add per-document Delete links for all authorised users and exposed document types; preserve existing View/
  Download and responsive table semantics. Avoid per-row API eligibility calls. Deleted rows disappear on refresh.
- [ ] Prove a normal caseworker enters a reason, confirms, reaches Completed, sees other documents survive and
  the API-created case note contains document identity/reason. Include Cancel, validation, Welsh and accessibility inline.
- [ ] Prove a judge can delete only through a visible referral, returns there without staff-note/case-ID leakage,
  and unrelated referral documents remain inaccessible. Cover the in-use friendly refusal and recovery at handler
  level plus the API concurrency suite; keep browser test count small and record isolated results.

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

An ordinary authorised user, not just a Delivery Manager, can permanently delete one document after entering a
reason and confirming. An actively used document is refused with the agreed sentence and no side effects. Only
confirmed completion says deleted; partial/unknown outcomes remain explicit and recoverable under the same key.
API creates the audit event and case note exactly once with the original user/reason. Other documents, judicial
visibility and whole-application grace/restore remain correct. There is no new direct data access in Admin.

## Execution notes

Not started. Record execution baseline, merged API/spec provenance, focused/full validation and review findings.
Plan structure/whitespace checks do not prove feature behaviour. Keep actionable checkboxes only in Task sections.

## Post-Completion

API must serve the published contract and have the permanent document-cleanup prerequisites verified before
Admin activation. Browser mock results are not environment deletion evidence; record rehearsal separately.
