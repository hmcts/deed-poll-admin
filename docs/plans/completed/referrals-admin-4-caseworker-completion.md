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

- [x] Contract and implementation reconciled; baselines recorded; no files changed

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

#### Re-verified against the api clone, 2026-09-21 — what api-4 actually changed

The narrowed Precondition 2 was checked against the api working copy rather than taken on trust, by diffing
`ee37173..origin/master` (`09d70e3`, the api-4 merge) across `src/main/**`. **No drift; proceed.**

| Checked | Found |
|---|---|
| Referral operations in this repo's `openapi.json` | The expected nine — five `/caseworker/cases/{id}/referrals*`, four `/judicial/referrals*`. 35 operations, 27 schemas, matching `SPEC-PROVENANCE.md` for `ee37173` |
| Referral/judicial files api-4 touched | Three: `ReferralState`, `ReferralService`, `CaseworkerReferralController`. **No DTO and no controller annotation** — the controller diff is javadoc only |
| `ReferralResponse` / `CreateReferralRequest` | Untouched. Neither DTO file appears in the diff at all, so there is no referral contract delta to take |
| Notify delta | As predicted: `/caseworker/cases/{id}/emails` and friends. api master's `OpenAPIPublisherTest` asserts **33 caseworker + 4 judicial**; our pin carries 30 + 4 + Spring's welcome route. The three missing are notify-1/notify-5's, and stay another branch's |
| Enum members | Unchanged — api-4 added the *method* `canBeWithdrawn()`, not a sixth state. `Open, Claimed, Decided, Closed, Withdrawn` still |

**The one substantive finding, which Task 1 must mirror.** api-4 did not narrow `isTerminal()`; it added a
second, independent predicate `ReferralState.canBeWithdrawn()` — true for `Open` and `Claimed` only — and
pointed withdrawal's guard at it. `isTerminal()` still means `Closed || Withdrawn` and still backs the other
two rules (one live referral per case, and the `currentReferralState` denormalisation), so `Decided` is
deliberately **non-terminal and not withdrawable**. api's javadoc says outright that narrowing `isTerminal()`
instead would have let a case raise a second referral beside a decided one *and* dropped the case out of the
returned-for-action queue. **Do not "simplify" the mock by narrowing its `isTerminal` either** — add the
second predicate, exactly as api did.

api also gives the refusal **two different messages**, because the caseworker's next action differs:

- `Decided` → `Referral {id} is Decided -- a direction has been recorded on it and must be actioned and the referral closed, rather than withdrawn`
- `Closed`/`Withdrawn` → `Referral {id} is already {state} and cannot be withdrawn`

Reusing "already X" for `Decided` would tell a caseworker looking at a returned direction that they had
already withdrawn it. Closure's message is unchanged and names the single state.

#### Inventory: what the later tasks have to move

Verified present at the paths given, so a task that cannot find one of these should stop rather than invent it:

| Thing | Where |
|---|---|
| Mock's withdrawal guard, still `isTerminal` | `libs/deed-poll-api-client/src/mock/server.ts:629`, with the docblock at :599 asserting the old rule — **both** need correcting, and the mock's closure handler at :634 is already right |
| Mock/adapter referral tests | `libs/deed-poll-api-client/src/mock/server.test.ts` — :889 asserts a `Claimed` withdrawal succeeds (**stays true**), :898 a second withdrawal is refused, :907 closure is refused while `Open`/`Withdrawn`, :918 a `Decided` close preserves the direction, :997 the `currentReferralState` sequence ending `null` |
| Domain layer's deliberate absence of closing | `libs/deed-poll/src/referrals/service.ts:28` — "Claiming, directing and closing are not here on purpose". Task 1 adds `closeReferral` and must **update that docblock** rather than leave it contradicting the file |
| `terminal`-only capability | `libs/deed-poll/src/referrals/referrals-view.ts:97`, and `anyOpen` derived from it at :119 with its docblock at :109 and the interface at :186/:195 |
| View-model tests to rework | `libs/deed-poll/src/referrals/referrals-view.test.ts` — :65 the two-terminal-states tag, :123-126 the per-state `terminal` table, :164/:178/:184/:201/:208 `anyOpen` including the `null`-state defensive case |
| Legacy tab definition | `libs/deed-poll/src/deed-poll/form-fields.ts:243` (`REFERRAL_TAB`, id `referral`, label "Referral to Master"), listed in `FORM_TABS` (:350) at :353, beside the live `referrals` subgrid tab at :363 |
| The catalogue split Task 2 needs | `EDITABLE_FIELDS` (:405) and `FIELD_BY_NAME` (:408) **both** flatten `FORM_TABS`, exactly as decision 2 warns. The comment at :360 records that `referral` and `referrals` are URL slugs and cannot be renamed apart |
| Tests naming the legacy tab | `libs/deed-poll/src/deed-poll/query-builder.test.ts`, `libs/deed-poll/src/deed-poll/detail-view.test.ts`, `src/pages/deed-polls/[id]/edit/[tab].test.ts` |
| The generic "with the judiciary" copy | `src/pages/deed-polls/[id].ts:71` (`referralAlreadyOpen`), with the degraded-read wording at :75 and the docblock at :69. Asserted by `src/pages/deed-polls/detail.njk.test.ts:173`, which currently covers `Open`, `Claimed` **and `Decided` together** — that parametrised case is what decision 5 splits |
| Page-level `anyOpen` assertions | `src/pages/deed-polls/[id].test.ts:184, 196, 197, 262` — two of them whole-object `toEqual`, so a new view-model field fails them by design |
| Returned-for-action count | `libs/deed-poll/src/referrals/returned-for-action.ts`, unchanged by this plan per decision 7; the mock proves the count at `server.test.ts:1025` and the worklist at :1054 |

**This worktree's libraries are already built** (`libs/deed-poll/dist/` is populated), so the first of the
three worktree preconditions above is satisfied. The other two are e2e-only and bite at Task 5.

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

- [x] Mock matches API withdrawal semantics; close wrapper added; complete view model and capabilities
      unit-tested; contract tests green

#### What Task 1 settled, which Tasks 2–5 build on

- **The mock gained a second predicate, not a narrower one.** `canBeWithdrawn` (`Open`/`Claimed`) beside an
  unchanged `isTerminal`, with api's two refusal messages in `withdrawalRefusal`
  (`libs/deed-poll-api-client/src/mock/server.ts`). `isTerminal` still backs the one-live-referral rule and
  `currentReferralState`, both now pinned from a `Decided` referral in `server.test.ts`.
- **`closeReferral` is in the domain layer** (`libs/deed-poll/src/referrals/service.ts`), with no pre-read and
  no body, and the docblock that said closing was deliberately absent now says why it is here.
- **The view model's vocabulary, which pages and e2e assert on:** `REFERRAL_STATE_LABEL` gives
  `Open → "Awaiting a judge"`, `Claimed → "With a judge"`, `Decided → "Direction received"`,
  `Closed → "Direction actioned"`, `Withdrawn → "Withdrawn"`; `REFERRAL_STATE_MEANING` adds the sentence, and
  `Decided`'s is **"Direction received — action needed"** — the phrase Task 5's journey looks for. `ReferralView`
  now carries `stateMeaning`, `live`, `canWithdraw`, `canClose`, `claim` and `direction`; `terminal` is gone.
- **`anyOpen` became `liveReferral: { id, state, message } | null`.** `message` is a key
  (`withJudiciary` / `directionReceived` / `stateUnknown`) and the copy lives in `src/pages/deed-polls/[id].ts`'s
  `liveReferralMessages`, so the tab no longer tells a caseworker with a returned direction to withdraw it.
  `src/pages/deed-polls/[id]/referrals/new.ts` resolves its 409 link through `liveReferral` now.
- **An unknown state offers neither action**, reversing the old "offer the withdraw and let api decide" — that
  rested on "not terminal" implying withdrawable, which `Decided` disproves. It still counts as **live**, so the
  raise stays withheld.
- **The legacy snapshot exists but is not rendered yet** (Task 2 places it):
  `buildLegacyReferralView(record)` in `libs/deed-poll/src/referrals/legacy-referral-view.ts` returns the
  populated retired fields or `null`, built from the now-exported `LEGACY_REFERRAL_TAB` — still in `FORM_TABS`
  until Task 2 splits the catalogues. `false` counts as a value, so `publishToLondonGazette: false` renders "No".
- Validation after Task 1: **2,642 unit tests** across 8 packages (baseline 2,601), `yarn lint` exit 0 with the
  same 2 warnings and 2 infos, **35 e2e passed** in 3.5m. `e2e-tests/tests/deed-polls.spec.ts` needed one
  assertion changed — the tag now reads "Awaiting a judge".

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

- [x] One Referrals tab owns current and historical information; legacy values preserved read-only; obsolete
      edit path removed; page/template tests green

#### What Task 2 settled, which Tasks 3–6 build on

- **The catalogue and the form are two lists now.** `CASE_FIELD_TABS` is every case field the app knows about,
  including `LEGACY_REFERRAL_TAB`; `FORM_TABS` is that list *filtered* — the tabs a caseworker navigates and
  edits. `FIELD_BY_NAME` and `query-fields.ts` read the catalogue, `EDITABLE_FIELDS`, `detail-view.ts` and
  `edit-view.ts` read the form. So the retired fields still format, still resolve a saved query and still appear
  in the query chooser under "Referral to Master", and nothing writes to them. `form-fields.test.ts` is new and
  pins each derivation to the right list — picking the wrong one fails silently in production.
- **`FormPresentation.tabs.referralToMaster` is gone**, along with `PresentationInput.referToMasterChoice`: there
  is no tab left for a flag to show or hide. Two conditional tabs remain, Enrolment and Return.
- **`/deed-polls/{id}/edit/referral` redirects to `#referrals` on GET and 404s on POST.** The GET answers before
  reading the case (the destination is the same for every case); the POST is refused by the existing
  `FORM_TABS.find` guard, which is what stops a stale form's body being written onto the Application tab.
- **The snapshot renders last in the panel and outside every branch of it**, so a failed referrals read degrades
  the live history and leaves the historical record in place. Copy: `legacyReferralHeading` ("Previous system
  referral information") and `legacyReferralIntro` in `src/pages/deed-polls/[id].ts`.
- **One correction to Task 1's `buildLegacyReferralView`, found by rendering it.**
  `publishToLondonGazette` is `z.boolean()` on the wire — not nullable, and defaulted at create — so *every* case
  holds a value and the section appeared on all of them over a single row. It is now in
  `ALWAYS_POPULATED_FIELDS`: still rendered inside a snapshot that exists, and no longer able to create one. It is
  a live field that happened to sit on the retired form (it gates `dateNoticeSentToLondonGazette` through
  `getFieldRules`), which is also the open question this leaves: retiring it removes its only editable control.
- Validation after Task 2: **2,667 unit tests** across 8 packages (baseline 2,601; 2,642 after Task 1), `yarn lint`
  exit 0 with the same 2 warnings and 2 infos, **35 e2e passed** in 3.6m, `yarn build` clean. No e2e change was
  needed — no journey visited the retired tab. `yarn welsh:check` exits 1 both before and after this task (333
  untranslated at HEAD, 335 now: the two new strings); regenerating the request is Task 6's.

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

- [x] Caseworker can read the complete direction; labels and copy reflect each lifecycle state; controls
      match capabilities; page/template tests green

#### What Task 3 settled, which Tasks 4–6 build on

- **The referral page is three sections now**, matching decision 4's "separate lifecycle section": the referral's
  own answers (status, reasons, notes, urgency), **Progress** (Raised, *Claimed by the judiciary* when a judge has
  picked it up, Last updated), and **Direction from the judiciary** when there is one. The claim row is never
  placeholdered — a referral nobody has claimed has no claim rather than an unrecorded one.
- **The status cell is a tag plus `stateMeaning`**, and both the detail page's row and the tab's table column are
  labelled **"Referral status"** (decision 3) — the case header carries a `DeedPollState` of its own and a
  direction does not set it. `stateMeaning` is omitted, not placeholdered, when api published no state.
- **`gazetteAnswer` is resolved in the handler, exactly as `src/pages/judicial/referrals/[referralId].ts` does
  it.** Three answers, because `publishToGazette` is nullish: `Yes`, `No`, and **"Not recorded"** for a direction
  that gave none. A template ternary would print "No" and assert a direction against publication.
- **"Mark direction as actioned" is a link, not a form**, because it opens Task 4's confirmation page; it points
  at `/deed-polls/{id}/referrals/{referralId}/close`, which **Task 4 must serve at that path** (`closeHref` is
  built in the handler, so the path is stated once). It renders on `canClose` and sits in the `elif` of the
  withdraw form, so the two can never both appear.
- **`withdrawRefused` is a sentence now, not a boolean, and the *page* chooses which** — api-4 gives the
  withdrawal 409 two meanings and only the fresh read knows which applies. Keyed on `canClose` rather than on the
  wire state, so the message and the control it names cannot drift: a `Decided` referral says the direction can no
  longer be withdrawn and must be actioned, and never "already been closed or withdrawn". `withdraw.ts` keeps one
  flag and its docblock records why the reason is not carried through the redirect.
- **One e2e assertion needed narrowing, and the reason generalises.** `getByText("Withdrawn")` matched the tag
  *and* "Withdrawn before a direction"; `.govuk-tag` alone also matches the phase banner and the persona strip. The
  journey now scopes to the status row — worth knowing for Task 5, which asserts the same pair on `Decided`.
- Validation after Task 3: **2,685 unit tests** across 8 packages (2,667 after Task 2), `yarn lint` exit 0 with the
  same 2 warnings and 2 infos, **35 e2e passed** in 3.5m.

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

- [x] Accessible confirmation journey closes only `Decided`; success and stale conflicts render correctly;
      domain/page/template tests green

#### What Task 4 settled, which Tasks 5–6 build on

- **The journey is `src/pages/deed-polls/[id]/referrals/[referralId]/close.ts` plus
  `src/pages/deed-polls/referral-close.njk`**, served at the path Task 3's `closeHref` already pointed at. The GET
  reads case and referral with `Promise.all` — both load-bearing, since a page that showed neither the reference nor
  the direction would be asking for an attestation about something it had not shown — and **redirects to the
  referral for anything but `Decided`**, keyed on `canClose`, so the same guard covers already-actioned, withdrawn,
  still-with-the-judiciary and unreadable states.
- **The POST reads nothing and sends nothing.** api refuses anything but `Decided` itself, so the state is checked
  where it is *rendered* and enforced where it is *committed*; a read in the POST would be stale by the time it
  acted on the answer. Pinned by a test that closes a referral the mocked read says is already `Closed`.
- **Both outcomes land on the referral (post/redirect/get).** `?close=actioned` renders a success notification
  banner above the freshly-read `Closed` state and the preserved direction; `?close=conflict` renders an error
  summary. A refresh of either is a plain GET.
- **The closure refusal is keyed on api's fresh *state*, unlike the withdrawal's**, and the asymmetry is
  deliberate: `withdrawRefusal` keys on `canClose` because its two sentences name the two controls the page
  offers, whereas a refused closure offers nothing — `Closed` and `Withdrawn` both end the referral. So
  `closeRefusal` names the likely race ("already been marked as actioned") when api says `Closed` and claims
  nothing about which of the rest otherwise.
- **The two refusals share one error summary** (`{% set refused = withdrawRefused or closeRefused %}`), as the
  judicial referral page shares its `refused` key: a caseworker arrives through one redirect or the other, never
  both. The sentences are still chosen in the handler.
- **One pre-existing test-harness bug fixed, and it matters beyond this task.** The `.njk` tests' `html()` helper
  spread the content pair **over** the model, the opposite of `renderInterceptorMiddleware`'s order
  (`libs/express-govuk-starter/src/i18n/locale-middleware.ts` merges `...selectedContent` then `...otherContent`).
  Any conditional whose sentence the handler resolves from its own `en` — `directionActioned` is the first —
  therefore rendered unconditionally in the test while behaving correctly in the app. Fixed in
  `referral-detail.njk.test.ts` and the new `referral-close.njk.test.ts`; **the other three
  (`detail.njk.test.ts`, `referral-form.njk.test.ts`, `queries/new.njk.test.ts`) still have the old order** and
  will mislead the same way the moment a handler resolves a string named like its `en` key.
- Validation after Task 4: **2,727 unit tests** across 8 packages (2,685 after Task 3), `yarn lint` exit 0 with the
  same 2 warnings and 2 infos, `yarn build` clean, **35 e2e passed** in 3.4m — no e2e change, since the journey is
  Task 5's. `yarn welsh:check` still exits 1 (399 strings, 374 identical in `cy`): Task 6's.
- **The first e2e run of this task was invalid and the reason will recur.** Playwright's
  `reuseExistingServer` picked up an app server on `:3000` owned by the **`notify-2-email-tab` worktree**, so 34
  tests passed against another branch's code and the referrals journey failed on Task 1's label. Check the port's
  owner (`ss -ltnp`, then `/proc/<pid>/cwd`) before believing an e2e failure in this worktree.

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

- [x] Complete returned-direction/actioned journey passes against the real mock transitions; count and
      worklist update from API state; accessibility and Welsh checks pass

#### What Task 5 settled, which Task 6 builds on

- **One journey, `e2e-tests/tests/deed-polls.spec.ts`'s "caseworker actions a returned direction, and the
  returned-direction count falls by one".** It raises through the form, claims and directs through api's judicial
  routes with a judge's token (`claimAndDirect`), finds the case from the dashboard banner and its worklist row,
  reads the direction, is offered no withdrawal, cancels once, confirms, and comes back to a `Closed` referral, a
  preserved direction and a case that may be referred again. The withdraw-before-direction journey is untouched
  beside it, as the plan asks.
- **The end-to-end proof of decision 4 is one pair of rows after the closure**: `Decided by` still names the judge
  while `Last updated` names the caseworker who actioned it. Reading the direction's author off `modifiedBy` — the
  mistake the view model's docblock warns about — swaps exactly those two, and nothing below a browser can show it.
- **"Falls by exactly one" is asserted on a query narrowed to the run's own surname**, not on an arithmetic
  baseline: `returnedForActionTotal(request, surname)` goes 1 → 0 across the closure. The global number is compared
  against api's total *at the same moment* instead (`expectReturnedForActionCountMatchesApi`), which is the claim
  decision 7 actually makes — the banner is that query, and nothing decrements a local count.
- **The existing returned-for-action test had to stop asserting a sum, and that is a fix rather than a
  concession.** It read a baseline and asserted baseline + 2, which was only safe while nothing else in the suite
  produced a `Decided` referral — `judicial.spec.ts` already records a direction, and this task's journey drives
  one to `Decided` and back, both in parallel workers. Its rows still pin that the seeded cases are in the
  worklist; its numbers are now compared with api. `seedReturnedForActionCases` no longer returns a `total`.
- **Two locator traps, both worth knowing before writing the next journey.** `govukButton` given an `href` renders
  `<a role="button">`, so `getByRole("link", { name: "Mark direction as actioned" })` matches nothing and the
  withdraw journey's absence assertion had been passing for the wrong reason — fixed to `button`. And
  `summaryRow` here anchors on the **whole** key where `judicial.spec.ts` can match a substring: the referral page
  carries both "Decision" and "Decision date", so a substring match resolves two rows and fails on strict mode
  instead of on the value.
- **The confirmation page's submit shares its words with the link that opens it**, so the journey asserts the URL
  between the two clicks: without that, a click landing before the navigation presses the link again and the test
  sits on a page it believes it has submitted.
- **The Welsh check runs while the referral is still `Decided`**, in its own context and session
  (`expectReferralWelshKeysResolve`) — the confirmation page does not exist in any other state and the referral page
  carries no direction in any other state, so afterwards there is nothing left to check.
- Validation after Task 5: **2,727 unit tests** across 8 packages (unchanged — this task touches only
  `e2e-tests/`), `yarn lint` exit 0 with the same 2 warnings and 2 infos, **36 e2e passed** in 3.7m against the
  35-test baseline, no flakes. The three worktree preconditions held: the libraries were already built, the IDAM
  personas were still seeded in the running container, and nothing else held ports 3000/3200 or the compose
  container names.

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

- [x] Documentation current; full unit/app, lint, Welsh and E2E validation green; final totals recorded

#### What Task 6 changed, and the final numbers

**Documentation.** Four files, all of them guidance that described superseded behaviour as current:

- **`.claude/rules/backend.md`'s `conflict` row** said api answers 409 "for a withdraw of one that is already
  terminal". It now states api-4's actual rule — withdrawal refused for anything but `Open`/`Claimed`, with
  `Decided` **neither withdrawable nor terminal**, and why narrowing `isTerminal()` was the wrong fix — and adds
  closure's 409 and its `?close=conflict` redirect. It also records that each 409 has more than one meaning, so
  the sentence comes from the fresh read.
- **`.claude/rules/backend.md` gained the case-field catalogue rule**, which nothing outside `form-fields.ts`
  documented: `CASE_FIELD_TABS` is what the app can format and query, `FORM_TABS` is what it navigates and
  edits, and which derivation reads which list. The failure mode is the point — delete a tab and its fields
  quietly leave formatting and query metadata with nothing failing.
- **`.claude/rules/testing.md` gained a Template Test Pattern section** for the `html()` merge order Task 4
  found, stated as the trap it is rather than a preference.
- **`CLAUDE.md`'s `Promise.allSettled` bullet** gained the corollary Task 2 established: what does not depend on
  the degraded call renders **outside every branch** of it, or a failed referrals read hides a historical record
  that was never at risk.

**Cross-links on the completed plans.** `referrals-admin-0` now carries one, because its Task 3 state machine
records "409 on withdraw when terminal" and that is no longer api's rule. `referrals-admin-1`'s existing link
now also names the three identifiers it records as current that have gone — `terminal`, `anyOpen` and the
editable `referral` tab. `referrals-admin-2`'s link was already right (the count query did not change), and
`referrals-admin-3` needed none: this plan did not touch the judicial surface.

**The `.njk` test harness is uniform now, and it was nine files rather than Task 4's three.**
`grep` found the wrong merge order in `deed-polls/{detail,referral-form,index}`, `deed-polls/queries/{new,edit,
delete,index}` and `judicial/referrals/{referral,index,direction-check,direction-form}` — Task 4 named the three
it had met. All eleven template tests now spread the content pair first. **The suite stayed green through the
change**, which is the useful finding: none of those nine pages currently has a handler resolving a value under
a key its own `en` also holds, so every one was a latent trap rather than a live false pass. The rule in
`testing.md` is what stops the tenth reintroducing it.

**Welsh.** `yarn welsh:extract` regenerated `.business_context/welsh-translation-request.csv`: **+46 rows, −3**.
The three removals are keys this plan replaced — `referralAlreadyOpen` (now three state-sensitive
`liveReferralMessages`), `alreadyClosed` (now `withdrawRefusedDecided`/`withdrawRefusedTerminal`) and the old
`stateLabel` value "Status" (now "Referral status"). The additions are Tasks 2–4's copy, including the whole of
`referrals/[referralId]/close.ts`. The new page area needed no `INCLUDE` change — it sits under
`src/pages/deed-polls`, already in scope — and every key parsed, confirmed by finding the close page's rows in
the CSV rather than by the script staying silent.

**`yarn welsh:check` exits 1, and cannot be made to exit 0 from this repo.** 399 strings, 374 still identical in
`cy` (367 prose, 7 not prose). That is the pending-translation state, not a defect this plan introduced: it
exited 1 at Task 0 too (333 untranslated at HEAD), and its only complaint is `cy` mirroring `en` — no missing or
unparsed key is reported. It goes green when the translator's Welsh comes back into `cy.ts`, which is the
request this task regenerated. **Recorded as amber rather than claimed green.**

**Final totals, against Task 0's baseline:**

| Command | Task 0 baseline | Final | |
|---|---|---|---|
| `yarn turbo test test:app --concurrency=1` | 2,601 passed, 8 packages, exit 0 | **2,727 passed**, 8 packages, exit 0 | +126 |
| `yarn lint` | exit 0 — 2 warnings, 2 infos | exit 0 — **the same** 2 warnings, 2 infos, 364 files | no new lint debt |
| `yarn test:e2e --workers=1` | 35 passed in 3.5m, exit 0 | **36 passed in 3.8m**, exit 0, no flakes | +1, Task 5's journey |
| `yarn build` | — | exit 0 | |
| `yarn welsh:check` | exit 1, 333 untranslated | exit 1, 374 of 399 untranslated | pending translation, see above |

Exit codes are the commands' own, not a pipe's. Ports 3000 and 3200 were verified free before the e2e run, so
Playwright started this worktree's server rather than reusing another's — Task 4's trap.

**The six Jenkins-owned scripts are all present** in `package.json`: `lint`, `test`, `test:coverage`,
`test:a11y`, `test:smoke`, `test:functional`. `src/pipeline.test.ts` passed inside the run above, which is what
pins them; the two `echo` scripts still carry the docblock explaining why they exist.

**Open questions this plan leaves, both already stated above and neither blocking:** `publishToLondonGazette` is
a live field whose only editable control sat on the retired tab (Task 2), and a caseworker holding both roles
still has no link to `/judicial/**` (CLAUDE.md's persona section, flagged by admin-3).

## Out of scope

- Case notes for every referral lifecycle transition — recommendation 2, **delivered 2026-09-21 by
  `referrals-admin-5-lifecycle-case-notes.md`** with no page code: api writes the notes and the Notes tab
  this plan left in place is where they are read.
- A judicial “My referrals” query or screen — recommendation 3, **delivered 2026-09-21 by
  `referrals-admin-6-judicial-my-referrals.md`** against api follow-up 6's `GET /judicial/referrals/mine`. It is
  what consumes this plan's closure: a decided referral stays on the judge's list until a caseworker actions the
  direction, and then the row goes.
- Automatically deriving an application state from `Approved`/`Rejected`.
- Changing the referral enum, closure endpoint or returned-action query.
- Editing or deleting legacy referral values in the API.
