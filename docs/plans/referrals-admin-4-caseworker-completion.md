# Plan: referrals to the judiciary (admin follow-up 4) — complete the caseworker journey

## Overview

Business testing found that the caseworker journey delivered by admin-1 and admin-2 stops at the point a
judge returns a direction:

- the legacy “Referral to Master” fields and the live “Referrals” history are separate tabs;
- the API's direction fields are discarded by the caseworker view model;
- `Decided` is rendered as a raw status with copy that still says the case is with the judiciary;
- withdrawal remains available;
- the adapter has `closeReferral`, but no domain service or page calls it, so the case cannot leave the
  returned-direction count through the UI.

This plan completes that journey. A caseworker raises and reviews referrals from one **Referrals** tab, reads
the returned direction, carries it out, and explicitly marks it actioned. The companion API plan,
`deed-poll-api/docs/plans/referrals-api-4-caseworker-completion.md`, first tightens withdrawal so a `Decided`
referral cannot be withdrawn.

Lifecycle notes and the missing judicial “My referrals” list are separate follow-ups. They are not folded
into this plan.

## Preconditions and reconciliation gate

1. The API companion plan is merged and its OpenAPI document regenerated. It should produce **no contract
   delta**: withdrawal and closure already exist and their DTOs do not change.
2. Reconcile `libs/deed-poll-api-client/openapi.json` against the current API commit using
   `SPEC-PROVENANCE.md`. If any operation, schema, property or enum changed, stop; do not hide the drift in
   this feature.
3. Verify `closeReferral` already exists in the adapter and the mock already implements `/closure`.
4. Work from `master` after the current uncommitted Notify planning changes have been resolved. Do not mix
   those documents into this branch.
5. Measure the current test and lint baselines. Do not quote the totals in completed referral plans.

### Correction to preconditions 1 and 2 — 2026-09-21. **Do NOT refresh `openapi.json` in this branch.**

Preconditions 1 and 2 were written expecting api-4's merge to be the only api change outstanding. It is not,
and taken literally they now say *stop*. What is actually true:

- **api-4 is merged** (`deed-poll-api` PR #33). It changed no contract: api's own `OpenAPIPublisherTest` still
  asserts **33 caseworker and 4 judicial** operations, and passed in that build.
- **This repo's `openapi.json` is pinned to api commit `ee37173`** (api-3's merge, 18 September) —
  **35 operations, no `CaseEmailsResponse`, no email path.** So it is **three caseworker operations behind api
  master**, and every one of those three is notify-1's send path and notify-5's correspondence history.
- **A refresh is atomic.** `contract.test.ts` is set-equality in both directions, so there is no way to take
  api-4's zero-delta without also taking those three Notify operations and their schemas — which is
  `referrals-admin-2`'s companion Notify plan's work, being implemented concurrently in another worktree.
  Refreshing here would put the same wire functions on two branches.

**So this plan needs no refresh and no adapter change at all.** `closeReferral` already exists
(`libs/deed-poll-api-client/src/api/client.ts:374`), and `libs/deed-poll/src/referrals/service.ts` records that
closing was deliberately left out of the *domain* layer — which is exactly the gap this plan fills. The work is
domain service, view model, pages and the in-memory mock.

Precondition 2 is therefore replaced by: **verify the referral surface only.** The five
`/caseworker/cases/{id}/referrals*` operations, the four `/judicial/referrals*` ones, `ReferralResponse` and
`CreateReferralRequest` must be byte-identical to what is committed. **Stop** if any of them moved — that would
be real referral drift. A Notify-shaped delta is expected, is not this plan's, and must be left alone.

Steve's decision, 2026-09-21, taken with the collision on the table.

## End-to-end state model

| Referral state | Caseworker meaning | Available action |
|---|---|---|
| `Open` | Waiting for a judge to claim | Withdraw |
| `Claimed` | Being considered by the judiciary | Withdraw |
| `Decided` | Direction received — action needed | View direction; mark actioned |
| `Closed` | Direction actioned | Read-only |
| `Withdrawn` | Withdrawn before direction | Read-only |

The wire enum does not change. These are caseworker-facing labels and capabilities derived in one referral
view model, with API remaining the transition authority.

## Decisions — implement these, do not revisit

### 1. One Referrals tab owns the caseworker journey

Remove the separate editable **Referral to Master** tab from `FORM_TABS`. The **Referrals** tab remains the
single entry point for:

- referral history;
- the current referral and its status;
- raising another referral when none is live;
- viewing a direction;
- withdrawing before a direction;
- marking a returned direction as actioned.

Do not put the raise form inline in the tab. The existing “Refer this case to the judiciary” button and
dedicated question page are the established accessible form journey. “One place” means one case-detail
surface and one source of referral truth, not every control on one HTML page.

### 2. Preserve legacy referral fields as a read-only historical snapshot

The old fields (`referToMasterChoice`, referral dates/notes, `masterName`, `masterDirections`,
`masterDecision`, decision dates and Gazette choice) may contain migrated business records. Removing their
tab must not make those values inaccessible.

**Business confirmation, 2026-09-20:** retire these fields for new work and preserve populated values as
read-only history. Do not move the old editable form into the consolidated tab.

Extract the existing field metadata into a reusable legacy-referral section, but do not leave it in the
editable/navigation `FORM_TABS` list. The current module derives `EDITABLE_FIELDS`, `FIELD_BY_NAME` and the
query-builder catalogue from `FORM_TABS`, so simply deleting the tab would silently remove those fields from
formatting and query metadata as well. Split the catalogues deliberately:

- navigation/edit tabs exclude the legacy referral tab;
- the complete case-field catalogue still includes its definitions for formatting and query compatibility;
- editable-field derivation excludes the legacy section, preventing new writes through the generic case form.

In the Referrals panel, render a **Previous system referral information** summary only when at least one
legacy referral field has a value. It is read-only and clearly separated from the live referral history.

Do not copy those values into a `Referral`, write new referrals back into them, or use `migratedRecord` as the
only visibility test. The presence of legacy referral values is the evidence that the snapshot exists.
The generic `/edit/referral` route must cease to offer that tab. A bookmarked GET should redirect to the
case's `#referrals` panel; a POST to the retired route must be refused rather than falling back to the
Application tab and appearing to accept the wrong form.

### 3. Referral status and application status stay distinct

The case header's `DeedPollState` remains date-derived. A referral decision does not determine whether the
application should next await forms, documents, enrolment, return or another action. This plan therefore
does not mutate case dates and does not relabel the overall case state.

**Business confirmation, 2026-09-20:** the caseworker makes the case updates required by the direction and
then marks the referral actioned. Referral state does not automatically drive application status.

Instead:

- use the caseworker-facing referral labels in the table and detail page;
- label them explicitly as **Referral status**;
- explain `Decided` as “Direction received — action needed”;
- tell the caseworker to carry out the direction and make any necessary case updates before marking it
  actioned.

The closure confirmation is an acknowledgement of work completed, not an automatic case-state transition.
If deterministic decision-to-case-state rules are later approved, they require a separate plan.

### 4. Show the complete returned direction

The caseworker referral detail must render the fields the current API already supplies:

- decision;
- directions;
- publish-to-Gazette answer;
- decided by;
- decision date.

Render the direction section when a decision exists or the state is `Decided`/`Closed`. Preserve the
distinction between “No directions provided” and an absent direction. Show the Gazette answer as Yes/No only
when it was answered; do not turn null into No.

Claim information (`claimedBy`, `claimedAt`) may be shown while present, in a separate lifecycle section.
Do not use `modifiedBy` as a substitute for the deciding judge: closure changes the modifier while
`decidedBy` remains the judicial author.

### 5. Actions are explicit capabilities, not “not terminal”

Replace the current `terminal`-only action decision with explicit view-model capabilities:

- `canWithdraw`: `Open` or `Claimed`;
- `canClose`: `Decided`;
- neither action for `Closed`, `Withdrawn`, missing or unknown state.

The API remains authoritative and may still return 409 after a stale page. The UI capability prevents
offering a known-invalid action; it does not replace server enforcement.

The generic tab message “This case is with the judiciary. Withdraw the open referral before raising
another” must become state-sensitive. In particular, `Decided` must say that a direction is awaiting action
and must not tell the caseworker to withdraw it.

### 6. Closure is a confirmation journey over the existing operation

Add a domain `closeReferral(caseId, referralId, caller)` wrapper over the adapter's existing function.

From a `Decided` referral, offer **Mark direction as actioned**. It opens a GET confirmation page showing the
case reference, referral status and direction summary. The page states that the caseworker is confirming:

- the judicial direction has been carried out;
- any necessary application fields/dates have been updated;
- the referral will leave the returned-direction worklist.

POST the existing no-body closure operation and use post/redirect/get:

- success redirects to the referral detail with a success banner;
- a 409 redirects to a freshly read referral detail with a state-appropriate message;
- other failures follow the existing domain error handling;
- there is no state-changing GET.

Do not add a free-text closure note or duplicate the direction into the request. API stamps the authenticated
actor and preserves the judicial fields.

### 7. The attention banner and worklist remain the same query

Keep `currentReferralState:is:Decided` as the only definition of “returned — action needed”. Do not maintain
a local count or manually remove a row after closure. The successful API transition recomputes
`currentReferralState` to null, so the next list read supplies the reduced count and worklist.

The existing banner and filtered-list design from admin-2 is retained.

### 8. Bilingual, accessible and progressively enhanced

All new caseworker copy has matching `en`/`cy` structure and is included in the Welsh extraction/check.
Use GOV.UK summary lists, warning text, buttons, notification banners and error summaries. The confirmation
and closure work without JavaScript, have logical headings and focus order, and expose status in text rather
than colour alone.

## Layered implementation

### Adapter and mock

No spec or client-operation addition. Update the in-memory mock's withdrawal guard to match the API
companion plan: `Decided` returns 409; `Open` and `Claimed` remain withdrawable. Keep the existing closure
handler. Extend adapter/mock tests to drive `Claimed → Decided`, prove withdrawal is refused, then close and
prove `currentReferralState` becomes null.

### Domain

In `libs/deed-poll/src/referrals/`:

- add the thin `closeReferral` service and unit tests;
- expand `ReferralView` with display-ready direction/lifecycle values;
- replace raw state display with one exhaustive `REFERRAL_STATE_LABEL` map;
- expose `canWithdraw` and `canClose`;
- add a state-sensitive current-referral message/capability for the Referrals tab and rename `anyOpen` to
  terminology that reflects all three live states;
- build the optional legacy-referral snapshot from the existing field metadata without copying labels.

Keep transport and request/session concerns out of this layer.

### Pages

In `src/pages/deed-polls/`:

- consolidate the case detail tab and render legacy information, live history and available action from one
  Referrals panel;
- expand the referral detail page with lifecycle and direction sections;
- add the closure confirmation GET/POST route and template;
- handle closure success/conflict through redirect flags and a fresh read;
- update the existing withdrawal conflict copy so it is true for `Decided` as well as terminal states.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn turbo test test:app --concurrency=1
yarn lint
yarn test:e2e --workers=1
```

**Measured on this branch before Task 1, 2026-09-21 — not copied from an earlier plan:**

| Command | Baseline |
|---|---|
| `yarn turbo test test:app --concurrency=1` | **2,601 passed** across 8 packages, exit 0 |
| `yarn lint` | exit 0 — 2 warnings, 2 infos (pre-existing) |
| `yarn test:e2e --workers=1` | **35 passed in 3.5m**, exit 0 |

`yarn test:e2e` is in the gate because omitting it is how `dev-persona-switcher` shipped a broken branch: unit
tests, lint and build were all green while four browser journeys timed out. This plan changes the case detail
tab structure, which several e2e journeys traverse, so it is exposed to the same gap.

### This worktree needs three things done before any of that passes

Found the hard way, in this order:

1. **`yarn install`, then `yarn build`.** The unit suite runs from source through `vite-tsconfig-paths`, so it
   passes in a worktree with no `dist` — but `yarn idam:users` imports `@hmcts/deed-poll/dist/index.js` and dies
   with `ERR_MODULE_NOT_FOUND` until the libraries are built.
2. **`yarn dev:up`, then `yarn idam:users`.** The three e2e personas are seeded *into the running IDAM
   simulator container*, so they do not survive that container being recreated. Without them all three
   `auth.setup.ts` projects fail and **32 of 35 tests never run** — which reads as a suite-wide failure rather
   than a missing fixture.
3. **Nothing else may hold the compose container names.** `docker-compose.yml` hard-codes
   `container_name: deed-poll-redis` and `deed-poll-idam` (lines 12 and 42), so the names are global to the
   Docker daemon rather than scoped to the compose project. A **stopped** container from another checkout still
   owns the name, and Playwright's `webServer` then fails with `Conflict. The container name … is already in
   use`, reported as `Process from config.webServer was not able to start`.

**Consequence worth stating, because it affects another agent:** only one worktree can run e2e at a time. A
concurrent `yarn dev` or `yarn test:e2e` in the `notify-2` worktree will collide with this plan's gate, and
whichever starts second fails on the container name — not on its own code.

**And do not read a piped exit code as the result.** `yarn test:e2e … | tail` reports `tail`'s status, so the
first baseline attempt here looked like a pass (`exit 0`) while the suite had in fact started no tests at all.
Capture the status of the command itself.

## Tasks

### Task 0: Reconcile API, adapter and current UI — STOP on drift

Verify the companion API change is present, the OpenAPI document has no shape delta, the adapter already
contains `closeReferral`, and the mock has the existing closure transition. Record:

- operation/schema totals;
- `yarn turbo test test:app --concurrency=1` baseline;
- `yarn lint` baseline;
- relevant Playwright baseline.

Inventory the tests that assert the legacy tab, raw state labels, terminal-only withdrawal control and
returned-action count. Stop if Notify work or another branch has changed the same files unexpectedly.

- [ ] Contract and implementation reconciled; baselines recorded; no files changed

#### Reconciliation already performed, 2026-09-21 — read this instead of repeating it

Done in the parent session before this run, against `origin/master` at `20b50fa`:

| Checked | Found |
|---|---|
| api companion merged | Yes — `deed-poll-api` PR #33, zero contract delta, `OpenAPIPublisherTest` still 33 + 4 |
| `closeReferral` in the adapter | Yes — `libs/deed-poll-api-client/src/api/client.ts:374` |
| Closing absent from the domain layer | Yes, deliberately — `libs/deed-poll/src/referrals/service.ts:28` says so. **This is the gap the plan fills** |
| Referral surface in `openapi.json` | Unchanged. 35 operations, as `SPEC-PROVENANCE.md` records for `ee37173` |
| Notify delta | Present and **expected** — api master carries three more caseworker operations (notify-1, notify-5). **Not this plan's.** See the correction under Preconditions |

Baselines are in **Validation Commands** above: 2,601 unit, lint exit 0, e2e 35 passed. **Do not re-measure
them as Task 0 work** — re-measure at the end and compare.

**So Task 0 changes no files, and in particular does not touch `openapi.json`, `wire.ts`, `contract.test.ts`
or the mock's registration.** If the referral operations or `ReferralResponse`/`CreateReferralRequest` have
moved, stop and report. A Notify-shaped difference is not drift.

### Task 1: Align the mock and domain capabilities

Update the mock withdrawal rule and adapter-level tests. Add the domain closure wrapper. Refactor
`referrals-view.ts` to publish:

- exhaustive caseworker status labels;
- formatted claim and direction fields;
- `canWithdraw`/`canClose`;
- state-sensitive current-referral messaging;
- an optional read-only legacy-referral snapshot built from shared field metadata.

Unit-test all five states, null/unknown defensive behaviour, nullable direction fields, retained direction
after closure, and legacy information present/absent.

- [ ] Mock matches API withdrawal semantics; close wrapper added; complete view model and capabilities
      unit-tested; contract tests green

### Task 2: Consolidate the case detail Referrals tab

Separate the complete field catalogue from editable/navigation `FORM_TABS`, then remove the legacy referral
tab from navigation and its presentation visibility rule without dropping its formatting or query metadata.
Render its populated historical fields read-only within the Referrals panel under a clearly named heading.
Retain the live referral table, create button and degraded-read warning.

Update detail-view, presentation, edit-route and template tests to prove:

- exactly one referral tab is shown;
- populated legacy values remain readable;
- no legacy section appears when all values are absent;
- a GET of `/edit/referral` redirects to `#referrals` and a POST is refused rather than falling through to
  the Application tab;
- legacy referral fields retain formatting and existing query-builder compatibility but are absent from
  editable-field derivation;
- unavailable live referral data does not hide a present historical snapshot;
- live states produce the correct state-specific message and action availability.

- [ ] One Referrals tab owns current and historical information; legacy values preserved read-only; obsolete
      edit path removed; page/template tests green

### Task 3: Display the judicial direction and correct actions

Expand the referral detail page and template:

- show **Referral status** using the display label;
- show claim metadata when available;
- show decision, directions, Gazette answer, judge and date for `Decided`/`Closed`;
- show withdrawal only for `Open`/`Claimed`;
- show “Mark direction as actioned” only for `Decided`;
- show neither action for terminal or unknown states.

Update stale-conflict messages so they do not claim every refused withdrawal was already closed or
withdrawn. Test null direction text and null Gazette separately from explicit empty/No values.

- [ ] Caseworker can read the complete direction; labels and copy reflect each lifecycle state; controls
      match capabilities; page/template tests green

### Task 4: Implement the mark-as-actioned journey

Add the closure confirmation GET/POST route and template. The GET reads the case and referral in parallel
where appropriate and refuses to present a closure action for a non-`Decided` referral. The POST calls the
domain wrapper without pre-reading solely to enforce state; API owns the transition.

Test:

- confirmation content and direction summary;
- successful close and post/redirect/get success banner;
- 409 race handling with a fresh state on the detail page;
- 404/cross-case and ordinary unavailable failures;
- direct GET/POST attempts for non-`Decided` states;
- no closure payload or asserted user identity.

- [ ] Accessible confirmation journey closes only `Decided`; success and stale conflicts render correctly;
      domain/page/template tests green

### Task 5: End-to-end workflow and count

Add one complete Playwright journey:

1. raise a referral;
2. claim and direct it through the mock's judicial contract;
3. return as caseworker and follow the attention banner/worklist;
4. see the direction and “Direction received — action needed”;
5. verify withdrawal is absent;
6. confirm the direction has been actioned;
7. verify `Closed`, the preserved direction and the ability to raise another referral;
8. return to the dashboard and verify the global count has reduced by exactly one.

Include accessibility scans and Welsh checks at the meaningful pages within that journey. Keep the existing
withdraw-before-direction journey as separate coverage of a different outcome.

- [ ] Complete returned-direction/actioned journey passes against the real mock transitions; count and
      worklist update from API state; accessibility and Welsh checks pass

### Task 6: Documentation and full validation

Update completed referral plan cross-links and current architecture guidance that still describe the split
tabs, raw states or missing close UI as current behaviour. Regenerate/check the Welsh translation request if
copy changed.

Run:

```bash
yarn turbo test test:app --concurrency=1
yarn lint
yarn welsh:check
yarn test:e2e
```

Record final totals against Task 0's baseline and verify the six Jenkins-owned package scripts remain.

- [ ] Documentation current; full unit/app, lint, Welsh and E2E validation green; final totals recorded

## Out of scope

- Case notes for every referral lifecycle transition — recommendation 2.
- A judicial “My referrals” query or screen — recommendation 3, planned in
  `referrals-admin-6-judicial-my-referrals.md`.
- Automatically deriving an application state from `Approved`/`Rejected`.
- Changing the referral enum, closure endpoint or returned-action query.
- Editing or deleting legacy referral values in the API.
