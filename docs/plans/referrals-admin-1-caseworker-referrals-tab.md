# Plan: referrals to the judiciary (admin 1 of 3) — the caseworker referrals tab

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

## The hard block — this plan is written ahead of its contract, exactly like plans 11 and 12

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

## The three layers this repo enforces

`.claude/rules/backend.md` fixes a strict adapter → domain → pages architecture. A new sub-resource touches
all three, plus the mock and the spec, in this order (SPEC-PROVENANCE.md + backend.md "Reaching api"):

1. **Spec** — refresh `openapi.json` (precondition 2 above).
2. **Adapter** — `libs/deed-poll-api-client`: Zod schemas in `wire.ts` registered in `WIRE_SCHEMAS`
   (`wire.ts:502`) and `STRICT_RESPONSE_PROPERTIES` (`wire.ts:549`); four HTTP ops + path helpers in
   `client.ts` (mirror `listNotes`/`getNote`/`createNote` `client.ts:159-170` and `notePath`
   `client.ts:406`); ops registered in `contract.test.ts`'s `IMPLEMENTED_OPERATIONS` (`contract.test.ts:35`).
   Auth is never per-call — it rides in `ApiConfig` and `send()` sets the bearer header (`client.ts:544`).
3. **Mock** — `libs/deed-poll-api-client/src/mock/server.ts`: extend the collection regex (`server.ts:213`)
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

1. **Consumes api-1 only.** Four operations, no more. No claim, no direction, no close, no judicial, no
   dashboard count — those are api-2/api-3/admin-2/admin-3. If the refreshed spec offers more (the gate),
   stop; do not implement ahead.
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

### Task 1: Refresh the spec and bring the adapter + mock in line (the reconciliation gate)

**Do the gate first and stop if it fails.** Refresh `libs/deed-poll-api-client/openapi.json` per
`SPEC-PROVENANCE.md` from an api that has run api-1. Compute the delta over the committed `openapi.json`. It
**must be exactly**: operations `POST /caseworker/cases/{id}/referrals`, `GET
/caseworker/cases/{id}/referrals`, `GET /caseworker/cases/{id}/referrals/{referralId}`, `POST
/caseworker/cases/{id}/referrals/{referralId}/withdrawal`; schemas `CreateReferralRequest`,
`ReferralResponse`. If the delta is anything else — extra api-2/api-3 operations present, or saved-query /
search schemas *missing* (11/12 not merged) — **stop and report**; do not proceed.

Then, in the same task:
- `wire.ts`: add `CreateReferralRequest` and `ReferralResponse` Zod schemas matching the refreshed spec
  property-for-property (including `reasons` enum members, `state` enum members, nullability of `notes`/
  `urgencyReason`, and `migrated`); register both in `WIRE_SCHEMAS` (`wire.ts:502`) and the response schema
  in `STRICT_RESPONSE_PROPERTIES` (`wire.ts:549`).
- `client.ts`: `listReferrals`, `getReferral`, `createReferral`, `withdrawReferral`, with `referralPath` and
  `referralWithdrawalPath` helpers; auth via `ApiConfig` only. Alias exports at the bottom of `client.ts`
  (`export type Referral = WireReferralResponse`, etc.).
- `contract.test.ts`: add the four ops to `IMPLEMENTED_OPERATIONS` (`contract.test.ts:35`).
- `mock/server.ts`: extend the collection regex (`server.ts:213`) to `referrals` and reach the
  `…/{referralId}/withdrawal` POST; add a `referrals()` handler (model on `notes()`, `server.ts:369`) doing
  list/create/get and a withdrawal state transition; add `referrals: []` to `MockCase` (`server.ts:1306`),
  `seed()` (`server.ts:656`) and `reset()` (`server.ts:683`); parse `WIRE_SCHEMAS.CreateReferralRequest`.
- `client.test.ts`: describe blocks for the four ops against the running mock (`startMockApi()`), including
  the create-409-when-open and withdraw-409-when-terminal cases the mock models.

- [ ] Gate passed: refreshed-spec delta over the committed `openapi.json` is exactly the four referral ops +
      the two referral schemas, provenance table updated, schemas diffed property-by-property; `wire.ts`,
      `client.ts`, `contract.test.ts`, `mock/server.ts`, `client.test.ts` all updated together;
      `contract.test.ts` green (schema-key equality, op equality, strict-response pinning); `turbo test
      test:app --concurrency=1` green; baseline test count recorded

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

- [ ] `createReferralSchema` enforces ≥1 reason, notes-when-Other, urgencyReason-when-Urgent, each as a
      field-scoped error; service has dedicated `findReferrals`/`findReferral` calls and `createReferral`/
      `withdrawReferral` wrappers; api 409/400 surface as `ConflictError`/`InvalidInputError` via `callApi`;
      service exported from the domain index; unit tests mock `@hmcts/deed-poll-api-client` and cover each
      validation rule and each classified failure; `turbo test test:app --concurrency=1` green

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

- [ ] Raise/view/withdraw pages live and route correctly (static-before-dynamic ordering holds); conditional
      reveals for notes and urgency reason; error summary + inline errors + preserved values; both 409s render
      as page messages not error pages; migrated referral renders honestly; page tests cover each path;
      `turbo test test:app --concurrency=1` green

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

- [ ] Referrals tab renders in `govukTabs` with list, tags, labels, per-referral links and a
      conditionally-shown raise button; `[id].ts` makes the second call and the panel is populated; empty
      state clean; detail-page test covers the tab; `yarn lint` clean; `turbo test test:app --concurrency=1`
      green; final test count recorded next to the baseline

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
