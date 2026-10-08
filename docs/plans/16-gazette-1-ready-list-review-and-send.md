# Plan: London Gazette publication — admin UI (ready list, review, send, history)

## Execution status — 7 October 2026

API PR #80 is merged at `44c89a335069243997898fefd603afa9df85695e`. It supplies the
ready-for-publication filter and admin-only, paginated history, but **no batch send operation**.
The completed read-only subset is [plan 16a](completed/16a-gazette-ready-list-and-history.md): contract reconciliation,
client/domain/mock, admin gate and count, a read-only ready list, and history. This supersedes the
original reconciliation gate below for that subset: the pinned admin contract also predates CCD
recovery and document/email contract updates, which must be accounted for explicitly.

Delivered by plan 16a: admin gate/count, oldest-enrolled read-only ready list and paginated history.
Remaining dependencies: the batch-send API contract (including idempotency/conflict semantics),
Notify/spreadsheet provisioning and delivery decisions, and business validation of the proposed
checklist and whether it blocks selection. There is still no full send-journey E2E.

Keep this parent plan active. Selection, the proposed review checklist, confirmation and sending
remain outstanding pending the API send contract and its business/dependency decisions. Do not
invent the missing endpoint, reviewed state, or a send control. Mark only fully delivered parent
tasks complete; annotate partially delivered tasks with the remaining work.

## Overview

A caseworker-admin needs to be notified when applications are ready for the London Gazette, view and check
that list, send a batch to the Gazette by email with a spreadsheet attached, and see a record of what has been
sent and by whom. The API companion,
`deed-poll-api/docs/plans/gazette-1-ready-list-and-batch-send.md`, adds:

```http
GET  /caseworker/cases?filter=readyForPublication
POST /caseworker/gazette-notices
GET  /caseworker/gazette-notices
```

This plan consumes all three and adds a role-gated `/deed-polls/gazette/**` area.

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

Implement after `gazette-1-ready-list-and-batch-send.md` is merged and its regenerated OpenAPI document is
available. Before coding, refresh `libs/deed-poll-api-client/openapi.json` per `SPEC-PROVENANCE.md`. The
expected contract delta is exactly: the `readyForPublication` filter's description text, and two new
operations (`sendGazetteNotice`, `gazetteNoticeHistory`) with their schemas. Stop if anything else changed.

## User journey

1. A caseworker-admin's dashboard shows a third worklist count, alongside returned-for-action and
   awaiting-confirmation: **N applications ready to publish**.
2. Following it opens the ready list — one row per case, oldest-enrolled first, a checkbox per row
   (all checked by default), and a link from each row into its review page.
3. The review page shows the case's key facts against a fixed checklist (see decision 4). Every item must be
   checked, plus the caseworker-admin's own sign-off, before the case counts as reviewed.
4. Back on the ready list, only reviewed cases can remain checked for sending; an unreviewed case's checkbox
   is disabled with a link to go and review it. The admin deselects anything they do not want in this batch.
5. **Send to the London Gazette** goes to a confirmation page listing the final selection and totals, with
   one submit action.
6. Confirming calls the batch send endpoint. Success returns to the ready list (now missing the sent cases,
   since they no longer satisfy `readyForPublication`) with a confirmation banner. A stale-selection 409 or a
   Notify failure re-renders the confirmation page with what changed, exactly as the existing referral/email
   confirmation pages handle their own conflicts.
7. A **Gazette send history** page, linked from the ready list, lists past batches — sender, timestamp, case
   count, case references.

## Decisions — implement these, do not revisit

### 1. This is a persona-area gate, the same shape as `/judicial/**`, not a per-page or per-button check

Mount `requireRole(DEEDPOLL_ADMIN)` on the `/deed-polls/gazette` prefix in `src/app.ts`, after `requireAuth`,
before the router — exactly where `requireJudicial()` is mounted for `/judicial`. Do not add a per-page role
check inside `src/pages/deed-polls/gazette/**`; the pages must stay ignorant of the role, the same way the
judicial pages are, and `src/pages/layouts/app.njk.test.ts`'s filesystem scan (or its equivalent extended for
this area) is what proves the mount covers every page rather than a remembered decoration on each one.

This is a persona boundary reinforced by api's own gate on the two write/read operations (api plan decision
8), not the data boundary itself — the same relationship judicial has to its own api gate.

### 2. `isAdmin` already exists on `CurrentUser`; this is its first hard gate

Every `isAdmin` check in this app today is presentational (`canDeleteWitness`, saved-query publishing).
`requireRole(DEEDPOLL_ADMIN)` used here is the second hard area-gate in the app after `requireJudicial`, and
should reuse `require-role.ts` unchanged rather than growing a parallel admin-specific gate function — the
existing function already takes a `Role` parameter for exactly this reason.

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

**The checklist state is not persisted anywhere.** It is a per-visit confirmation, not a stored record — api
has no column for it and this plan does not add one. Reloading the review page re-asks it. This mirrors the
existing email check pages, where a reload is a new journey rather than resumed state.

### 5. The review page is reached from the ready list, and links back to it — never a standalone route

`src/pages/deed-polls/gazette/index.ts` (ready list) and `src/pages/deed-polls/gazette/[id]/review.ts` (the
checklist), following the existing `[id]` case-detail routing convention. The review page reads the same case
detail read the main case page uses (`findDeedPoll`) — do not add a second, gazette-specific case read.

### 6. Selection state lives in the confirmation POST body, not in session

The ready list's checkboxes post directly to the confirmation page (a plain form POST of selected case ids),
which mints the idempotency key (decision 7) and re-renders with the final list before the actual send. No
session-held "current batch" state: a caseworker-admin with two tabs open must not have one overwrite the
other's in-progress selection, the same reasoning the email idempotency key's docblock gives for why it is a
hidden form control rather than session state.

### 7. The idempotency key is minted when the confirmation page renders, never at the send

Following the existing email-send convention exactly (`docs/plans` — see `[id]/emails/[template]/preview.ts`
for the precedent): a UUID minted into a hidden form field when the confirmation page is first rendered,
carried by the one submit control, reused on a retry of that same page, and never regenerated by a correction
that returns to the ready list — because a correction is exactly when a second UUID would turn a retry into a
second send. A reload of the confirmation page is a new journey and mints a new key, matching the existing
rule.

### 8. A stale-selection 409 re-renders the confirmation page naming what changed, using api's own wording

Api's 409 (decision 5 of the api plan) names which case ids are no longer ready and why. Render api's own
sentence, the same "two refusals are distinguishable only by api's prose" discipline `send.ts` already
follows for the per-case email conflicts — do not compose a new sentence here or attempt to classify the
refusal further.

### 9. The history page is read-only, paged, and carries no send action

`src/pages/deed-polls/gazette/history.ts`. One reviewed page, no filtering beyond what api returns. Linked
from the ready list, not from the main dashboard — this is an admin audit view, not a worklist.

## Layers

1. **Client** — `libs/deed-poll-api-client`: `getReadyForPublication` (or extend the existing case-list
   client call with the new filter value — check whether the existing list operation already accepts any
   filter string before adding a second method), `sendGazetteNotice`, `getGazetteNoticeHistory`; wire types;
   mock support including stable ready/reviewed state for local development and the seeder.
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

Refresh `openapi.json` per `SPEC-PROVENANCE.md` once the api plan has merged. Verify the delta is exactly the
filter description text and the two new operations/schemas, nothing pre-existing altered. Record baselines.

- [ ] Contract reconciled; baselines recorded

### Task 1: Client, domain and mock

Read client/domain/mock and seed fixtures delivered by plan 16a. Sending and any business-approved
review/selection state remain outstanding; no mock "reviewed" state has been invented.

Add the client methods, wire types, view models, and mock support — including seed data covering an unreviewed
ready case, a reviewed-but-unsent one, and at least one past batch for the history page, so `yarn mock:seed`
exercises every state this feature renders.

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

The confirmation page, idempotency key minting (decision 7), the send call, and the stale-selection 409
handling (decision 8).

- [ ] Confirmation/send implemented; success, stale-selection and Notify-failure paths all tested

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
The spreadsheet generator and send endpoint remain outstanding API work.
