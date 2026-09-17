# Plan: referrals to the judiciary (admin 2 of 3) — the "Returned — action needed" count and worklist

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

## The hard block — written ahead of its contract, exactly like admin-1 and plans 11/12

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

1. **Spec** — refresh `openapi.json` (precondition 2).
2. **Adapter** — `libs/deed-poll-api-client`: add `currentReferralState` (nullable enum) to
   `caseSummarySchema` (`wire.ts:252`) **and** `savedCaseSchema` (the `SavedCaseResponse` schema — the fuller
   row the mock's queryable set derives from), keeping `WIRE_SCHEMAS`/`STRICT_RESPONSE_PROPERTIES` in step.
   **No new operation** — `listCases` already sends `where`/`size` and returns `total` (`client.ts:106-117`,
   `wire.ts:274-285`). `IMPLEMENTED_OPERATIONS` does not change.
3. **Mock** — `libs/deed-poll-api-client/src/mock/server.ts`: `QUERYABLE_FIELDS` derives from
   `SavedCaseResponse.shape` (`server.ts:803`), so once the wire schema carries `currentReferralState` the
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
turbo test test:app --concurrency=1
yarn lint
```

(`turbo test test:app --concurrency=1`, never bare `yarn test` — [[deed-poll-admin-yarn-test-false-red]].)

## Tasks

### Task 0: Reconciliation gate — STOP unless api-2b landed exactly as planned

Before any code, confirm the refreshed spec matches this plan's single assumption, and STOP otherwise:

- Refresh `openapi.json` (precondition 2) on a branch off a `master` that already has admin-1 (precondition 3).
- The **only** new delta over admin-1's committed `openapi.json` is: `currentReferralState` (nullable enum,
  members `Open`/`Claimed`/`Decided`/`Closed`/`Withdrawn`) added to **both** `CaseSummaryResponse` **and**
  `SavedCaseResponse`, and present in the queryable-field surface. No new operation. No api-3 judicial
  schemas/paths.
- If the delta is anything else — the property on only one DTO, extra operations, judicial schemas, or
  nothing at all — **STOP and report** which, and how reality differs. The property on `CaseSummaryResponse`
  alone specifically means api-2b decision 7 was not honoured and the count will 400 in the mock; do not work
  around it by special-casing the mock.

- [ ] Spec refreshed off admin-1-merged master; delta is exactly `currentReferralState` on both DTOs + the
      queryable set, nothing else; if not, STOPPED and reported — no spec hand-edits, no scope guesses

### Task 1: Adapter + mock — the field on the wire, and data to count

Add `currentReferralState` (nullable enum) to `caseSummarySchema` (`wire.ts:252`) and `savedCaseSchema`,
registered in `WIRE_SCHEMAS`/`STRICT_RESPONSE_PROPERTIES` as the pattern requires; `contract.test.ts` green.
No `IMPLEMENTED_OPERATIONS` change. Seed the mock (`server.ts` seed/reset ~`:656`/`:683`) so a meaningful
number of cases carry `currentReferralState: 'Decided'` and others `Open`/`Claimed`/`null`, so the count call
returns an asserted non-zero.

- [ ] Both wire schemas carry the nullable enum; `contract.test.ts` green against the refreshed spec; mock
      accepts `where=currentReferralState:is:Decided` and has seeded `Decided`/other cases; op set unchanged;
      `turbo test test:app --concurrency=1` green

### Task 2: Domain — the queryable field port and the count function

In `libs/deed-poll/src/deed-poll/form-fields.ts`, add `currentReferralState` as a read-only queryable enum
`FieldDef` mirroring `state`, so `queryableField('currentReferralState')` resolves and `caseQueryWhere` will
serialise the condition (without this, the count condition is silently dropped — `case-query.ts` keeps only
resolvable conditions). Add a `countReturnedForAction(caller)` function (decision 2) that calls
`findDeedPolls` with the fixed `currentReferralState:is:Decided` condition and `size: 1` and returns `total`;
export it from `libs/deed-poll/src/index.ts` (service only, never `callApi`/`ApiConfig`). Unit-test it against
the mock: with N seeded `Decided` cases it returns N; with none it returns 0; a domain test that the condition
survives serialisation (is not dropped).

- [ ] `currentReferralState` is a queryable field admin-side (mirrors `state`, read-only); `caseQueryWhere`
      serialises `currentReferralState:is:Decided` (proven by test, not dropped); `countReturnedForAction`
      returns api's `total` for the fixed filter; unit-tested N and 0 against the mock; `turbo test test:app
      --concurrency=1` green

### Task 3: Pages — the count element and its worklist link

In `src/pages/deed-polls/index.ts`, call `countReturnedForAction(caller)` in parallel with the existing list
and saved-query-nav calls; pass the count and a worklist href
(`/deed-polls?where=currentReferralState:is:Decided`) to the template. In `index.njk`, render a
`govukNotificationBanner` above the list **only when count > 0** (decision 4), count-sensitive singular/plural
text from `locales/` with a Welsh entry (decision 7), linking to the worklist. The count is global,
independent of the current filter (decision 5). Test (`index.test.ts` / `index.njk.test.ts`): the banner
shows with the right count and link when there are `Decided` cases; is absent when there are none; the link
target is the `where` filter; the count does not change with the current tab.

- [ ] Dashboard fetches the count in parallel; banner renders with correct count + worklist link when >0 and
      is absent at 0; text is singular/plural and has `cy`; clicking the link lands on the `where`-filtered
      list (the worklist); count is filter-independent; page tests cover present/absent/link; `turbo test
      test:app --concurrency=1` green

### Task 4: E2E and full validation

A Playwright journey (`e2e-tests/tests/`, mirror an existing dashboard spec): with seeded returned-action
cases, the caseworker lands on the dashboard, sees the count banner, clicks it, and arrives at the filtered
worklist of exactly those cases. Happy path only.

- [ ] E2E: dashboard → count banner → click → filtered worklist; `turbo test test:app --concurrency=1` and
      `yarn lint` green; the six pipeline scripts still present (do not delete `lint`/`test`/`test:coverage`/
      `test:a11y`/`test:smoke`/`test:functional`); a11y check on the new banner passes

## Deliberately not in this plan

- **The judicial screen** (shared pool, claim, direction, check-your-answers attestation) — admin-3,
  consuming api-2/api-3/idam-1. This plan is caseworker-facing only.
- **Outbound email / push notification** (decision 9 rejected option 3) — this app has no send infra; the
  on-page count replaces the mailbox poll. A follow-up if the business wants a push.
- **A `currentReferralState` column on the case-list table** (decision 8) — out of scope; the count + filter
  link is the whole of decision 9.
- **Any change to how a referral reaches `Decided`** — that is api-2's state machine and admin-1's/admin-3's
  surfaces; this plan only counts and links.
