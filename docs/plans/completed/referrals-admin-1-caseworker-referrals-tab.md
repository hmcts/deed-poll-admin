# Plan: referrals to the judiciary (admin 1 of 3) — the caseworker referrals tab

> **Follow-up:** `referrals-admin-4-caseworker-completion.md` consolidates the legacy “Referral to Master”
> and live “Referrals” surfaces, displays the judicial direction, and replaces the terminal-only action
> decision with explicit withdraw/close capabilities after business testing. Three names this plan records as
> current have gone with it: **`terminal`** on the view model (now `canWithdraw`/`canClose`, since `Decided`
> is non-terminal and still not withdrawable), **`anyOpen`** (now `liveReferral: { id, state, message }`, so
> the tab's message is state-sensitive), and the editable **`referral` tab** (retired from `FORM_TABS`, its
> fields kept read-only in the Referrals panel and its `/edit/referral` route redirecting on GET, 404 on
> POST).
>
> `referrals-admin-5-lifecycle-case-notes.md`, delivered 2026-09-21, brought the in-memory API and the
> end-to-end case Notes journey into step with the API's referral lifecycle notes: raise, claim, direction,
> actioned and withdrawal each append a case note, and the Notes tab on this plan's case page is where a
> caseworker reads the referral's history. No page code was added for it.

## Overview

**First of three `deed-poll-admin` plans** in the seven-plan referrals feature (three api, three admin, one
idam — see `deed-poll-api/docs/plans/referrals-api-*.md` and the workspace memory
`deed-poll-referrals-feature`). This one is the **caseworker's half of the ground floor**: on a case, a
caseworker can raise a referral to the judiciary, see the referral history for that case, view an open
referral, and withdraw one. It consumes **api-1** (`referrals-api-1-create-and-withdraw.md`) and nothing
beyond it — the judge does not appear here.

It maps exactly onto api-1's four operations:

| Admin action | api-1 operation |
|---|---|
| See a case's referrals (history + the current open one) | `GET /caseworker/cases/{id}/referrals` |
| Raise a referral | `POST /caseworker/cases/{id}/referrals` (409 if one is already open) |
| View one referral | `GET /caseworker/cases/{id}/referrals/{referralId}` |
| Withdraw an open referral | `POST /caseworker/cases/{id}/referrals/{referralId}/withdrawal` (409 if terminal) |

The dashboard "returned — action needed" count is **admin-2**; the judicial screen is **admin-3**. This plan
adds no judicial anything and no alerts — it is create/list/view/withdraw on the case, in the caseworker UI.

## AMENDED 2026-09-18 — the gate fired, and the adapter is now admin-0's

**What follows in this section is history. Read it, then read the amendment.** The original block said this
plan could not run until api-1 was merged and `openapi.json` refreshed, and that Task 1 must **stop** if the
refreshed spec's delta was anything other than api-1's four operations. **On 2026-09-18 it was run and it
stopped, correctly:** api had merged all four referral plans — api-1 (`#19`), api-2 (`#22`), api-2b (`#23`)
and api-3 (`#24`) — so the delta is **nine operations and eight schemas**, plus `currentReferralState` on
three case schemas. The gate did its job.

**The consequence: this plan no longer owns the spec, the adapter or the mock.** Because
`contract.test.ts` asserts set equality in both directions, a refreshed document obliges the adapter to carry
the whole current api in one commit — there is no api-1-shaped subset. That work is now
**[`referrals-admin-0-spec-and-adapter.md`](referrals-admin-0-spec-and-adapter.md)**, and this plan shrinks to
**domain + pages**.

**So the single precondition is now: admin-0 has landed on `master`.** Not "api-1 is merged", not "the spec is
refreshed" — admin-0 does both, for the whole referral surface, and its own Task 1 carries the reconciliation
gate. Task 1 here is now a *verification* that admin-0's adapter is present, and still a stop if it is not.

**What did not change:** every decision below, the tab decision, the four caseworker interactions this plan
builds, and the deliberate exclusion of close/judicial/dashboard-count. The UI scope was always api-1's four
operations and still is — the adapter simply knows about more than this plan uses, which is the normal state
of an adapter that tracks a whole api.

### The original hard block — superseded, kept for the reasoning

**This plan cannot be *run* until three things are true, and its Task 1 is a reconciliation gate that stops
if they are not.** This is the same discipline as `11-saved-queries-ui.md` and `12-case-search-ui.md`, for
the same reason: `libs/deed-poll-api-client/src/api/contract.test.ts` asserts the wire client's operations
and schema keys **equal** the api's published `libs/deed-poll-api-client/openapi.json` — bidirectionally, on
three axes (operation set, schema-key set, per-schema properties + enum members). Adding a referral schema or
operation to the client before the spec carries it turns that suite red from the first change.

The three preconditions:

1. **api-1 has been run and merged in `deed-poll-api`, and its OpenAPI spec is published.** api-1 adds the
   four referral operations and the `CreateReferralRequest` / `ReferralResponse` schemas to the published
   spec. Until that build has run, there is nothing to refresh *from*.
2. **`libs/deed-poll-api-client/openapi.json` here has been refreshed** per
   `libs/deed-poll-api-client/SPEC-PROVENANCE.md` — regenerate in the api clone with
   `./gradlew integration --tests "*OpenAPIPublisherTest*"` → `/tmp/openapi-specs.json`, reformat to 2-space
   JSON, update the provenance commit table, and **diff schemas property-by-property, not just paths** (a body
   published as `{}` matches on paths and lies on shape).
3. **Plans 11 and 12 are already merged into this repo's `master`, and this plan is branched off that
   master.** 11 and 12 also refresh `openapi.json` and edit `wire.ts`, `contract.test.ts` and
   `mock/server.ts`. Because the contract test asserts the *whole* schema-key set, a refresh that includes
   saved-queries + search + referrals against a client that only has referrals goes red on the saved-query
   and search schemas it is missing. So the ordering is **11 → 12 → admin-1**, each rebased on the last, and
   admin-1's refreshed spec is "api through saved-queries-and-search **and** api-1". Task 1 verifies the only
   *new* delta over the committed spec is the referral operations and schemas, and **stops** otherwise.

**The reconciliation gate (Task 1, first checkbox) is a real stop, not a formality.** If the refreshed spec's
operation-and-schema delta over the committed `openapi.json` is anything other than exactly `{POST/GET
/caseworker/cases/{id}/referrals, GET+POST the {referralId} sub-paths}` plus `CreateReferralRequest` and
`ReferralResponse`, then either an api plan beyond api-1 has already merged upstream (so the caseworker
`close` op from api-2, or api-3's judicial ops, are now in the spec and this plan's scope is wrong) or 11/12
are not yet in. In that case **stop and report** — do not implement extra operations to make the test pass,
and do not hand-trim the spec. The whole point of the gate is that the client tracks the *whole* current api,
so a scope surprise is a planning fact to surface, not an obstacle to code around.

*(Preconditions 1 and 2 are admin-0's now. Precondition 3 is satisfied — 11 and 12 are both merged and in
`docs/plans/completed/`.)*

## The three layers this repo enforces

`.claude/rules/backend.md` fixes a strict adapter → domain → pages architecture. A new sub-resource touches
all three, plus the mock and the spec, in this order (SPEC-PROVENANCE.md + backend.md "Reaching api"):

**Layers 1–3 are admin-0's and are DONE before this plan starts. This plan is layers 4 and 5 only.** They are
kept below because knowing what the adapter offers is how the domain layer is written correctly — but do not
edit `openapi.json`, `wire.ts`, `client.ts`, `contract.test.ts` or `mock/server.ts` here. If one of them
needs changing, that is a finding about admin-0, not work for this plan.

1. ~~**Spec** — refresh `openapi.json` (precondition 2 above).~~ **admin-0.**
2. **Adapter — admin-0.** `libs/deed-poll-api-client`: Zod schemas in `wire.ts` registered in `WIRE_SCHEMAS`
   (`wire.ts:502`) and `STRICT_RESPONSE_PROPERTIES` (`wire.ts:549`); four HTTP ops + path helpers in
   `client.ts` (mirror `listNotes`/`getNote`/`createNote` `client.ts:159-170` and `notePath`
   `client.ts:406`); ops registered in `contract.test.ts`'s `IMPLEMENTED_OPERATIONS` (`contract.test.ts:35`).
   Auth is never per-call — it rides in `ApiConfig` and `send()` sets the bearer header (`client.ts:544`).
3. **Mock — admin-0.** `libs/deed-poll-api-client/src/mock/server.ts`: extend the collection regex (`server.ts:213`)
   to reach `referrals` and its `…/{referralId}/withdrawal` sub-path, add a `referrals()` handler modelled on
   `notes()` (`server.ts:369`), and a `referrals` array on `MockCase` (`server.ts:1306`), seeded/reset
   (`server.ts:656`,`:683`). The mock derives request/response shapes from `WIRE_SCHEMAS`.
4. **Domain** — `libs/deed-poll/src/referrals/{service.ts,schemas.ts}`: Zod input schemas (mirror
   `witnesses/schemas.ts`), thin `callApi` service wrappers. Reads make dedicated calls like the **notes**
   service (`notes/service.ts:34`,`:38`) — **not** off the cached case, because referrals are not on the case
   payload (see below). Export from `libs/deed-poll/src/index.ts` (services only; never `callApi`/`ApiConfig`).
5. **Pages** — file-based routing under `src/pages/deed-polls/[id]/referrals/`. Mirror witnesses
   (`src/pages/deed-polls/[id]/witnesses/new.ts` + `[witnessId]/edit.ts`). Routes are protected by default
   (global `requireAuth`, `src/app.ts:163`); add no gating.

### Why referrals need a second api call, and the tab decision

The case wire schema (`caseDetailSchema`, `wire.ts:246-250`) carries only `notes`, `witnesses`, `documents`
— **not** referrals. So unlike those three, referrals cannot be read off the case payload the detail page
already fetches; the tab needs a **separate `GET …/referrals` call**. A second call is justified by the same
rule that admits `getCaseFieldRules` as a second call on the detail page (`[id].ts:69`, CLAUDE.md "one api
call per thing a page needs") — referrals are a distinct thing the page needs and are not in the case
payload.

**Decision (mine, flagged): surface referrals as a fourth detail tab, populated by a second call.** The
existing subgrid tabs (`notes`/`witnesses`/`documents`) are a closed union (`TabDef.subgrid`,
`form-fields.ts:79`) whose data is read off `record[subgrid]` (`detail-view.ts:142`). Referrals join them as
a fourth tab so the referral history sits "where caseworkers already look" (feature decision 7), but its data
comes from the second call rather than the case record. Two ways to wire it, and this plan takes the first:

- **(a) Extend the tab machinery** — add `referrals` to the `subgrid` union (`form-fields.ts:79`,
  `detail-view.ts:51`/`:79`/`:142`), a `FORM_TABS` entry (`form-fields.ts:~352`), fetch referrals in the
  handler (`[id].ts`) and hand them to `buildDetailTabs`, and add a `subgrid == "referrals"` panel branch in
  `detail.njk` (mirroring the notes panel, `detail.njk:75`). This keeps referrals inside the one `govukTabs`
  component the page already renders — visually and structurally consistent with the other three.

The alternative (b), a standalone `/deed-polls/{id}/referrals` page, is cleaner to build but splits the case
view; **(a) is the call** because consistency with the existing tabs is the feature's stated intent. *Flagged
for Steve — if you'd rather referrals live on their own page in MVP, this is a one-section redraw.*

The **create / view / withdraw** interactions are their own pages under `src/pages/deed-polls/[id]/referrals/`
regardless (a form doesn't belong in a tab panel), exactly as witnesses put create/edit on their own routes
and the tab only lists.

## Decisions taken — implement these, do not revisit

1. **Builds the UI over api-1's four operations only.** No claim, no direction, no close, no judicial, no
   dashboard count — those are admin-2 and admin-3. **Amended 2026-09-18:** the adapter admin-0 landed *does*
   offer more (all nine referral operations, because it tracks the whole api), and that is expected, not a
   gate failure. The rule is now about what this plan *calls*: a domain service or page here that touches
   `close` or any `/judicial/**` function is out of scope, even though the function exists.
2. **Reasons are a multi-select of the six api enum members**, rendered as GOV.UK checkboxes:
   `Minor`, `DomesticAbuse`, `NonPublication`, `DeclarantRequirementsNotMet`, `SeparatedOrEstranged`,
   `Other`. At least one required. **Display labels are an admin concern** — render human text ("Applicant is
   a minor", "Domestic abuse considerations", "Non-publication request", "Declarant requirements not met",
   "Separated or estranged", "Other") but **send the enum member** on the wire. The wire values are api's;
   the labels are ours (same split as the `Urgency` "Standard"/`Normal` label choice below).
3. **One free-text `notes` field, required when `Other` is ticked** (api-1 decision 5 unified it — there is
   one notes field, not two). Client-side: conditionally-revealed textarea under the `Other` checkbox
   (GOV.UK conditional reveal), validated required when `Other` is among the selected reasons.
4. **Urgency is a two-option radio (`Normal`/`Urgent`), labelled "Standard"/"Urgent" in the UI**, sending the
   api enum member. When `Urgent` is chosen, a `urgencyReason` free-text is **required** (conditional reveal,
   same pattern as `Other`). This is the referral's own urgency, distinct from the case's.
5. **Validate in the page with Zod, mirror api's field errors back onto controls.** A `createReferralSchema`
   in `libs/deed-poll/src/referrals/schemas.ts` (mirror `witnesses/schemas.ts:8`), `safeParse(submitted(req))`
   in the POST handler, `zodErrorToFieldErrors` for the error summary, and a `try/catch` mapping api's
   `InvalidInputError` field errors back to fields (witnesses `new.ts:76-93` is the template). The two
   conditional-required rules (notes-when-Other, urgencyReason-when-Urgent) are expressed in the Zod schema
   with `superRefine` so the client catches them before the round trip, **and** the api's 400 for the same
   rules is handled, because the api is the authority.
6. **The 409s are first-class UI, not stack traces.** api-1 returns 409 for "a referral is already open on
   this case" (on create) and "referral already terminal" (on withdraw). The domain layer maps 409 to a
   `ConflictError` (`deed-poll-api.ts` classification); the pages render it as a page-level error message —
   on create, "This case already has an open referral" with a link to view it; on withdraw, "This referral
   has already been closed or withdrawn." Do **not** show a raw error page for an expected 409.
7. **Withdraw is a POST with a confirmation, keyed on the referral, not a delete.** A view page for an open
   referral carries a "Withdraw this referral" action that POSTs to `…/referrals/{referralId}/withdrawal`;
   model it on the witness-delete branch (`witnesses/[witnessId]/edit.ts:103-106`) — action-branch first,
   then redirect to the case with the referrals tab anchored. A withdrawn/closed referral shows read-only
   with no withdraw action.
8. **The referral view is read-only and shows the referral's own fields** — reasons (as labels), notes,
   urgency + reason, state, and the audit fields. It does **not** restate the application data (that is on the
   case detail already); a referral view is one round trip for the referral (api-1 decision, `ReferralResponse`
   carries no case data).
9. **`migrated` referrals render honestly.** api-1 backfills power-app referrals with an empty `reasons`
   array and `migrated = true`. The list and view must tolerate an empty reason set and label such a referral
   as migrated ("Migrated from the previous system") rather than showing a blank reasons cell as if it were a
   bug (api-1 decision 12).
10. **No local state logic.** The client does not compute "is a referral open" or which actions are allowed —
    it renders what the api returns (`state`) and lets the api enforce transitions (a withdraw of a terminal
    referral is the api's 409, decision 6). This mirrors plan 12's "no local matching" rule: the api owns the
    rules, the UI renders the answer.

## Constraints

- **`turbo test test:app --concurrency=1` is the test command, not bare `yarn test`.** A bare `yarn test`
  has been observed to report a false green/red ("0 successful, 8 total", "no tests" — nothing ran). Run the
  turbo task with `--concurrency=1` on this machine; it is the invocation that actually executes the ~1,700
  app tests plus the `libs/*` workspaces. (Confirmed repo gotcha; see the workspace memory
  `deed-poll-admin-yarn-test-false-red`.)
- **Vitest, colocated `*.test.ts`.** Page tests mock `@hmcts/deed-poll` with `importOriginal` spread so the
  real schema runs while services are stubbed (witnesses `new.test.ts:9-13`); doubles from
  `src/express-doubles.ts` (`pageRequest`/`pageResponse`). Domain/service tests mock
  `@hmcts/deed-poll-api-client`, spreading the original to keep enum arrays, and return `ApiResult` unions.
- **The adapter layer changes must land atomically in one task.** Refresh spec + `wire.ts` + `client.ts` +
  `contract.test.ts` + mock must all go in together, or the contract test is red between tasks. This is the
  same rule api-1 applied to its operation-count task: the thing that would go red and the thing that fixes
  it are the same change.
- **Do not export `callApi`/`ApiConfig` from `libs/deed-poll/src/index.ts`** (`index.ts:9-15`); export only
  the referral service. Do not export `wire.ts` or the mock from the client package index (`index.ts:14`
  re-exports only `./api/client.js`).
- **File-based routing, no router index.** `[param]` → `:param`, static beats dynamic via `sortRoutes`
  (`route-discovery.ts:54`), so `referrals/new.ts` resolves before `referrals/[referralId].ts` — the same
  ordering witnesses relies on. Create the files; do not touch `src/app.ts`.
- **Routes are protected by default.** `requireAuth` is global (`src/app.ts:163`) with a `PUBLIC_PATHS`
  allowlist; new `/deed-polls/...` routes are authenticated with no work. Never invert to a denylist
  (`require-auth.ts:7-8`). Referral writes carry only the token; the api enforces any role gate.
- **Bilingual (en/cy) content**, as every existing page renders `{ en, cy }` — follow the witness-form
  content structure. Welsh can be the English text where a translation is not yet available, matching how the
  repo already handles untranslated strings, but the content keys must exist so the template does not break.
- **The six pipeline scripts must all still exist** (`package.json:16-22`, guarded by `src/pipeline.test.ts`)
  — do not remove or rename `test`, `test:app`, `test:coverage`, `test:e2e`, `lint`, `build`.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn install --frozen-lockfile
yarn lint
turbo test test:app --concurrency=1
```

`turbo test test:app` runs the app's Vitest suite (the root package, hence the `test:app` task —
`package.json:14`) **and** the `libs/*` workspaces including `libs/deed-poll-api-client`'s `contract.test.ts`
and `client.test.ts`. So the contract test is part of this gate: it is why Task 1 must refresh the spec and
bring the whole adapter layer in line as one green step.

**Measure the baseline on this branch before Task 1** by running the command above and recording the total
test count, and record the final count next to it in the last task. Do not quote a count from another plan;
11 and 12 will have moved it.

**A Vitest worker timeout is an environment failure, not a code failure** — this devcontainer's filesystem is
slow; re-run before investigating a "timeout"/"worker terminated" error rather than an assertion, and
`--concurrency=1` is deliberate for that reason.

## Tasks

### Task 1: Verify admin-0's adapter is present, and stop if it is not (the gate)

**Amended 2026-09-18. This task used to refresh the spec and build the adapter; admin-0 does that now.** What
is left is a verification, and it is still a real stop — running the domain layer against an adapter that does
not carry referrals fails in a confusing place, several tasks later.

**Change nothing in this task.** Confirm all four, from the tree you are on:

1. **`openapi.json` carries the referral surface** — nine referral operations and the eight referral schemas,
   with `SPEC-PROVENANCE.md`'s top row naming api `ee37173` or later. A shortcut to check the operations:

   ```bash
   node -e 'const s=require("./libs/deed-poll-api-client/openapi.json");console.log(Object.keys(s.paths).filter(p=>/referral/i.test(p)))'
   ```

2. **The adapter implements the four this plan needs** — `listReferrals`, `getReferral`, `createReferral`,
   `withdrawReferral` exported from `libs/deed-poll-api-client`, and the referral types with them. The other
   five (`close` and the four judicial) will also be there; that is admin-0 tracking the whole api and is not
   a problem to fix.
3. **The mock answers them** — `mock/server.ts` routes `/caseworker/cases/{id}/referrals` and its
   `withdrawal` sub-path, enforces one-non-terminal-per-case, and returns 409 on the two conflicts this plan
   renders (decision 6). **Verify the 409s specifically**: a mock that returns 200 where api returns 409 is
   how the conflict UI ships untested.
4. **Both validation commands are green before any edit**, with the totals recorded as this plan's baseline.

**If any of the four fails, stop and report — do not do admin-0's work here.** The likely cause is simply that
admin-0 has not run or has not merged, in which case the fix is to run it, not to patch the adapter from
inside this plan.

- [x] Gate passed: the nine referral operations and eight schemas present in `openapi.json` with provenance at
      api `ee37173` or later; the four caseworker adapter functions and their types exported; the mock routing
      both paths and returning 409 on already-open and on terminal-withdraw; both validation commands green
      with the baseline totals recorded

**Gate result 2026-09-18 — passed on all four. admin-0 has landed; proceed to Task 2.**

1. **Spec** — `openapi.json` carries **9 referral operations** across 8 paths (5 caseworker:
   `GET`+`POST …/referrals`, `GET …/{referralId}`, `POST …/withdrawal`, `POST …/closure`; 4 judicial:
   `GET /judicial/referrals`, `GET …/{referralId}`, `POST …/claim`, `POST …/direction`) and all **8 referral
   schemas** (`CreateReferralRequest`, `ReferralResponse`, `JudicialDirectionRequest`, `JudicialPoolResponse`,
   `JudicialReferralSummary`, `JudicialReferralDetail`, `JudicialCaseView`, `JudicialCaseNote`). Document
   totals: 35 operations across 22 paths, 27 schemas. `SPEC-PROVENANCE.md`'s top row is api
   `ee3717313d3cd841608b05a38f4b9a9598f84a30` — exactly the gate's floor. All nine are registered in
   `contract.test.ts` (`:54-58`, `:67-70`).
2. **Adapter** — the four this plan calls are exported from `client.ts`: `listReferrals` (`:338`), `getReferral`
   (`:343`), `createReferral` (`:354`), `withdrawReferral` (`:364`), with `referralPath` as the shared helper.
   Types alongside them: `Referral` (`:838`), `ReferralCreate` (`:839`), `ReferralState` (`:870`),
   `ReferralReason` (`:877`). `closeReferral` (`:374`) and the four judicial functions (`:484-506`) are also
   there — expected, and **out of scope per decision 1**: nothing this plan writes may call them. The package
   index re-exports only `./api/client.js`, so `wire.ts` and the mock stay private as the constraints require.
3. **Mock** — one regex reaches all three sub-resources plus the `withdrawal`/`closure` actions
   (`server.ts:266`), dispatching to `referrals()` (`:603`); `referrals: []` is on `MockCase` and seeded
   (`:399`). Both 409s this plan renders are real, not 200s: **already-open on create** —
   `record.referrals.some(candidate => !isTerminal(candidate.state))` → 409 (`:661-662`), ordered *after* the
   body checks as api orders them; **terminal withdraw** — `isTerminal(referral.state)` → 409 (`:629`). Each is
   covered twice over, at mock level (`server.test.ts:870`, `:898`) and through the adapter
   (`client.test.ts:632`, `:701`), so the conflict UI has a contract to test against.
4. **Baseline (this branch, before any edit)** — `yarn install --frozen-lockfile` clean; `yarn lint` **exit 0**
   (2 pre-existing `noUndeclaredEnvVars` warnings in `src/server.test.ts` / `src/session-store.test.ts`, no
   errors); `turbo test test:app --concurrency=1` **8 successful, 8 total** — not the false-green "0
   successful" the constraints warn about.

   | Workspace | Files | Tests |
   |---|---|---|
   | `//` (the app, `test:app`) | 42 | 621 passed, 3 skipped (624) |
   | `@hmcts/deed-poll` | 45 | 752 |
   | `@hmcts/deed-poll-api-client` | 4 | 325 |
   | `@hmcts-cft/cloud-native-platform` | 10 | 140 |
   | `@hmcts-cft/express-govuk-starter` | 12 | 127 |
   | `@hmcts-cft/simple-router` | 4 | 41 |
   | `@hmcts-cft/express-session-postgres` | 2 | 23 |
   | `@hmcts-cft/express-session-redis` | 1 | 7 |
   | **Baseline total** | **120** | **2,036 passed, 3 skipped (2,039)** |

   Task 4 records the final count against this. Note the baseline is higher than plans 11/12 would suggest
   because admin-0's adapter work added to `@hmcts/deed-poll-api-client` — quote this table, not theirs.

### Task 2: The domain layer — schemas and service

`libs/deed-poll/src/referrals/`:
- `schemas.ts`: `createReferralSchema` (mirror `witnesses/schemas.ts:8`) — `reasons` a non-empty array of the
  six enum members; `urgency` the two-value enum; `notes` and `urgencyReason` optional at the field level but
  a `superRefine` requiring `notes` when `reasons` includes `Other` and `urgencyReason` when `urgency` is
  `Urgent`, each raising a `FieldError` on the right path so the summary links resolve.
- `service.ts`: `findReferrals(caseId, config)` and `findReferral(caseId, referralId, config)` as **dedicated
  calls** (model on `notes/service.ts:34`,`:38`, not the off-the-case witnesses reads); `createReferral` and
  `withdrawReferral` as one-line `callApi` wrappers (witnesses `service.ts:44`). Classification of api errors
  (409 → `ConflictError`, 400 → `InvalidInputError` carrying api field errors) is `callApi`'s job
  (`deed-poll-api.ts:62-67`,`:133-150`) — the service does not translate.
- Export the service (not schemas' internals, not `callApi`) from `libs/deed-poll/src/index.ts` (witnesses at
  `index.ts:59`).

- [x] `createReferralSchema` enforces ≥1 reason, notes-when-Other, urgencyReason-when-Urgent, each as a
      field-scoped error; service has dedicated `findReferrals`/`findReferral` calls and `createReferral`/
      `withdrawReferral` wrappers; api 409/400 surface as `ConflictError`/`InvalidInputError` via `callApi`;
      service exported from the domain index; unit tests mock `@hmcts/deed-poll-api-client` and cover each
      validation rule and each classified failure; `turbo test test:app --concurrency=1` green

**Done 2026-09-18.** `libs/deed-poll/src/referrals/{schemas,service}.ts` plus their colocated tests, and two
lines added to `libs/deed-poll/src/index.ts` (schemas + service; no `callApi`, no `ApiConfig`).

Three decisions worth knowing before Task 3 writes the pages against these:

- **`urgency` is required in this schema although api publishes it as optional.** A narrowing, not a
  disagreement: the form always renders both radios so "no answer" is not a body it can send, and the
  `urgencyReason` rule hinges on the answer. Its message is "Select how urgent this referral is".
- **The messages live in the schema, not the page** — `../saved-queries/schemas.ts`'s split rather than
  `../witnesses/schemas.ts`'s. `notes` has two different things to say about it (required-because-`Other`,
  too-long) and a page mapping one message per field cannot say both. The *labels* are still the page's
  (decision 2). So Task 3's POST handler feeds `zodErrorToFieldErrors(parsed.error)` straight to the summary
  rather than re-wording it: `reasons` → "Select at least one reason for referring this case", `notes` →
  "Enter the other reason for referring this case", `urgencyReason` → "Enter why this referral is urgent".
- **Both bounds and both member sets are read off api, never restated.** `MAX_REFERRAL_NOTES` (1000) and
  `MAX_REFERRAL_URGENCY_REASON` (500) are exported for the form's hints; `reasons`/`urgency` are built from the
  client's `REFERRAL_REASON`/`URGENCY` arrays, so the checkbox list Task 3 renders should map over the array
  rather than typing six values out again.

Whitespace-only `notes`/`urgencyReason` are trimmed to `undefined`, so "   " fails the conditional rule rather
than satisfying it. `@hmcts/deed-poll` went 752 → **789** tests (45 → 47 files); `yarn lint` unchanged at the
baseline's 2 pre-existing warnings; `yarn turbo build` clean, so the DTO type-checks against the adapter's
`ReferralCreate`.

### Task 3: The pages — raise, view, withdraw

Under `src/pages/deed-polls/[id]/referrals/` (mirror witnesses):
- `new.ts` + `referral-form.njk`: GET renders the form (reasons checkboxes with conditional-reveal notes
  under `Other`; urgency radios with conditional-reveal urgency reason); POST `safeParse` →
  `zodErrorToFieldErrors` on failure, service call + `try/catch` mapping api field errors and the create-409
  ("already an open referral", with a link to it) on success/conflict; redirect to
  `/deed-polls/{id}#referrals` on success. `res.status(400)` on re-render, `novalidate`, `govukErrorSummary`
  before the `<h1>`, submitted values preserved — all per witnesses `new.ts` / `witness-form.njk`.
- `[referralId].ts` + `referral-detail.njk`: GET renders the referral read-only (reasons as labels, notes,
  urgency + reason, state, audit; migrated referrals labelled per decision 9). If the referral is
  non-terminal, show a "Withdraw this referral" action.
- `[referralId]/withdraw.ts`: POST-only, model on the witness-delete branch; call `withdrawReferral`, handle
  the terminal-409 ("already closed or withdrawn"), redirect to `/deed-polls/{id}#referrals`.

Page tests (`*.test.ts` beside each): `vi.mock("@hmcts/deed-poll", importOriginal)` so the real schema runs;
assert on `res.render.mock.calls[0][1]` and `res.redirect`/`res.status`. Cover: valid create → redirect;
missing reason → 400 with summary; `Other` without notes → 400; `Urgent` without reason → 400; create when
one open → the 409 message with the link; view of an open vs terminal referral (withdraw action present/
absent); withdraw success → redirect; withdraw of terminal → the 409 message.

- [x] Raise/view/withdraw pages live and route correctly (static-before-dynamic ordering holds); conditional
      reveals for notes and urgency reason; error summary + inline errors + preserved values; both 409s render
      as page messages not error pages; migrated referral renders honestly; page tests cover each path;
      `turbo test test:app --concurrency=1` green

**Done 2026-09-18.** Three routes, two templates and a view model:

| File | What it is |
|---|---|
| `src/pages/deed-polls/[id]/referrals/new.ts` + `deed-polls/referral-form.njk` | raise |
| `src/pages/deed-polls/[id]/referrals/[referralId].ts` + `deed-polls/referral-detail.njk` | view |
| `src/pages/deed-polls/[id]/referrals/[referralId]/withdraw.ts` | withdraw (POST only) |
| `libs/deed-poll/src/referrals/referrals-view.ts` | the labels and one referral formatted, exported from the domain index |

Templates sit beside `witness-form.njk` in `src/pages/deed-polls/`, which is where this app keeps them — any
`.ts` under `src/pages/` is a route, so a shared non-route module cannot live there.

Five decisions Task 4 should know about:

- **A fourth file, `referrals-view.ts`, holds the labels.** The reason wording is needed by the raise form, the
  referral view **and** Task 4's tab, and three copies of "Applicant is a minor" is three places for the
  business's wording to drift. It follows `documents-view.ts` exactly: maps keyed by api's member arrays (so a
  member added at api's end is a type error, not a blank cell), `REFERRAL_REASON_CHOICES` /
  `REFERRAL_URGENCY_CHOICES` for the controls, `REFERRAL_STATE_TAG` for the tags, and `buildReferralDetail`.
  **Task 4's panel should render rows through it rather than reading `referral.*` in the template.**
  `REFERRAL_URGENCY_LABEL.Normal` is deliberately `"Standard"` where `URGENCY_LABEL.Normal` is `"Normal"` —
  same api enum, two questions.
- **`terminal` is the only state rule, and it lives on the view model.** Decision 10 holds: it governs whether
  a control is rendered and nothing else, an unpublished `state` counts as *not* terminal so api gets the final
  word, and the refusal itself is api's 409. Task 4's raise button can ask the same question of the list.
- **The create-409 costs one extra read, on that path only.** api's 409 says *a* referral is open, not which,
  and "view the open referral" needs an id — so `openReferralHref` calls `findReferrals` and links to the
  non-terminal one, falling back to `…#referrals` if it has gone in between. Status is **409**, not 400.
- **The withdraw-409 is a redirect, not a render.** `withdraw.ts` sends the caseworker to
  `…/referrals/{id}?withdraw=conflict` and the referral view says "This referral has already been closed or
  withdrawn." The forms' objection to `?error=` is about losing typed input; a withdrawal has none, and the
  state shown beside the message has to be re-read to be true. It also keeps the wording in the one page that
  owns it instead of copying ~18 content keys into a POST-only route.
- **Zod's messages go straight to the summary**, per Task 2's note — no `en.fieldErrors` map like the witness
  forms have. `fieldMessages` keys on the path's first segment so a `reasons.0` issue lands on the group.

Route ordering verified by running `sortRoutes(discoverRoutes("src/pages"))`: `…/referrals/new` →
`…/referrals/:referralId` → `…/referrals/:referralId/withdraw`, so the static file beats the sibling dynamic
one and the `[referralId].ts` file and `[referralId]/` directory coexist (routes are keyed by URL path). Not
asserted in a test — `discoverRoutes`/`sortRoutes` are not exported from `@hmcts-cft/simple-router`'s index, and
notes/witnesses/documents document the same ordering in a docblock rather than pinning it.

Two `.njk.test.ts` files render the templates through `nunjucks.configure` (the `index.njk.test.ts` pattern),
because the conditional reveal is markup a view model cannot show: they assert the checkbox's
`data-aria-controls` actually names the div holding `notes`, that `Normal` reveals nothing, that withdraw is a
form that disappears on a terminal referral, and that a migrated referral says so.

The app went 42 → **47** test files and 621 → **678** passing; `@hmcts/deed-poll` 47 → **48** files and 789 →
**809**. `yarn lint` unchanged at the baseline's 2 pre-existing warnings; `yarn turbo build` clean.

### Task 4: The tab, and full validation

Wire referrals in as the fourth detail tab (decision, option a):
- `form-fields.ts`: add `referrals` to the `TabDef.subgrid` union (`:79`) and a `FORM_TABS` entry
  (`{ id: "referrals", label: "Referrals", sections: [], subgrid: "referrals" }`, near `:352`).
- `detail-view.ts`: extend the `subgrid` handling (`:51`/`:79`/`:142`) so a `referrals` subgrid tab is built
  with `empty` driven by the referral count and no sections.
- `[id].ts`: fetch the case's referrals via `findReferrals` (the justified second call, like
  `getCaseFieldRules` `:69`) and hand them to `buildDetailTabs` so `record.referrals` populates the panel.
- `detail.njk`: add a `subgrid == "referrals"` panel branch (mirror the notes panel `:75`) rendering the
  referral list — newest first, state as a GOV.UK tag, reasons as labels (or "Migrated"), a link to each
  referral view, and a "Raise a referral" button that is present only when no referral is currently open
  (the api list tells you; do not compute state rules beyond "is any state non-terminal").

Then:
- A page/integration test that the detail page renders the referrals tab, lists referrals from the second
  call, shows the raise button only when none is open, and links to a referral view.
- Confirm the tab's `empty` state (no referrals) renders cleanly.

- [x] Referrals tab renders in `govukTabs` with list, tags, labels, per-referral links and a
      conditionally-shown raise button; `[id].ts` makes the second call and the panel is populated; empty
      state clean; detail-page test covers the tab; `yarn lint` clean; `turbo test test:app --concurrency=1`
      green; final test count recorded next to the baseline

**Done 2026-09-18.** Option (a) as decided — referrals are the fourth subgrid tab inside the one `govukTabs`
the detail page already renders, not a standalone page.

| File | Change |
|---|---|
| `libs/deed-poll/src/deed-poll/form-fields.ts` | `referrals` in the `TabDef.subgrid` union; `FORM_TABS` entry, last |
| `libs/deed-poll/src/deed-poll/detail-view.ts` | `DetailTab.subgrid` now derives from `TabDef["subgrid"]` rather than restating it |
| `libs/deed-poll/src/referrals/referrals-view.ts` | `buildReferralsView` — the tab's rows, count and `anyOpen` |
| `src/pages/deed-polls/[id].ts` | the `findReferrals` call, merged into the record and passed as a view model |
| `src/pages/deed-polls/detail.njk` | the `subgrid == "referrals"` panel |
| `src/pages/deed-polls/detail.njk.test.ts` | new — the panel's markup |

Four things worth knowing:

- **`referrals` and `referral` are different tabs.** `REFERRAL_TAB` holds the case's own "Refer to Master?"
  fields, ported from the Dynamics form and conditionally visible; the new one lists the referrals actually
  raised. Both ids are edit-route slugs (`/deed-polls/{id}/edit/referral`), so neither could be renamed to tell
  them apart — hence the comment at the `FORM_TABS` entry. `tabVisible`'s `case "referral"` is untouched and
  still means the old one.
- **The merge is the whole mechanism, and it is one line.** `subgridCount` reads `record[subgrid]`, so
  `buildDetailTabs({ ...found, referrals }, …)` is what makes the tab non-empty; without it the tab renders
  "None recorded" on a referred case and nothing fails. `detail-view.test.ts` pins the count and `[id].test.ts`
  pins the merge, because the two halves can break independently.
- **`anyOpen` is on the view model, not in the template.** It is `terminal` asked of the list (Task 3's note),
  and it decides whether the panel offers "Refer this case to the judiciary" — with the sentence
  "This case is with the judiciary. Withdraw the open referral before raising another." in its place. api still
  owns the rule; the button is withheld so its 409 does not arrive after a 1,000-character form is filled in.

  **Superseded by the second-pass amendment below:** the template reads `offerRaise`, not `anyOpen`, because
  there are now two reasons to withhold the button and only one of them has a message.
- **The second call is `Promise.all`'d with `findDeedPoll`**, as `referrals/[referralId].ts` already does:
  neither answer depends on the other, the tab is on every case, and a 404 for the case rejects both.

  **Superseded by the second-pass amendment below:** it is `Promise.allSettled`, so the case read stays fatal
  and the referrals read degrades. `referrals/[referralId].ts` is unchanged — there, the referral *is* the
  page.

Final counts against Task 1's baseline. The app's `//#test:app` gained the 6 model tests in `[id].test.ts` and
the 9 template tests in the new `detail.njk.test.ts`; `@hmcts/deed-poll` gained `buildReferralsView`'s 9 and one
`detail-view` test.

| Workspace | Files (baseline → final) | Tests (baseline → final) |
|---|---|---|
| `//` (the app, `test:app`) | 42 → **48** | 621 → **693** passed, 3 skipped |
| `@hmcts/deed-poll` | 45 → **48** | 752 → **818** |
| `@hmcts/deed-poll-api-client` | 4 → 4 | 325 → 325 |
| `@hmcts-cft/cloud-native-platform` | 10 → 10 | 140 → 140 |
| `@hmcts-cft/express-govuk-starter` | 12 → 12 | 127 → 127 |
| `@hmcts-cft/simple-router` | 4 → 4 | 41 → 41 |
| `@hmcts-cft/express-session-postgres` | 2 → 2 | 23 → 23 |
| `@hmcts-cft/express-session-redis` | 1 → 1 | 7 → 7 |
| **Total** | **120 → 129** | **2,036 → 2,174 passed, 3 skipped (2,177)** |

`turbo test test:app --concurrency=1` **8 successful, 8 total**; `yarn lint` unchanged at the baseline's 2
pre-existing `noUndeclaredEnvVars` warnings; `yarn build` clean, so the merged record and the new view model
type-check.

### Code review, 2026-09-18 — what changed after the four tasks

Two behaviour fixes, one accessibility finding, and the journey test that found it.

- **A value left inside a closed conditional reveal is no longer sent.** GOV.UK's reveal only *hides* its
  input, so a caseworker who typed a reason for urgency and then chose Standard was posting both, and api
  stored both — a referral reading "Standard" beside a reason for being urgent, with decision 10 leaving no
  edit page to correct it. `submitted()` in `referrals/new.ts` now drops `urgencyReason` unless `Urgent` is
  chosen and `notes` unless `Other` is ticked, and `submittedValues()` still keeps both on screen so re-ticking
  the box does not mean typing it again. That also removes the path where an over-long value's error message
  rendered inside a closed reveal with a summary link to an invisible field.
- **The create-409's extra read can no longer turn a rendered 409 into a 500.** `openReferralHref` runs inside
  the handler's `catch`; an unreachable api there took the whole form with it. It now falls back to
  `…#referrals`.
- **An api 400 naming a field this form has no control for now shows the page's own message** instead of
  nothing at all (Spring addresses a collection member as `reasons[0]`, which no control is keyed by).
- **Decision 7 says "a POST with a confirmation" and the implementation has none**, following the note and
  witness deletes as the same decision's second sentence directs. The decision text is self-contradictory;
  the code and `withdraw.ts`'s docblock are the record, and no confirmation step is a deliberate choice rather
  than an omission.
- **The journey test the repo's conventions asked for is now in `e2e-tests/tests/deed-polls.spec.ts`** — raise,
  the two conditional reveals, both 409s, view and withdraw, with axe at five points. It immediately earned its
  keep: govuk-frontend 6.5.0's `radios.mjs` sets `aria-expanded` on the radio owning a reveal, which ARIA 1.2
  does not allow on `role="radio"` (it does on `role="checkbox"`, so the Other → notes reveal is clean). That
  one finding is waived by rule **and** element, with the reasoning at both the waiver and in
  `referral-form.njk`; everything else on the page stays live. **Worth a decision from Steve:** accept the
  upstream finding, or drop the reveal on urgency and show the reason field always.

### Code review, second pass — one validation fix

- **A missing urgency no longer hides the other reason's message.** zod skips an object's refinements once a
  field has failed its own parse, so `urgency` as a required enum meant a caseworker who ticked `Other`, left
  the revealed textarea blank and skipped the radios saw only "Select how urgent this referral is", then
  learned about the missing reason on the *next* submission — two round trips for two things the form already
  knew, which is both what `createReferralSchema`'s docblock claims to prevent and what GOV.UK's validation
  pattern requires. `urgency` is now optional in the shape with its requirement stated in the `superRefine`
  alongside the two conditional rules, so one parse yields every message. The narrowing is unchanged in
  substance — a referral with no urgency is still rejected — and api's create body has `urgency` optional, so
  the inferred DTO still fits the wire. Pinned at both levels: `schemas.test.ts` for the two issues in one
  parse, `referrals/new.test.ts` for the two rows in one error summary.
- **Not changed, again: the detail page's `Promise.all` makes a referrals failure fatal to the whole case
  page.** Flagged by both review agents in this pass as well. It is the plan's stated decision (Task 4's note),
  it matches the third call `getCaseFieldRules` already makes, and the trade-off is documented at the call
  site — but the blast radius is worth knowing: a `403` on the referrals endpoint renders the 404 template for
  a case that exists, and an api without the endpoint would 404 every case page. Degrading the tab instead is a
  small change (`Promise.allSettled`, a load-failure flag on the view model, no raise button in that state) if
  you decide the tab is worth less than the page.

  **Steve's call, 19 September: changed, and the tab now degrades.** Made before the PR rather than as a
  follow-up, because the third fatal call is what this branch introduces — landing it and fixing it later
  would ship a regression in page availability and then need its own justification against a plan that
  records the decision as declined twice.

  The reasoning that settled it, having verified the mapping rather than assumed it: `client.ts:746`
  classifies by **status**, so *every* referrals failure lost the page and in three disguises — a 404 (absent
  endpoint or absent case) became `NotFoundError` and rendered "Page not found" for a case that exists, a 5xx
  or timeout became `unavailable` and the 500 page, a 403 rendered the 404 template. None mentions referrals,
  so the support cost lands on whoever is asked why a case vanished. `client.ts:793` already classifies
  `unavailable`/`timeout` as "nobody's fault; try again shortly", and `client.ts:516` already warns about this
  exact coupling — the taxonomy was built and then discarded at the call site.

  Two things the earlier passes had right and one they had wrong. Right: the objection that failing loudly is
  safer for case data than for nav chrome is real, and it is answered by `unavailable` being a **third state**
  rather than an empty list — the danger was always a caseworker inferring "not referred" from a blank panel,
  so the panel says it could not find out and withholds the button. Right: `savedQueryEntries` is the
  precedent. Wrong: citing it alone was cherry-picking, since `getCaseFieldRules` is a counter-precedent ten
  lines below. The principle that carries it is **load-bearing versus additive** — `findDeedPoll` is the case
  and `getCaseFieldRules` decides which fields exist at all, so neither has a page without it; referrals are
  one panel of several.

  One deviation from the sketch above: the flag is `offerRaise` on the view model, not the template reading
  `unavailable` and `anyOpen` in the right order. `canRaise` was the first name and was wrong —
  `referrals-view.ts` is explicit that it holds no authorisation-shaped state ("who may claim, what a decision
  permits — is api's and stays there"), and `offerRaise` is about what the panel displays.

### Code review, third pass — the mixed api 400

- **A 400 that names a field this form renders *and* one it does not no longer hides half of itself.** The
  earlier fix asked "did api name any control this page has?" and, if so, rendered api's messages as they
  arrived — but a Spring 400 carries every field error at once, so a rejection naming `notes` and `reasons[0]`
  together showed the notes message and dropped the other. The caseworker would fix what they were shown and
  be refused a second time for a half that had never been on the page. The test is now per rejection rather
  than per response: whatever lands on a control is rendered there, and anything left over adds the page's
  own `referralRefused` row to the summary and a line to the log. The two ends of the range are unchanged —
  all fields placeable renders api's words alone, none placeable renders the page's copy alone — so only the
  mixed case moves. Pinned by a third case in `referrals/new.test.ts`.
- **The form-level summary row no longer links to `#reasons`.** `referralRefused` stands in for a rejection that
  named no control this page renders, so the `href` was a guess — and following it moved a keyboard or
  screen-reader user's focus to a checkbox group that may be entirely valid. It is now rendered without one, the
  same call the conflict row in `referral-form.njk` already made and for the same stated reason; field rows stay
  linked. The wording stays generic: api's own text is written for whoever reads api's logs, and `backend.md`
  forbids putting it in front of a caseworker, so an unplaceable message is logged and not rendered.

Counts after the review fixes: `//` (the app) **48 files / 706 tests**, `@hmcts/deed-poll` **48 / 822** — 2,191
across the eight workspaces, `turbo test test:app --concurrency=1` 8 successful. `yarn lint` still the
baseline's 2 pre-existing warnings. The Playwright suite passes serially (28 of 29; the saved-queries journey
times out on this devcontainer's filesystem under load, which predates this branch and is why CI retries).

### Code review, fourth pass — a rejected reason now lands on the checkbox group

- **`reasons[0]` is placeable after all.** `fieldMessages` split the field path on `.` only, so zod's
  `reasons.0` reached the checkbox group and Spring's `reasons[0]` — the same fact, spelled the way the other
  end spells it — was classified unplaceable, logged, and replaced by the generic `referralRefused` row. The
  docblock always claimed a member's issue lands on the group; only the dotted spelling actually did. It now
  splits on the first `.` or `[`, so an api rejection naming a reason renders api's message against the
  `reasons` group with a working summary link, and the unplaceable path keeps its meaning: a field this form
  genuinely has no control for (api-allocated `state`, or no field at all). The two tests that used
  `reasons[0]` as their example of "no control for this" now use `state`, and a new case pins the bracketed
  member onto the group.

## Deliberately not in this plan

- **The "returned — action needed" dashboard count and any alerting.** admin-2 — it consumes api-2's decided
  state, which does not exist until api-2 runs.
- **The judicial screen** (shared pool, claim, direction, check-your-answers attestation). admin-3, consuming
  api-2/api-3/idam-1.
- **Claiming, directing, or closing a referral in the caseworker UI.** Those transitions are api-2's; the
  caseworker's only write beyond create here is *withdraw*. Close is a caseworker action but it belongs with
  the direction loop (api-2 + admin-2), not this plan.
- **Editing an open referral in place.** api-1 decision 10: amend = withdraw + re-raise. No edit page.
- **Automatic referral of minor applications.** Feature decision 21 — `Minor` is a manual checkbox for MVP.
- **Any change to the api.** This plan is a pure consumer; if the contract is wrong, fix it in api and
  re-refresh, do not paper over it in the client.

---

## Flags for Steve

1. **Referrals as a fourth detail tab (option a) vs a standalone `/deed-polls/{id}/referrals` page (option
   b).** I chose the tab for consistency with notes/witnesses/documents and because the feature wants the
   history "where caseworkers already look" — but it costs the `subgrid`-union extension across four files,
   and referrals are the first tab whose data is *not* on the case payload (it's a second call). If you'd
   prefer a standalone page in MVP, Task 4 is the only section that changes.
2. **Running order is a hard gate, not advice.** admin-1 must be branched off a master where **11 and 12 are
   already merged**, and run against an api that has run **api-1** (and *not* yet api-2/api-3, or its scope
   grows). Task 1 stops if that's not the case. When you pick this up: confirm 11 and 12 have landed, and that
   api-1 is merged and its spec published, before running.
3. **Reason and urgency display labels are my wording** ("Applicant is a minor", "Standard" for `Normal`,
   etc.). They're an admin-side choice, not api's, so change them freely — the wire values are fixed by the
   api enum, the labels are ours. Worth a check that the caseworker-facing wording matches how the business
   describes each reason.
