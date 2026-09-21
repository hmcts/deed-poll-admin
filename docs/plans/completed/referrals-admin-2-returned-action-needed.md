# Plan: referrals to the judiciary (admin 2 of 3) — the "Returned — action needed" count and worklist

> **Follow-up:** `referrals-admin-4-caseworker-completion.md` adds the caseworker closure journey this
> plan's `Decided` count depends on. The count and worklist query remain unchanged.

## Overview

**Second of three `deed-poll-admin` plans** in the referrals feature (three api, one producer add-on api-2b,
one idam, three admin — see `deed-poll-api/docs/plans/referrals-api-*.md` and the workspace memory
`deed-poll-referrals-feature`). This one replaces the **shared-mailbox poll**: today a caseworker learns a
judicial direction has come back by watching a mailbox; this plan turns that into a **visible count on the
case-list dashboard** — "N applications have a returned direction needing action" — that links to the exact
worklist of those cases. It consumes **api-2b** (`referrals-api-2b-current-referral-state.md`) and nothing
else new.

This is decision 9 made real: **the count IS the alert** (this app has no push infrastructure — a caseworker
learns things on page load), and **the same filter, clicked, is the worklist**. There is no bespoke count
endpoint and no second source of truth: the count and the list it drills into are one query,
`where=currentReferralState:is:Decided`.

## What "returned — action needed" means, precisely

A referral the judge has **decided** but the caseworker has **not yet closed**. In the state machine
(api-2), that is exactly `currentReferralState = Decided`: the judge has recorded a direction (`Claimed →
Decided`), and the caseworker's `close` (`Decided → Closed`) has not happened. `Closed` and `Withdrawn` are
terminal and drop off the count; `Open`/`Claimed` are not yet actionable by the caseworker. api-1's
one-non-terminal-referral-per-case rule (decision 11) means a case is in at most one such state, so this is a
clean per-case count, not a fan-out.

## AMENDED 2026-09-18 — the spec and the adapter are admin-0's

**admin-1's gate fired on 2026-09-18**: api had merged all four referral plans, not just the one each admin
plan was written against, and `contract.test.ts`'s set equality means a refreshed document obliges the adapter
to carry the whole api at once. So the spec refresh, the wire property and the mock mechanics moved into
**[`referrals-admin-0-spec-and-adapter.md`](referrals-admin-0-spec-and-adapter.md)**, and this plan is
**domain + pages** (plus the mock *data* it counts — see below).

**The precondition is now: admin-0 has landed, and admin-1 has landed.** admin-0 for the adapter; admin-1
because this plan's worklist links into the referrals tab admin-1 builds. Task 0 below becomes a verification
rather than a spec refresh.

**`currentReferralState` is a split responsibility, and the split is deliberate:**

| | Owner |
|---|---|
| The nullable enum property on `CaseSummaryResponse`, `CaseDetailResponse`, `SavedCaseResponse` | **admin-0** |
| The mock recomputing it as referrals transition | **admin-0** |
| Registering it as **queryable** in admin's own `form-fields.ts` / `query-fields.ts` port | **this plan** |
| Seeding enough mock cases in `Decided` to assert a real count against | **this plan** |

The third row is the one that bites: admin's `QUERYABLE_FIELDS` is built from its own port of api's
`FormFields`, and `caseQueryWhere` **silently drops** a condition whose field `queryableField()` does not know.
So without this plan's domain edit the count condition never reaches the wire, and the failure is a silent
zero rather than an error.

### The original hard block — superseded, kept for the reasoning

**This plan cannot be *run* until its upstream is merged and the spec is refreshed, and its Task 0 is a
reconciliation gate that STOPS if not.** Same discipline and same reason as `admin-1`, `11-saved-queries-ui`
and `12-case-search-ui`: `libs/deed-poll-api-client/src/api/contract.test.ts` asserts the wire client equals
the published `openapi.json` bidirectionally on three axes (operation set, schema-key set, per-schema
properties + enum members). Adding `currentReferralState` to the client before the spec carries it turns that
suite red.

**Running order: 11 → 12 → admin-1 → admin-2**, each rebased on the last, and on the api side api-1 → api-2 →
**api-2b** run and publish first. The preconditions:

1. **api-2b has been run and merged in `deed-poll-api`, and its OpenAPI spec is published.** api-2b adds the
   `currentReferralState` property to **both** `CaseSummaryResponse` and `SavedCaseResponse` (api-2b decision
   7 — the second is what makes the field queryable in *this* repo's mock), and registers it as a queryable
   enum field. Until that build has run there is nothing to refresh from.
2. **`libs/deed-poll-api-client/openapi.json` here has been refreshed** per `SPEC-PROVENANCE.md` (regenerate
   in the api clone with `./gradlew integration --tests "*OpenAPIPublisherTest*"` → `/tmp/openapi-specs.json`,
   reformat to 2-space JSON, update the provenance table, **diff property-by-property**).
3. **admin-1 is merged into this repo's `master`, and this plan is branched off that master.** admin-1
   refreshes the same `openapi.json` and edits `wire.ts`/`contract.test.ts`/`mock/server.ts` for the four
   referral operations; because the contract test asserts the *whole* schema-key set, a refresh that includes
   referrals against a client that lacks them goes red. So admin-2's refreshed spec is "api through api-1 and
   api-2 and api-2b."

**The reconciliation gate (Task 0) is a real stop.** The only *new* delta admin-2's refreshed `openapi.json`
should carry over admin-1's committed one is **the `currentReferralState` property on `CaseSummaryResponse`
and `SavedCaseResponse`, and its appearance in the queryable-field set** — nothing else. If the delta shows
api-3's judicial operations/schemas, or a `close` operation admin-1's spec did not already carry, or the
property on only one of the two DTOs, then the upstream is not what this plan assumes: **stop and report** —
do not hand-edit the spec, do not code around it. In particular, **`currentReferralState` on
`CaseSummaryResponse` alone is a stop**: the mock derives its queryable set from `SavedCaseResponse`, so the
count would 400 in-process (api-2b decision 7). If it is missing from `SavedCaseResponse`, api-2b did not land
as planned.

## The three layers this repo enforces

`.claude/rules/backend.md` fixes adapter → domain → pages. This plan is unusual in that **the wire/adapter/
mock changes are almost entirely delivered by the spec refresh** — `currentReferralState` is a new *property*
on two existing schemas, not a new operation — so the bulk of the work is domain + pages.

**Layers 1–3 are admin-0's, with one exception: the mock's seeded *data* stays here** (layer 3's last
sentence), because the number this plan asserts a count against is this plan's fixture, not the adapter's.
Everything else below is kept for context — do not edit `openapi.json`, `wire.ts` or the mock's routing here.

1. ~~**Spec** — refresh `openapi.json` (precondition 2).~~ **admin-0.**
2. **Adapter — admin-0.** `libs/deed-poll-api-client`: add `currentReferralState` (nullable enum) to
   `caseSummarySchema` (`wire.ts:252`) **and** `savedCaseSchema` (the `SavedCaseResponse` schema — the fuller
   row the mock's queryable set derives from), keeping `WIRE_SCHEMAS`/`STRICT_RESPONSE_PROPERTIES` in step.
   **No new operation** — `listCases` already sends `where`/`size` and returns `total` (`client.ts:106-117`,
   `wire.ts:274-285`). `IMPLEMENTED_OPERATIONS` does not change.
3. **Mock — routing and recompute are admin-0's; the seeded data is this plan's.**
   `libs/deed-poll-api-client/src/mock/server.ts`: `QUERYABLE_FIELDS` derives from
   `SavedCaseResponse.shape` (`server.ts:819`), so once the wire schema carries `currentReferralState` the
   mock accepts the filter automatically. What the mock needs *added* is **data**: seed some of its cases with
   `currentReferralState: 'Decided'` (and others `Open`/`Claimed`/`null`) so the count call returns a real,
   asserted number rather than always zero (`server.ts` seed/reset around `:656`/`:683`).
4. **Domain** — `libs/deed-poll/src/deed-poll/`: (a) add `currentReferralState` to the `form-fields.ts` port
   as a read-only queryable enum field mirroring `state`, so admin's own `queryableField` knows it and
   `caseQueryWhere` will serialise the condition onto the wire (without this the count condition is silently
   dropped — `case-query.ts` docblock); (b) a thin count function (decision 2). The `FieldDef` port and the
   `state` field it mirrors are in this same file.
5. **Pages** — `src/pages/deed-polls/index.ts` (the dashboard; `/` 302-redirects here). Add the count element
   above the list.

## Decisions — implement these, do not revisit

1. **The count lives on the case-list dashboard (`/deed-polls`), above the list.** `src/pages/index.ts`
   redirects `/` there and it is the service's home (`index.ts` docblock). No new page, no new route.

2. **The count is one dedicated `listCases` call, `where=currentReferralState:is:Decided` with the smallest
   page size, reading `total`.** A domain function — `countReturnedForAction(caller)` — calls the existing
   `findDeedPolls({ conditions: [{ field: 'currentReferralState', operator: 'is', values: ['Decided'] }],
   size: 1 }, caller)` and returns `result.total`. `total` is api's count across all pages, which
   `.claude/rules/backend.md` forbids recomputing locally; `size: 1` because the dashboard needs the number,
   not the rows (the rows are the worklist, fetched only when the caseworker clicks through). This is a third
   parallel call on the dashboard handler alongside the list query and the saved-query nav — justified by
   "one api call per thing a page needs": the count is a different query from the list on screen.

3. **The worklist is the same filter as a link, not a new endpoint.** The count links to
   `/deed-polls?where=currentReferralState:is:Decided`, which the existing dashboard renders as the filtered
   list through the machinery it already has (`caseQueryWhere` → `listCases` `where`). Clicking the count and
   landing on the list are the same query run twice. This is decision 9's "the count doubles as the worklist"
   and it is why the field had to be genuinely queryable (api-2b), not a bespoke aggregate.

4. **The count element appears only when the count is greater than zero.** Nothing to action → nothing shown
   → no permanent banner the eye learns to ignore. When there is work, it is prominent. This is the honest
   reading of "the count is the alert": an alert with a zero in it is not an alert. Render it with a GOV.UK
   component that carries an alert weight — a `govukNotificationBanner` (the pattern this repo already uses
   for service messages, `detail.njk:34`, `edit.njk:133`) is the fit; **do not** invent a bespoke stat-tile
   component (there is no count-tile pattern in the repo — the closest is the paging-summary paragraph — and
   YAGNI/KISS say reuse the banner, not build a dashboard-widget framework). The banner text names the count
   and links to the worklist (decision 3).

5. **The count is global, independent of the current filter/query on screen.** "N need action" is a fact
   about the service, not about the tab the caseworker is looking at, so it reads the same whether they are on
   `open`, `all`, or a saved query. It is *not* narrowed by the current view's conditions — it is its own
   fixed query (decision 2). A caseworker already filtered to the returned worklist still sees "N need action"
   at the top; that is correct, not redundant.

6. **No local state logic, no local matching.** The dashboard renders api's `total` and links to a `where`
   filter api resolves; it never inspects `currentReferralState` values itself, never counts rows, never
   decides what "Decided" means. Same rule plan 12 and admin-1 hold: api owns the query, this app renders the
   answer. `currentReferralState` on the summary row is available if a future column wants it, but this plan
   adds no new list column (decision 8).

7. **Singular/plural and Welsh.** The banner text is count-sensitive ("1 application has" / "N applications
   have") and lives in the `locales/` files like every other string, with a Welsh entry. Follow the existing
   `en`/`cy` pattern the dashboard already uses (`index.ts` render passes `en`/`cy`).

8. **No new column on the case-list table.** The list already shows reference/privacy/dateReceived/type/
   state/newForename (`index.njk:263-295`); this plan does not add a `currentReferralState` column to it. The
   worklist is *which cases*, reached by the filter link; showing the referral state as a column is a
   separate, larger call (it would want a heading, sort, Welsh label) and is **out of scope** — flagged, not
   done. The count + filtered list is the whole of decision 9.

## Open questions — flagged, NOT answered here

- **The exact banner wording** (decision 4/7) — "N applications have a returned direction needing action"
  is the working text; a caseworker-facing wording/Welsh-translation pass can revise it. Display-only.
- **A `currentReferralState` column on the list table** (decision 8) — deliberately out of scope; raise
  separately if the worklist proves hard to scan without it.
- **Whether the banner should also appear on the case detail page** for a case whose referral is `Decided` —
  out of scope here (this plan is the dashboard count); admin-1's referrals tab already renders the referral's
  state honestly, which is the per-case surface.

## Constraints

Same as admin-1 (three-layer adapter→domain→pages, `.claude/rules/backend.md`; ES modules, no `any`, Biome;
colocated `*.test.ts`; **test command is `turbo test test:app --concurrency=1`, NOT bare `yarn test`** — a
bare `yarn test` false-reds with "0 successful, 8 total"; api must be reachable/the mock drives the suite in
process). Additional to this plan:

- **The mock is the contract the suite runs against.** The count is only testable in-process if the mock (a)
  accepts `where=currentReferralState:...` — which it does once the wire schema carries the field (api-2b
  decision 7, precondition 1) — and (b) has cases seeded with `Decided`/other states. Seeding that data is
  part of this plan (layer 3); a test asserting "count is N" is meaningless if every mock case is `null`.
- **`contract.test.ts` must be green after the spec refresh + wire-schema edit** — the property must be on
  both `caseSummarySchema` and `savedCaseSchema` to match the refreshed spec's two schemas, and its
  nullability recorded in `STRICT_RESPONSE_PROPERTIES` if the pattern requires. Run it as the first check
  after Task 1.
- **A worker/`vitest` startup timeout is an environment failure, not a code failure** — re-run before
  investigating.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn turbo test test:app --concurrency=1
yarn lint
```

(Never bare `yarn test`, which reports a false failure here — [[deed-poll-admin-yarn-test-false-red]].)

**Corrected 2026-09-19: the `yarn` prefix is required and was missing.** `turbo` is not on PATH in this
devcontainer — only at `node_modules/.bin/turbo`, which `yarn` puts on PATH and a bare shell does not. Written
without it, this block starts **red with `command not found`**, which is worse than a failing test: it is not a
signal about the code at all. admin-1 shipped the same mistake and its run survived only because the agent
silently substituted `yarn turbo` at every call site — luck, not design. `referrals-admin-0` had it right and
says so in its own notes.

## Tasks

### Task 0: Verify admin-0 and admin-1 have landed — STOP if not

**Amended 2026-09-18. This task used to refresh the spec; admin-0 does that now.** Change nothing here;
confirm four things and stop if any fails:

- **`currentReferralState` is on all three wire schemas** — `caseSummarySchema` (`wire.ts:252`),
  `caseDetailSchema` and `savedCaseSchema` — as a nullable enum with members
  `Open`/`Claimed`/`Decided`/`Closed`/`Withdrawn`. **`savedCaseSchema` is the one that matters most**: the
  mock's `QUERYABLE_FIELDS` derives from `SavedCaseResponse.shape` (`server.ts:819`), so if the property is
  missing *there* the count 400s in process no matter what the other two carry. That was api-2b decision 7 and
  admin-0 inherits it — if it is absent, stop; do not special-case the mock.
- **The mock keeps it in step with referral transitions** (admin-0's recompute). Drive a referral to `Decided`
  through the mock and confirm the case's `currentReferralState` follows. A mock where the two disagree makes
  this plan's count untestable and its correctness unknowable.
- **admin-1 has landed**, because the worklist links into its referrals tab.
- **Both validation commands green**, totals recorded as this plan's baseline.

- [x] Verified: the property on all three wire schemas including `savedCaseSchema`; the mock recomputing it on
      transition; admin-1 present; both validation commands green with baseline totals recorded — or STOPPED
      and reported, with no adapter or mock-routing edits made here

**Gate passed 2026-09-19. No files changed by this task.** What was confirmed:

- **All three wire schemas carry it** as `z.enum(REFERRAL_STATE).nullish()` with the five members:
  `savedCaseSchema` (`wire.ts:201` — the one the mock's `QUERYABLE_FIELDS` derives from, `server.ts:1092`),
  `caseSummarySchema` (`wire.ts:324`), and `caseDetailSchema` by extension of `savedCaseSchema`
  (`wire.ts:304`) rather than a third restatement. Absent from `STRICT_RESPONSE_PROPERTIES` on all three,
  which is right: null is the ordinary value.
- **The mock recomputes it on transition** — `server.ts:1535` derives it from the case's first non-terminal
  referral, and `server.test.ts:979` drives `Open → Claimed → Decided → null` through the real endpoints and
  asserts the case follows, with `Closed`/`Withdrawn` landing on null. `server.test.ts:1019` already proves
  `where=currentReferralState:is:Open` filters, so the mock accepts the filter shape this plan counts with.
- **admin-1 has landed** — `docs/plans/completed/referrals-admin-1-caseworker-referrals-tab.md`, merged at
  `52db3fc`, with `libs/deed-poll/src/referrals/` and the referral pages on disk. admin-0 is completed too.
- **Baseline, both commands green:** `yarn turbo test test:app --concurrency=1` → 8 successful, 8 total;
  `//:test:app` 48 files / 715 tests, `@hmcts/deed-poll` 48 / 827, `@hmcts/deed-poll-api-client` 4 / 325,
  `express-govuk-starter` 12 / 127, `cloud-native-platform` 10 / 140, `simple-router` 4 / 41,
  `express-session-postgres` 2 / 23, `express-session-redis` 1 / 7 — **2205 tests, 129 files**.
  `yarn lint` exits 0 (2 warnings, 2 infos, all pre-existing).

### Task 1: Mock data — enough `Decided` cases to assert a real count

**Amended 2026-09-18: the wire property and the mock's routing are admin-0's; only the fixture is this
plan's.** Seed the mock (`server.ts` seed/reset ~`:656`/`:683`) so a meaningful number of cases sit in
`Decided` and others in `Open`/`Claimed`/`null`. Without this the count is always zero, and a zero count is
indistinguishable from a condition that was silently dropped — which is the exact failure the domain task
exists to prevent.

Seed it through referrals where the mock allows it, so `currentReferralState` arrives by admin-0's recompute
rather than being set behind its back. A fixture that contradicts the mock's own state machine teaches the
pages something api will not do.

- [x] The mock has cases seeded across `Decided`, `Open`/`Claimed` and `null`, reached through its own
      transitions where possible; `where=currentReferralState:is:Decided` returns an asserted non-zero
      `total`; op set unchanged; `turbo test test:app --concurrency=1` green

**Done 2026-09-19. The seed the plan named is in two places, because the mock has two callers:**

- **`server.ts` has no baked-in dataset to edit** — it starts with an empty case store in every scenario
  (`fixtures.ts` fixes document types and nothing else), so the `:656`/`:683` line references were to `seed`
  and `reset` themselves, not to a fixture list. `seed` already recomputes `currentReferralState` from a case
  seeded with referrals (`server.ts:958`), which is all the routing this task needed. **No mock-server edit.**
- **The suite's fixture is in `server.test.ts`**: two tests in the `currentReferralState` describe. The first
  drives seven cases through the mock's own transitions — three `Decided`, one `Open`, one `Claimed`, one
  `Closed` (terminal, so null again), one never referred — and asserts
  `where=currentReferralState:is:Decided&size=1` answers `total: 3` with one row, which is the shape
  `countReturnedForAction` will read in Task 2. The second asserts the same filter without `size` lists
  exactly those ids, so the count and the worklist it links to are pinned as one query.
- **The dev fixture is `scripts/seed-local-cases.mjs`** (`yarn mock:seed`), which is what makes the count
  non-zero for `yarn dev` and for a manual look at the banner. A referral phase now drives 9 of the 26
  Received cases through raise → claim → direct → close: 4 `Decided`, 2 `Claimed`, 2 `Open`, 1 `Closed`. It
  reads the count back through the same `where` and reports a mismatch, because a `where` the mock did not
  recognise answers the case total and a dropped condition answers zero — both look like a working seed
  otherwise. Verified against a live mock: "Referred 9, of which 4 are returned and need action."
- **Op set unchanged**; no `openapi.json`, `wire.ts` or mock-routing edit. **2207 tests / 129 files, 8 of 8
  tasks successful** (baseline 2205 plus the two new); `yarn lint` exits 0 with the same 2 warnings / 2 infos.

### Task 2: Domain — the queryable field port and the count function

In `libs/deed-poll/src/deed-poll/form-fields.ts`, add `currentReferralState` as a read-only queryable enum
`FieldDef` mirroring `state`, so `queryableField('currentReferralState')` resolves and `caseQueryWhere` will
serialise the condition (without this, the count condition is silently dropped — `case-query.ts` keeps only
resolvable conditions). Add a `countReturnedForAction(caller)` function (decision 2) that calls
`findDeedPolls` with the fixed `currentReferralState:is:Decided` condition and `size: 1` and returns `total`;
export it from `libs/deed-poll/src/index.ts` (service only, never `callApi`/`ApiConfig`). Unit-test it against
the mock: with N seeded `Decided` cases it returns N; with none it returns 0; a domain test that the condition
survives serialisation (is not dropped).

- [x] `currentReferralState` is a queryable field admin-side (mirrors `state`, read-only); `caseQueryWhere`
      serialises `currentReferralState:is:Decided` (proven by test, not dropped); `countReturnedForAction`
      returns api's `total` for the fixed filter; unit-tested N and 0 against the mock; `turbo test test:app
      --concurrency=1` green

**Done 2026-09-19.** Two departures from the task's wording, both deliberate:

- **The field is queryable without being on a form tab.** `QUERYABLE_FIELDS` derives from `FORM_TABS`, so
  "mirroring `state`" literally would have put a disabled control on the Application tab and a row in the
  detail card — a display change decision 8 does not make. So `form-fields.ts` gains
  `NON_FORM_QUERYABLE_FIELDS` (one entry, read-only, `kind: "enum"`, `queryable: false`) and
  `QUERYABLE_FIELDS` is the form **then** that list. The drift guard is untouched: every form field is still
  queryable with no second edit, and `query-fields.test.ts` now pins the concatenation rather than equality.
  It is not in `FIELD_BY_NAME`, which answers "is this a form field", nor choosable — the chooser is grouped
  by tab and section and a non-form field has no group, which is why the banner link is the route to the
  worklist. No `enumSet`: api's members are already display words, and a label set nothing offers is
  five entries to maintain for a select only a hand-edited URL can reach.
- **The count lives in `libs/deed-poll/src/referrals/returned-for-action.ts`**, not in `deed-poll/service.ts`:
  it is the referrals feature asking a case question, and `service.ts` is deliberately "thin functions and no
  rules of their own". The file holds the frozen `RETURNED_FOR_ACTION_CONDITIONS` beside the count, so Task 3's
  worklist href and this count are one condition written down once (decision 3) — `caseListSearch` can build
  the link from the same constant. Exported from `libs/deed-poll/src/index.ts`; `callApi` stays private.
- **The domain test mocks the adapter**, per `.claude/rules/testing.md`, and asserts the `where` array reaching
  `listCases` — that is what proves the condition was not silently dropped, which is the failure this task
  exists to prevent. The N-against-real-data proof is Task 1's `server.test.ts`, which drives seven cases
  through the mock's own transitions and asserts `total: 3`; the test file's docblock says so.
- **2217 tests / 130 files, 8 of 8 tasks successful** (Task 1 left 2207/129: +8 in
  `returned-for-action.test.ts`, +2 in `query-fields.test.ts`); `yarn lint` exits 0 with the same 2 warnings /
  2 infos.

### Task 3: Pages — the count element and its worklist link

In `src/pages/deed-polls/index.ts`, call `countReturnedForAction(caller)` in parallel with the existing list
and saved-query-nav calls; pass the count and a worklist href
(`/deed-polls?where=currentReferralState:is:Decided`) to the template. In `index.njk`, render a
`govukNotificationBanner` above the list **only when count > 0** (decision 4), count-sensitive singular/plural
text from `locales/` with a Welsh entry (decision 7), linking to the worklist. The count is global,
independent of the current filter (decision 5). Test (`index.test.ts` / `index.njk.test.ts`): the banner
shows with the right count and link when there are `Decided` cases; is absent when there are none; the link
target is the `where` filter; the count does not change with the current tab.

- [x] Dashboard fetches the count in parallel; banner renders with correct count + worklist link when >0 and
      is absent at 0; text is singular/plural and has `cy`; clicking the link lands on the `where`-filtered
      list (the worklist); count is filter-independent; page tests cover present/absent/link; `turbo test
      test:app --concurrency=1` green

**Done 2026-09-19.** Three decisions the task's wording left open, and one departure:

- **The count degrades rather than failing the page.** `returnedForActionCount` in `index.ts` catches every
  failure, logs `returned-for-action count unavailable` and returns `null`, which renders as no banner. The
  task did not say, but CLAUDE.md's "a second call for one panel must not be able to lose the page" does: the
  list is load-bearing and the count is one element above it, so this follows `savedQueryEntries` and
  `[id].ts`'s referrals tab. It catches *everything* rather than naming `unavailable` because the `where` it
  sends is this app's, not the caseworker's — an `InvalidInputError` there is our bug and there is no field to
  render it against. It is logged because "the count is the alert" has exactly one unnoticeable failure mode: a
  silently absent banner looks identical to nothing needing action.
- **The banner sits at the top of the content, above the `<h1>`**, not immediately above the table. "Above the
  list" taken literally puts it below a search box, a filter bar and a 40-line query builder, where a thing
  whose only job is to be seen is not seen. Same position and same `type: "important"` as `detail.njk`'s
  privacy banner, which is also GOV.UK's own guidance for the component.
- **The worklist href is built from `RETURNED_FOR_ACTION_CONDITIONS` through `caseListSearch`**, as the module
  const `RETURNED_FOR_ACTION_PATH` — `/deed-polls?where=currentReferralState%3Ais%3ADecided`. Percent-encoded
  because that is what every other link on the page does; it is the same URL the plan's prose writes
  unencoded. It carries no filter, term, sort or page, which is decision 5 made mechanical: there is no code
  path by which the tab on screen can narrow the worklist.
- **The view model passes the resolved sentence, not the number** — `returnedForAction` is `""` when there is
  nothing to say (0, or a count that could not be read), matching `unusedConditions` and keeping decision 4 in
  the handler rather than as an `> 0` in the template.
- **2231 tests / 130 files, 8 of 8 tasks successful** (Task 2 left 2217/130: +9 in `index.test.ts`, +5 in
  `index.njk.test.ts`); `yarn lint` exits 0 with the same 2 warnings / 2 infos. The page tests pin the count's
  own call (caller only, once), singular/plural, absent-at-0, the href, survival of a refused list query and of
  an unreachable count; the template tests pin that the banner is above the search form, is a plain link, is an
  `aria-labelledby` region, and is absent entirely at 0.

### Task 4: E2E and full validation

A Playwright journey (`e2e-tests/tests/`, mirror an existing dashboard spec): with seeded returned-action
cases, the caseworker lands on the dashboard, sees the count banner, clicks it, and arrives at the filtered
worklist of exactly those cases. Happy path only.

- [x] E2E: dashboard → count banner → click → filtered worklist; `turbo test test:app --concurrency=1` and
      `yarn lint` green; the six pipeline scripts still present (do not delete `lint`/`test`/`test:coverage`/
      `test:a11y`/`test:smoke`/`test:functional`); a11y check on the new banner passes

**Done 2026-09-19.** One test added to `e2e-tests/tests/deed-polls.spec.ts` rather than a spec of its own — the
dashboard journeys live there and so do the seeding and axe helpers this one reuses. What the decisions cost:

- **The count is asserted as a baseline plus this journey's two cases, not as an absolute.** It is global
  (decision 5) and the mock's store outlives a run — `reuseExistingServer`, and `yarn mock:seed` leaves four
  `Decided` cases behind — so `returnedForActionTotal` reads the same `where` through the mock *before*
  seeding and the banner is expected to say `baseline + 2`. An absolute number would have passed on a fresh CI
  mock and gone red on any developer who had run `yarn dev`. Nothing else in the suite drives a referral past
  `Claimed`, so the baseline cannot move while the test runs.
- **The judge's two transitions are driven through api's routes, not a UI, because there is no judicial UI
  yet** (admin-3). `referTo` raises through `POST /caseworker/cases/{id}/referrals` and then claims and directs
  as `e2e.judge@example.com` with a hand-built bearer token, exactly as `scripts/seed-local-cases.mjs` does —
  the mock reads a subject from the token and models no roles. The referral state is never written onto the
  seed body: the mock recomputes it, and a fixture that contradicted its state machine would teach the
  dashboard a number api cannot produce.
- **A third case is left `Claimed`**, so the worklist is asserted to exclude it: a journey seeding nothing but
  `Decided` would pass against a link whose condition was dropped, which is this plan's whole failure mode.
  The rows are found by this run's surname *and* display reference — five digits is only 10,000 serials and
  the mock's store outlives the run, so a reference alone could be matched by an earlier run's `Decided` row
  while the new ones were missing — and the two seeded ones are at the top of page 1 whatever the baseline,
  because the mock's default order is `createdOn` descending.
- **axe runs at both points** — the dashboard carrying the banner and the worklist it links to — with no
  waivers, and the count is re-read on the Enroled tab so decision 5 is checked where a caseworker would
  notice it.
- **Green:** the whole Playwright suite `30 passed` (not just the new journey — the new cases join a shared
  store, so the other journeys' totals are the thing worth re-running); `yarn turbo test test:app
  --concurrency=1` → 8 of 8 tasks, **2231 tests / 130 files**, unchanged from Task 3 because an E2E spec is not
  in the vitest suite; `yarn lint` exits 0 with the same 2 warnings / 2 infos. All six pipeline scripts still
  in `package.json`.
- **Flagged, then fixed in review (2026-09-19).** The first of the two options below was not needed: the field
  stays out of the chooser (decision 8 holds), and `buildRow` now renders a resolved-but-unchoosable field as an
  ungrouped option of its own (`appliedOption`), so the row shows the filter in effect and **submits it back**.
  `currentReferralState` also gained an `enumSet` (`REFERRAL_STATE_LABEL`, built from api's member array), so its
  value select offers the states rather than only "Choose a value". Pinned by `query-builder.test.ts` (the row,
  and a resubmission composed from what a browser would send), `index.njk.test.ts` (the markup) and an Apply
  round trip in the Playwright journey. What was flagged:
- **Flagged, not fixed:** the worklist page renders its query-builder row with the field chooser reading
  "Choose a case field" and the value select holding only "Choose a value", because `currentReferralState` is
  deliberately not choosable (Task 2, decision 8) while `queryableField` still resolves it. axe is clean and
  the rows are right, but pressing **Apply filters** on the worklist drops the condition and shows the whole
  list. That is the known cost of a non-form queryable field; fixing it means either offering the field in the
  chooser or rendering an applied-but-unchoosable condition as a removable summary, and both are display
  decisions this plan does not make.

## Deliberately not in this plan

- **The judicial screen** (shared pool, claim, direction, check-your-answers attestation) — admin-3,
  consuming api-2/api-3/idam-1. This plan is caseworker-facing only.
- **Outbound email / push notification** (decision 9 rejected option 3) — this app has no send infra; the
  on-page count replaces the mailbox poll. A follow-up if the business wants a push.
- **A `currentReferralState` column on the case-list table** (decision 8) — out of scope; the count + filter
  link is the whole of decision 9.
- **Any change to how a referral reaches `Decided`** — that is api-2's state machine and admin-1's/admin-3's
  surfaces; this plan only counts and links.
