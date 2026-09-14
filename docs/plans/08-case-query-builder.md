# Plan 08: a field-level query builder on the case list

## Overview

The case list offers five saved-query tabs — All, Open, Received, Enroled, Returned — and nothing else. A
caseworker cannot ask "Adult applications received in June that are still awaiting enrolment". This adds a builder
that composes conditions on named case fields, plus sorting and paging of the results.

### Sequencing — blocked on api

**`deed-poll-api/docs/plans/case-query-and-paging.md` must be merged first.** It establishes the query surface:
repeated `where=field:operator:value` parameters on `GET /caseworker/cases`, `sort=field:asc|desc`, 1-based `page`
with `size` capped at 100, and a `CaseListResponse` carrying `page`, `size`, `total`, `totalPages`.

Per `.claude/rules/backend.md`, an operation api does not have is not something to work around here.

### The metadata already exists, and that is what makes this tractable

`libs/deed-poll/src/deed-poll/form-fields.ts` holds **70 `FieldDef`s** — `name`, `label`, `kind`, `enumSet` —
across 7 kinds: 30 text, 15 date, 10 enum, 6 number, 3 boolean, 3 multiselect, 3 textarea. It is the port of the
Dynamics form, so **the labels are the ones caseworkers already know from the case tabs.** The builder is a
projection of that metadata, not a second list of fields to maintain.

**Do not create a separate list of queryable fields.** A field added to the form should become queryable without
anyone remembering to add it twice.

## Decisions taken — implement these, do not revisit

1. **api validates; this app guides.** Every condition is re-validated by api against its own `FormFields`, and
   this app must not treat its own validation as authoritative — it exists to stop obviously-wrong requests and to
   render api's errors well. **If the two disagree, api wins and this app has the bug.** Same principle as the
   two-witness rule.
2. **Offer only operators valid for the chosen field's kind**, matching api's table exactly:
   text/textarea `is, contains, startsWith, isEmpty, isNotEmpty`; date `is, before, after, between, isEmpty,
   isNotEmpty`; number `is, gt, lt, between, isEmpty, isNotEmpty`; enum `is, isOneOf, isEmpty, isNotEmpty`;
   multiselect `contains, isEmpty, isNotEmpty`; boolean `is`.
   **Derive the operator list from `kind`, in one place** — a hand-written per-field mapping would drift.
3. **The value control follows the kind.** `govukDateInput` for dates, `govukSelect` for enum, `govukCheckboxes`
   for `isOneOf` and multiselect, `govukInput type=number` for number, radios for boolean, text input otherwise.
   `isEmpty`/`isNotEmpty` take **no** value control at all — showing a disabled box would imply one is wanted.
4. **Conditions are ANDed, and the page says so in words.** api supports no OR. The UI must not imply otherwise —
   render the joining as the word "and" between rows rather than a chooser that offers only one option.
5. **It is a `GET` form, and the URL is the state.** No session, no server-side draft. A caseworker can bookmark a
   query, share it, and use the back button — which is the whole reason api took repeated query parameters rather
   than a POST body. **Do not add a session-stored query**; it would break exactly the property the api surface
   was shaped for.
6. **The five tabs stay, and compose with the query.** They are ported system views, and a bookmarked
   `?filter=open` must keep meaning what it means. The tab bar stays above the builder, and a query narrows within
   the selected tab.
7. **Progressive enhancement: it must work without JavaScript.** Adding a condition is a submit that re-renders
   with one more empty row — the GOV.UK add-another pattern. **JavaScript may make it smoother but must not be
   required**, because this is a staff service on managed devices and a query builder that dies with a CSP change
   is worse than a slower one.
8. **Sorting is on the existing six columns only** — `CASE_LIST_COLUMNS` is Reference, Privacy, Received, Type,
   State, New forename, and `CaseSummary` carries exactly those. Offering a sort on a field the table does not show
   produces a reordering the caseworker cannot see the reason for.
9. **Paging renders as GOV.UK pagination**, using api's `page`/`size`/`total`/`totalPages` rather than counting
   rows locally. State the total in words too — "1 to 25 of 213 applications" — because a caseworker needs to know
   whether to refine the query, not just that there is a next page.

## Open questions — flagged, NOT answered here

- **Welsh.** As with the detail page, the list page's labels are inline English strings in the page handler, not
  keys in `src/locales/cy.ts`. New builder labels follow that, which is consistent but not right; fixing it is
  page-wide work. Flagged so decision 3 is not read as a shortcut.
- **Whether a query should be saveable as a named tab.** The Dynamics original had saved views and the five tabs
  are the ported ones. api's plan excludes it — it needs per-user persistence the service does not have. If it is
  wanted, the URL-as-state decision above is what makes it cheap later: a saved view is a stored URL.
- **Empty-result wording.** "No cases match this filter" exists for the tabs. A failed *query* wants different
  wording, and probably a way back to the unfiltered tab. Worth a content decision rather than my guess.

## Constraints

- **No `prisma.*`, no migration, no JSON route.** There is no database in this repo. Everything goes through
  `libs/deed-poll-api-client`.
- **An operation must exist in `openapi.json` before `client.ts`** — `contract.test.ts` fails otherwise. Refresh
  the spec **from api** (`cd ../deed-poll-api && ./gradlew integration`, then copy `/tmp/openapi-specs.json`); do
  not hand-edit it, and update `SPEC-PROVENANCE.md`.
- **`Caller` is `{ accessToken }` and nothing else.**
- **The builder lives in `libs/deed-poll/src/deed-poll/`, not in the page.** `list-filters.ts` records why: a
  predicate is a business statement the page merely renders. Operator-per-kind belongs beside `form-fields.ts`.
- **Never run bare `yarn test`.** It reports `0 successful, 8 total` / `Tests no tests` — nothing ran, so nothing
  failed. Use `yarn turbo test test:app --concurrency=1`.
- **`yarn lint` is a single `biome check .`** It exits 0 today with two pre-existing `noUndeclaredEnvVars`
  warnings and a stale `biome.json` schema notice. Do not let the count grow.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

**Take the baseline from master immediately before starting.** It was 1,394 unit tests and 23 e2e at `68d6db3`,
but work has been landing steadily. **The skip count moves with the environment** — the three Redis session tests
skip when no cache is reachable and pass when one is, so compare **totals**, not passed counts.

Deliberately **not** here: `yarn test:e2e` and count comparisons. e2e needs Docker, a seeded IDAM simulator and a
browser; the rest are only true once the plan is finished. Both live in the final task.

## Tasks

### Task 1: Operators from field kinds

`libs/deed-poll/src/deed-poll/query-fields.ts`: the operator list per `FieldKind`, the value-arity per operator
(`between` two, `isOneOf` many, `isEmpty`/`isNotEmpty` none, the rest one), and a queryable-field list **derived
from `FORM_FIELDS`** rather than restated. Include the 5 `readOnly` fields — `referencenumber` and `state` are
among the most useful to query.

- [x] Operators derived from kind in one place; queryable list derived from `FORM_FIELDS`; read-only fields included

`libs/deed-poll/src/deed-poll/query-fields.ts`. Note for the tasks below: **there is no `FORM_FIELDS` export** —
`form-fields.ts` publishes `FORM_TABS`, `EDITABLE_FIELDS` (non-`readOnly` only) and `FIELD_BY_NAME`, so
`QUERYABLE_FIELDS` derives from `FORM_TABS` by flattening tabs → sections → fields. That keeps the five `readOnly`
fields, which `EDITABLE_FIELDS` would have dropped, and the subgrid tabs contribute nothing because they carry no
sections. `queryableField(name)` is a `find` rather than a `FIELD_BY_NAME` lookup so a name off the URL cannot
resolve `toString`.

### Task 2: Query parsing and serialising

Parse repeated `where` parameters from the URL into conditions, and serialise conditions back — the same shape api
expects, splitting on the first two colons only and URL-encoding values. A round-trip must survive a value
containing a colon and one containing a comma. Validate with Zod, per `.claude/rules/backend.md`.

- [x] Round-trips cleanly, including values containing `:` and `,`

`libs/deed-poll/src/deed-poll/case-query.ts`. The round trip is asserted **through a real
`URLSearchParams`**, not by handing the serialiser's output back to the parser — a format that survives
only when the URL is skipped is not a format that survives a URL. Four things the tasks below should not
have to rediscover:

- **Parsing is tolerant; sending is not, and that is two functions.** `parseConditions` keeps every row
  verbatim, including `":"` — the empty row "Add condition" produces — because a row mid-edit has to
  re-render. `caseQueryWhere` is the narrower gate that drops the incomplete ones, so adding a row does
  not turn the whole request into a 400 and lose the results already on screen. Task 4's rows are
  `parseConditions`' output; task 3 sends `caseQueryWhere`'s.
- **A comma is only a separator for `between` and `isOneOf`.** api splits a list-taking operator's values
  on commas and trims each, and leaves a single-valued operator's value alone — so
  `contains:Flat 2, Rose Court` asks what it looks like. An **unknown** operator is treated as
  single-valued for the same reason: splitting on an arity nobody published would lose the round trip for
  exactly the row a caseworker needs to see and fix.
- **A condition beyond api's cap of 20 is sent, not truncated to it.** Truncating would answer a narrower
  question invisibly; api refuses the whole request and the page renders that. Same reasoning applies to
  a `where` that is not a string or a list of them (`?where[a]=b`, which `qs` reads as an object): there
  is no row to render it as, so it is dropped rather than reported.
- **The Zod schema guards shape only** — a queryable field, an operator the kind admits, the right number
  of values. Whether a value *means* anything (a date that parses, an enum member that exists,
  `between` bounds the right way round) is api's answer per decision 1, and `caseConditionSchema` has a
  test pinning that it does not judge it.

`isQueryOperator` joined `query-fields.ts` rather than living here: "is this token an operator at all" is
a question about the operator table, and it uses `Object.hasOwn` for the reason `queryableField` is a
`find` — `"toString" in ARITY_BY_OPERATOR` is true.

**One divergence from api, for task 4 to decide on:** api queries **68 of the 70** fields.
`daysReceivedToEnroled` and `daysReceivedToReturned` are computed at read time, have no column, and are
refused with *"is derived, not stored"* — see task 1 of api's own plan. `QUERYABLE_FIELDS` holds all 70,
so the field chooser would offer two fields that can only 400. Not fixed here: what belongs in the
chooser is a task 4 question, and narrowing `QUERYABLE_FIELDS` would weaken the drift guard that is task
1's whole point. The same two are also refused as **sort** fields, which task 5 needs — though decision 8
limits sorting to the six list columns, none of which is one of them.

### Task 3: Client and service

Refresh `openapi.json` from api, add the new parameters to `client.ts` and the mock, extend the service call.
`contract.test.ts` pins it.

- [ ] Spec refreshed **from api**, `where`/`sort`/`page`/`size` sent, new response fields read, contract test green

### Task 4: The builder UI

On `deed-polls/index`: the condition rows above the results, an "Add condition" submit, a remove per row, and the
value control chosen by kind per decision 3. Works with JavaScript disabled.

- [ ] Renders per kind, adds and removes rows without JavaScript, and the word "and" joins rows

### Task 5: Sorting and pagination

Sortable column headers for the six `CASE_LIST_COLUMNS`, and GOV.UK pagination driven by api's counts, with the
"1 to 25 of 213" summary.

- [ ] Sort links preserve the query and the tab; pagination uses api's `total`/`totalPages`, not a local count

### Task 6: Tests

- Unit: operators per kind, arity per operator, and that the queryable list tracks `FORM_FIELDS` — **a test that
  fails if a form field is added without becoming queryable**
- Unit: parse/serialise round-trip, including the delimiter cases
- Page: a query renders results; an invalid condition re-renders with api's error against the row; `isEmpty` shows
  no value control; tab plus query applies both
- Page: sort and page links preserve every other parameter — the bug this class of UI always has
- e2e: build a two-condition query, run it, sort it, page it

- [ ] All present, including the form-fields-drift test and the parameter-preservation test

### Task 7: Full validation

- [ ] `yarn lint` — exits 0, still only the two pre-existing warnings and the schema notice
- [ ] `yarn turbo test test:app --concurrency=1` — 8 of 8, total above the baseline taken at the start
- [ ] `yarn build` — 8 of 8
- [ ] **e2e actually run, not just written.** From cold:
      1. `docker compose up -d` (redis 6379, IDAM simulator 5556 — a JVM; `curl 127.0.0.1:5556/health` → 200)
      2. **`yarn idam:users`** — a fresh simulator has an empty user store, and the failure looks like a broken
         login: the journey parks on the IDAM page with `toHaveURL` timing out
      3. `yarn playwright install chromium` if the version has moved
      4. **Pre-warm the mock api *first*, then the app.** `REDIS_URL=redis://127.0.0.1:6379 yarn mock:api &`, then
         `REDIS_URL=redis://127.0.0.1:6379 yarn dev:nowatch:web &`, then wait for `:3000`. The app takes 35–75s to
         bind, nearly all of it the Azure Key Vault DNS lookup timing out, which blows Playwright's 120s budget and
         presents as a **dead** server. Pre-warming the app alone leaves readiness at **503** until the mock is up —
         check `curl 127.0.0.1:3000/health` shows both `redis` and `deedPollApi` UP before starting
      5. **`--workers=1`.** At the default 7 this suite is unreliable here — `page.goto` timeouts in specs you never
         touched. The same starvation that makes bare `yarn test` false-red, one layer up
      6. `REDIS_URL=redis://127.0.0.1:6379 yarn test:e2e --workers=1`
- [ ] `git grep -n 'queryableFields\|QUERYABLE' -- libs/deed-poll/src` shows the list derived, not enumerated
- [ ] Mark completed

## Deliberately not in this plan

- **The api query surface.** `deed-poll-api/docs/plans/case-query-and-paging.md`, which must merge first.
- **OR or nested conditions.** api supports AND only; offering more would be a UI that cannot be answered.
- **Free-text search across fields.** Different feature, different relevance question.
- **Saved views.** See the open questions — but URL-as-state keeps it cheap later.
- **Welsh.** Pre-existing and page-wide.
- **Sorting on fields the table does not show.** Decision 8.
