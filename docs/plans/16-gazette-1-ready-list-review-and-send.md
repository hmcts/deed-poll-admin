# Plan: London Gazette publication — admin UI (ready list, review, send, history)

## Execution status — 8 October 2026

The read-only foundation (plan 16a), relinquishment exclusion and recipient editor
are merged, most recently admin PR #163 (`5cd70ad`) and API PR #89 (`7ff8352`).
The production spreadsheet generator is also merged in API PR #88. There is still
**no batch-send API or send control**. This parent remains active.

The next API design is
[`gazette-1b-send-and-recovery-contract.md`](https://github.com/hmcts/deed-poll-api/blob/783f21f24f165e601deee234a5016f714cf7cc8a/docs/plans/gazette-1b-send-and-recovery-contract.md).
It replaces the former rollback-and-retry assumption with a durable request ledger,
one email attempt and explicit uncertainty. It is a design, not an available API;
refresh OpenAPI only after each corresponding operation is implemented and published.
This plan records the matching admin behavior below. The five-item checklist and
whether it blocks selection still require a business answer.

## Recipient settings slice — 8 October 2026

The merged API companion publishes `GET`/`PUT /caseworker/gazette-settings`, with
persistent V33 configuration and revision-checked updates. PR #163 consumes
that contract in the client/domain/mock and adds `/deed-polls/gazette/settings`,
linked from the ready list and covered by the existing admin area/CSRF gates.
The editor validates one address, shows change attribution, preserves invalid
input and requires a reload after a stale edit. It starts unset; no court mailbox
is substituted. English/Welsh copy and a browser journey are included.

- [x] Implement recipient editor and contract/client/domain/mock support.
- [x] Cover persistence, validation, role refusal, stale forms, Welsh and accessibility.
- [ ] Deploy the API settings contract and migration before this admin version.
- [ ] Show the recipient on batch confirmation, submit the settings revision and
  handle changes through the future send contract.

See [recipient settings validation](gazette-recipient-settings-validation.md).
This implements only the recipient setting. The remaining review/selection/send
work below stays active. Current delivery decisions use one Notify email with
adult/minor download links, omitting absent files, rather than actual attachments.

## Overview

A caseworker-admin needs to be notified when applications are ready for the London Gazette, view and check
that list, send a batch through one Notify email with adult/minor spreadsheet download links, and see a record of what has been
sent and by whom. The API companion,
`deed-poll-api/docs/plans/gazette-1-ready-list-and-batch-send.md`, adds:

```http
GET  /caseworker/cases?filter=readyForPublication
POST /caseworker/gazette-notices
GET  /caseworker/gazette-notices
```

These are the original three operations; the preview/status/full-membership
additions are specified below. The role-gated `/deed-polls/gazette/**` area already exists.

## Acceptance criteria this plan answers

- **AC1** — the ready list (`filter=readyForPublication`), reached from a worklist banner.
- **AC2** — a review/checklist page per case, reached from the ready list.
- **AC3** — the whole area is gated on `DEEDPOLL_ADMIN`, refusing everyone else.
- **AC4** — only the same gate can reach the send action; api gates the operation too (defence in depth,
  same relationship as every other persona/data boundary pair in this app).
- **AC5** — the send goes through GOV.UK Notify, via api's existing configuration surface (see the api plan's
  decision 2 for why it is a new path rather than a reuse of the per-case email tab's plumbing).
- **AC6** — a history page reading `GET /caseworker/gazette-notices`.
- **AC7** — every new page extends the existing layouts and follows the existing page/component conventions;
  nothing here introduces a new visual language.

## Dependencies and reconciliation gate

Consume only generated API contracts, refreshing the pinned artifact and its
provenance together with client/mock registration. The design predicts five new
operations (preview POST, send POST, request-list GET, batch-detail GET and complete
membership GET) plus `batchId` on sent-history summaries. Verify the actual whole
document, including error DTOs, rather than trusting those counts. Preserve the
existing explicit deferred CCD inventory. The recipient contract is already consumed.

## Intended user journey

1. Follow the admin-only count to the existing ready list. Its API predicate stays
   unchanged; reservations may make a listed case temporarily unavailable for a new
   batch. Preview/admission explain this and link to the request list.
2. Review and select cases using the checklist rule once business-validated. Keep
   this visit's state separate from other tabs and from persisted case data.
3. Request an API preview for the selection. Show its recipient, group counts and
   full selected reference list; retain its fingerprint and original settings
   revision. Mint a request key for this exact confirmation.
4. Confirm once. The submit carries the original IDs/fingerprint/recipient revision
   and key. An admission refusal is not an accepted batch; explain the typed reason
   and obtain a fresh preview/confirmation when content has changed.
5. Once a request may have been accepted, freeze its submitted payload/key locally.
   A transport failure offers “Check request status” using the same request identity.
   A 200 is interpreted by its state, not automatically reported as success.
6. Show `Preparing`/`Sending` as in progress, `Sent` as accepted by Notify,
   `NotSent` as a definite failure, and `Uncertain` as requiring investigation.
   Only `NotSent` permits a fresh, explicitly confirmed request. No retry/send
   control appears for uncertain batches. Recipient changes do not redirect a
   previously accepted request.
7. Link to request status and sent history. History summaries link through the new
   batch ID to all frozen references using database pagination, including legacy
   batches larger than the 100-reference preview.

## Decisions — implement these, do not revisit

### 1. This is a persona-area gate, the same shape as `/judicial/**`, not a per-page or per-button check

Mount `requireRole(DEEDPOLL_ADMIN)` on the `/deed-polls/gazette` prefix in `src/app.ts`, after `requireAuth`,
before the router — exactly where `requireJudicial()` is mounted for `/judicial`. Do not add a per-page role
check inside `src/pages/deed-polls/gazette/**`; the pages must stay ignorant of the role, the same way the
judicial pages are, and `src/pages/layouts/app.njk.test.ts`'s filesystem scan (or its equivalent extended for
this area) is what proves the mount covers every page rather than a remembered decoration on each one.

This is a persona boundary reinforced by api's own gate on the two write/read operations (api plan decision
8), not the data boundary itself — the same relationship judicial has to its own api gate.

### 2. Reuse the established Gazette area gate

`requireRole(DEEDPOLL_ADMIN)` already protects this area through `require-role.ts`.
Extend the existing filesystem/route coverage when adding request/detail pages;
do not introduce separate per-page role logic.

### 3. The worklist count is a third, independent degrade-and-log read, not folded into the existing two

`src/pages/deed-polls/index.ts` already starts the saved-query nav and two worklist counts before the list
read and awaits each through `worklistCount(name, read)`. Add a third call the same way, reading
`filter=readyForPublication`'s `total`. Each count's failure must remain independently visible — a caseworker
whose returned-for-action count failed must still see a working ready-to-publish count, and vice versa. Do not
introduce a combined "some counts failed" banner; follow the existing one-state-per-count model exactly.

**This banner should only render for a caseworker-admin.** Unlike the returned-for-action and
awaiting-confirmation counts, which any caseworker can act on, the Gazette count leads to an admin-only area —
render it conditionally on `isAdmin`, and skip the api call entirely for a non-admin session rather than
fetching a number the viewer cannot follow through on.

### 4. The review checklist — a proposed default set, not yet business-validated

Confirmed with you this plan should propose a sensible set for the team to validate afterwards. Proposed:

1. The case's state is `Enroled`.
2. There is no open referral or unresolved query against the case.
3. The former and new name details shown match the case's own declaration (rendered from the case detail
   already read — this is a prompt to look, not a second data source).
4. There is no outstanding document or witness issue recorded against the case.
5. The caseworker-admin's own sign-off: "I have checked this case and it is ready to be sent to the London
   Gazette."

**An incomplete checklist blocks the case from being sent.** Proposed, also flagged for validation: a case
whose checklist is not fully checked cannot be selected in the ready list, matching the "a send is a
deliberate act by somebody who has read what is going out" ethos already stated in `CaseEmailService`'s own
docblock. If the business prefers the checklist to be advisory only, this is the one decision in this plan to
revisit first — it changes the ready list's selection logic (decision 6) directly.

**The checklist is per-visit state, not a persisted business sign-off.** Until its
rule is agreed, do not implement or imply a verified “reviewed” state in API. Once
agreed, carry review acknowledgements against case IDs and their reviewed data
version within the visit's form flow. Changes invalidate them. Never use one global
session “current batch”; duplicated tabs must not overwrite each other's selection.
The API fingerprint prevents stale data; it does not certify completion of a checklist.

### 5. The review page is reached from the ready list, and links back to it — never a standalone route

`src/pages/deed-polls/gazette/index.ts` (ready list) and `src/pages/deed-polls/gazette/[id]/review.ts` (the
checklist), following the existing `[id]` case-detail routing convention. The review page reads the same case
detail read the main case page uses (`findDeedPoll`) — do not add a second, gazette-specific case read.

### 6. Separate editable selection from an attempted submission

Use a form-carried, tab-scoped journey identity and selection/review state through
review, back and confirmation pages, following the existing hidden-field convention.
Do not store one session-wide batch or add an admin database. Validate all form fields;
API remains authoritative for readiness, reservations and confirmed values.

Before submitting, the user may revise selection and obtain a fresh preview/key.
After any POST may have reached API, keep the exact submitted body and key for status
recovery. Do not let a correction overwrite that attempted identity. A new selection
starts a distinct confirmation only after a structured admission refusal or a proven
`NotSent` status; otherwise resolve the old request first. API reservations additionally
prevent overlapping selections from being admitted through another tab.

### 7. Keys survive transport failure, reload and back navigation

Mint a UUID at first confirmation, never in the send handler. All confirmation/back
forms preserve it and the preview token/revision. Repeating a POST uses byte-equivalent
semantic content (case ID order is irrelevant to API). A reload of a status or attempted
confirmation page never mints a replacement key or implies that sending failed.
The previous “every reload is a new journey” rule is superseded for Gazette.

An API 409 `REQUEST_KEY_REUSED` is a conflict to resolve, never a reason to generate
another key and retry silently. The key is private transport state: no URL query,
case note or log entry. The batch UUID is the public status link. Client timeout,
502 or a generic 500 is not evidence of non-admission; show the checking-status path
and retain the original payload. If local form state is lost, recover through the
admin request list, not a new send.

### 8. Render typed outcomes and controlled next actions

The Gazette-specific 409 body has stable `code` and optional case conflicts. Render
localised copy by code; do not parse prose or add Gazette fields to every existing
API error. Contract-test its separate parser and preserve generic `ApiError` handling
for unrelated operations. Unknown codes fail closed with no send/retry control.

| API answer | UI behavior |
|---|---|
| `RECIPIENT_NOT_CONFIGURED` | Link to settings; then refresh preview |
| `RECIPIENT_CHANGED`, `CONFIRMATION_EXPIRED`, `SELECTION_CHANGED` | Fresh preview and renewed confirmation, never silent substitution |
| `CASE_NOT_READY`, `CASE_TYPE_UNSUPPORTED` | Explain affected members; require correction/new review |
| `CASE_RESERVED` | Explain an existing request; link to request list |
| `REQUEST_KEY_REUSED` | Preserve the attempt; resolve status/conflicting content |
| Structured `GAZETTE_UNAVAILABLE` before admission | Explain unavailable configuration; keep selection |
| `Preparing`, `Sending` | Progress/status view; no second delivery control |
| `Sent` | “Accepted by GOV.UK Notify”; do not imply publication or confirmed delivery |
| `NotSent` | Explain definite failure; fresh preview/confirmation may start a new request |
| `Uncertain` or unknown transport outcome | Investigate/check status; never automatic or one-click resend |

A repeat 200 may contain any terminal state. Do not reuse the existing per-case
email page's assumption that an idempotent success always means a sent notification.
Reads do not initiate sending. Add bounded status polling or an explicit refresh,
with an unavailable state and no invented terminal outcome on polling failure.

### 9. Sent history and request status are distinct views

Keep the existing paginated sent-history list and its bounded preview. Add batch
links and a paginated full frozen-membership page, reading API totals and ordering.
Render unavailable legacy recipient/group counts as unknown; never fill them from
current case or settings values. Provide a separate request list/detail for pending,
not-sent and uncertain batches; neither a pending request nor uncertainty belongs
in the successful sent count. The request detail has no repair/resend control.

## Layers

1. **Client** — `libs/deed-poll-api-client`: `getReadyForPublication` (or extend the existing case-list
   client call with the new filter value — check whether the existing list operation already accepts any
   filter string before adding a second method), `sendGazetteNotice`, `getGazetteNoticeHistory`; wire types;
   mock support for request identity, reservations, status and full frozen membership; no invented business-approved review state.
2. **Domain** (`libs/deed-poll`): a `gazette` module — view models for the ready list row, the review
   checklist, the confirmation summary and the history row. No business logic beyond formatting; api owns
   the predicate, the selection validation and the send.
3. **Pages** — `src/pages/deed-polls/gazette/index.ts` (ready list), `[id]/review.ts` (checklist),
   `confirm.ts` (confirmation + send), `history.ts`; the `requireRole` mount in `app.ts`; the worklist count
   addition to `src/pages/deed-polls/index.ts`.
4. **Locales** — `en`/`cy` pairs for every new page; add `src/pages/deed-polls/gazette` to
   `scripts/extract-welsh-strings.mjs`'s `INCLUDE` list in the same commit that adds the first page, not
   afterwards.
5. **Tests** — colocated unit tests per page/view model; a route/template/app test extending the existing
   `/judicial`-style filesystem scan to cover the new prefix; an E2E journey in `e2e-tests/tests/` covering
   the full flow including a non-admin being refused the area.

## Validation Commands

**These run after every task, and everything here must be green after every task, not only at the end.**

```bash
yarn lint
npx turbo test test:app --concurrency=1
```

Record the baseline test-file/test counts on this branch before Task 0, the same way `referrals-admin-6`
records its own, and compare after each task.

**`yarn welsh:check`'s pre-existing non-zero exit is not this plan's to fix** — confirm the count of
identical `en`/`cy` strings has moved by only this plan's own new keys, per the precedent in
`referrals-admin-6`'s Validation Commands section; do not expect a zero exit.

## Tasks

### Task 0: Reconcile the published API contract

Plan 16a reconciled the complete merged read contract, including the explicitly deferred CCD surface.
A further reconciliation is required when the send operation is published; the original predicted
"exact" delta below is superseded for reads by plan 16a's measured provenance.

Refresh `openapi.json` per `SPEC-PROVENANCE.md` once the api plan has merged. Measure and account for the entire delta described above, including batch IDs and
Gazette-specific errors, while preserving unrelated operations. Record baselines.

- [ ] Contract reconciled; baselines recorded

### Task 1: Client, domain and mock

Read client/domain/mock and seed fixtures delivered by plan 16a. Sending and any business-approved
review/selection state remain outstanding; no mock "reviewed" state has been invented.

Add the client methods, wire types, view models, and mock support — including fixtures for `Preparing`, `Sending`, `Sent`, `NotSent`, `Uncertain`, stale
recipient/selection and legacy full membership. Use separate journey fixtures;
do not imply that the API stores checklist sign-off.

- [ ] Client/domain/mock implemented; contract and mock tests green

### Task 2: Role gate and worklist banner

Mount `requireRole(DEEDPOLL_ADMIN)` on `/deed-polls/gazette`. Add the third worklist count to the dashboard,
conditional on `isAdmin` per decision 3. Add the filesystem-scan test proving every page under the new prefix
is covered by the mount.

- [x] Gate mounted and tested; banner renders only for admins; non-admin area access refused (plan 16a)

### Task 3: Ready list

Read-only list delivered by plan 16a with case-detail links, API ordering and paging. Selection,
checklist gating and review links remain outstanding.

The list page, checkboxes, reviewed/unreviewed disabled-state logic per decision 4's proposed rule, links to
review and to history.

- [ ] Ready list implemented; selection logic tested for both reviewed and unreviewed cases

### Task 4: Review checklist

The per-case checklist page with the proposed five items from decision 4, marking the case reviewed for the
current visit only (decision 4's "not persisted" rule).

- [ ] Review page implemented and tested

### Task 5: Confirmation and send

The API-preview confirmation page, stable request identity (decision 7), typed
admission refusal/status handling (decision 8), request list/detail and complete
membership. Missing/changed recipients require a fresh confirmation.

- [ ] Confirmation/send and request status implemented; all state/action rows above tested
- [ ] Complete frozen-member navigation works for new and legacy batches above 100 references
- [ ] Lost responses, duplicate submissions and concurrent tabs cannot trigger duplicate sending

### Task 6: History page

- [x] History page implemented and tested (plan 16a; full counts, bounded preview and pagination)

### Task 7: Welsh strings, E2E and full validation

Plan 16a supplies extracted bilingual read pages and dedicated browser journeys for empty/populated
counts, ready/case/history navigation, pagination, truncation and non-admin refusal, with inline axe
and Welsh checks. A full review/select/confirm/send/history E2E journey is still missing. Welsh
language review is still required; the existing identical-English baseline is not a clean Welsh check.

Add the new area to `extract-welsh-strings.mjs`'s `INCLUDE` if not already done incrementally. Write the E2E
journey: an admin sees the banner, reviews a case, sends a subset, sees the history entry; a non-admin cannot
reach `/deed-polls/gazette` at all.

- [ ] Welsh extraction covers the new pages; E2E journey green; full validation commands green

## Relinquishment exclusion — 8 October 2026

Steve confirmed that Deed of Relinquishment stays outside the Gazette process.
The API ready filter and total exclude this type; the admin continues to consume
those answers without filtering a page locally. The development mock mirrors the
exclusion. Existing Unknown/unset-type read behaviour is unchanged. When selection
and sending are implemented, a case reclassified as relinquishment after selection
must cause a clear refusal before sending, without silently reducing the batch.
The generator is merged in API PR #88; send-path enforcement remains outstanding.

## Next execution slices

The API ledger/guard slice comes first. The UI may consume status/preview work once
its generated contract is merged; the send control waits for complete delivery and
recovery support. Checklist wording/gating remains a separate business input and
must not be inferred from this technical design. New copy needs English/Welsh,
extraction and human review, and the full browser journey must cover every outcome
above with accessibility checks. The design-only PR changes no app, mock or runtime
OpenAPI and requires document/link consistency checks rather than a fresh runtime suite.
