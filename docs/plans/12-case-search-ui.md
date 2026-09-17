# Plan 12: a case search — the caseworker's side

## PROVISIONAL — read this section before running anything

**This plan is written against a contract that does not exist yet, deliberately, and it cannot be run until
that changes.** Written 2026-09-17 on Steve's instruction to get the search UI onto paper alongside plan 11,
ahead of the api work, with every contract claim flagged rather than assumed.

`deed-poll-api`'s `docs/plans/saved-queries-and-search.md` describes the search half of one caseworker
journey: a `q` parameter on `GET /caseworker/cases`, a `referenceMatch` on the list response, and a
`newSurname` on the case summary (its decisions 8–13). That plan is **being run now** — as of writing it is
on task 1 of 5 in another terminal (`.ralphex/progress/progress-saved-queries-and-search.txt` in the api
clone) — but its output has not landed in this repo's `openapi.json`. Verified against admin's copy of the
spec (`libs/deed-poll-api-client/openapi.json`, provenance api commit `fd4fe3a`, taken 2026-09-14):

| What this plan needs | In the spec today |
|---|---|
| `q` query parameter on `GET /caseworker/cases` | **absent** — the operation has `filter`, `where`, `sort`, `page`, `size` and no `q` |
| `referenceMatch` on the list response schema (`CaseListResponse`) | **absent** — `caseListSchema` is `filter`, `cases`, `page`, `size`, `total`, `totalPages` |
| `newSurname` on the summary schema (`CaseSummaryResponse`) | **absent** — `caseSummarySchema` carries `newForename` but not `newSurname` |

**Why it cannot merely be run early and corrected.** `q` on its own breaks nothing —
`contract.test.ts` does not check query parameters, only schemas and operation paths, and `q` adds no
operation. But `referenceMatch` and `newSurname` are **schema-property additions**, and the per-schema test
at `libs/deed-poll-api-client/src/api/contract.test.ts:85-87` asserts, for every registered schema,
`Object.keys(schema.shape)` equals `Object.keys(specSchema.properties)`. Add `referenceMatch` to the
`CaseListResponse` zod schema before the spec carries it and that test goes red for `CaseListResponse`; add
`newSurname` to `CaseSummaryResponse` and it goes red for that too — **from task 1 onward**. That is the
failure mode [`10-case-query-fixes.md`](completed/10-case-query-fixes.md) and
[`11-saved-queries-ui.md`](11-saved-queries-ui.md) both warn about: a validation gate that starts red cannot
tell a break from a pre-existing failure, so every subsequent task reports the same red and the run teaches
nothing.

**The gate, therefore, in order:**

1. Finish api's `saved-queries-and-search.md` run (the search half is its task 5 and task 6 publishes the
   spec — so a partial run that has not reached task 6 has not moved the document either).
2. Refresh `libs/deed-poll-api-client/openapi.json` from api's published document per
   [`libs/deed-poll-api-client/SPEC-PROVENANCE.md`](../../libs/deed-poll-api-client/SPEC-PROVENANCE.md) —
   `./gradlew integration -Dtest.single=OpenAPIPublisherTest` writes `/tmp/openapi-specs.json`; copy it over
   and update the commit table.
3. **Re-read this plan against the refreshed spec and correct it.** Task 0 below exists to force that, and
   it is the only task that may be run before the gate is met.

**This plan and plan 11 both refresh the same `openapi.json` and both edit the same two files
(`src/pages/deed-polls/index.ts` and `index.njk`).** They must not be run in parallel, and the second to run
rebases on the first. See "Sequencing against plan 11" below — this is a real ordering decision, not a
caveat.

**Every statement in this plan about an api path, parameter or response field is provisional.** Where one is
load-bearing it is marked **[PROVISIONAL]**. Do not implement a marked claim without checking the refreshed
spec first; where the spec disagrees, **the spec wins and this plan is wrong**.

## Overview

Plan 10 gave a caseworker a field-by-field query builder. It answers *"show me every Minor received in
June"* well and *"find the Smith case"* badly — a name is a `contains` condition three clicks deep, and a
reference number is not a queryable field at all. This plan adds the other half: **a single search box** that
matches a reference exactly or a name loosely, composing with whatever filter and conditions are already
applied.

The matching is entirely api's. This repo sends `q` and renders what comes back — it does not split the term,
decide what counts as a reference, or search anything locally. Three api-side facts drive the UI (all
**[PROVISIONAL]** until the spec is refreshed):

- **`q` is one parameter on `GET /caseworker/cases`** (api decision 8), ORed internally across six name
  fields and two reference fields and ANDed with `filter` and `where` (decisions 9–10).
- **`referenceMatch`** on the list response is the id of the case whose reference the term matched exactly,
  or null (decision 11). A caseworker who types a full reference wants *the case*, not a list of one — so the
  UI redirects to it rather than making them click through a single row.
- **`newSurname`** joins `CaseSummary` (decision 13), because a search that matches on surname must be able
  to show the surname it matched — otherwise "Smith" returns a table of forenames.

Scope decided with Steve 2026-09-17: **search only.** Saved and shared queries are plan 11, written and
pushed on branch `saved-queries-ui`. api treats the two as one journey; this repo splits them so each merges
independently.

### Sequencing against plan 11

Both plans are provisional, both wait on the same api run, and they overlap:

- **Both refresh `openapi.json`.** Whichever runs second finds the spec already refreshed and its Task 0 a
  no-op for the refresh itself — but must still reconcile its own **[PROVISIONAL]** markers.
- **Both edit `src/pages/deed-polls/index.ts` and `src/pages/deed-polls/index.njk`.** Plan 11 generalises the
  filter nav to `filterGroups` and adds a second group; plan 12 adds a search form above the nav and threads
  `q` through every link the handler builds. These touch different regions of both files, but git will not
  merge them cleanly if they land on divergent branches.

**Recommended order: plan 11 first, then plan 12 rebased on it.** Plan 11 is already written and its nav
refactor is the larger structural change; layering a search form on top of a settled `filterGroups` handler
is cleaner than the reverse. **Whichever runs second must rebase on the first before running**, so its Task 0
reconciles against a tree that already holds the other's changes. If they somehow run against the same
master in parallel, the merge collision in `index.ts`/`index.njk` is silent — neither test suite covers the
other's markup — so this is stated as an instruction, not a hope.

Nothing in this plan depends on plan 11's *code*; the dependency is purely the shared files and the shared
spec. Plan 12 can be written and reconciled independently — it just cannot be *merged* without resolving the
overlap.

## Decisions taken — implement these, do not revisit

1. **The search term is carried by every link on the page, exactly as the conditions are.** This is the
   single most important correctness rule in the plan. The list page already threads `filter`, `conditions`
   and `sort` through every tab, sort header, paging link and the clear link via `listHref`/`caseListSearch`
   (`src/pages/deed-polls/index.ts:266`, `case-query.ts:137`) — precisely so a sort header cannot drop a
   caseworker's conditions. `q` must join that set. A sort header, a page-2 link or a filter tab that forgot
   `q` would silently drop the search and show a different result set under the same heading — the identical
   bug the existing code's docblocks warn about (`index.ts:285-296`, `case-query.ts:121-136`). Extend
   `CaseListLink` (`case-query.ts:256`) and `caseListSearch` to carry `q`, and every existing call site gets
   it for free.
2. **A non-null `referenceMatch` redirects to that case; the UI does not infer intent from `total == 1`.**
   api decision 11 states this is why the field exists. When `findDeedPolls` returns a result whose
   `referenceMatch` is a non-null id, the handler `res.redirect`s to `/deed-polls/{referenceMatch}` — a
   full-reference search lands on the case. **Do not redirect on `total == 1`**: one row that happens to be a
   single name match is a list of one, not a reference hit, and api draws that distinction deliberately. The
   redirect is a `302` to the detail page, so the back button returns to the search results.
3. **`q` is trimmed and an empty `q` is omitted, never sent as `q=`.** Same rule as every other list
   parameter (`case-query.ts:143-146`, `listCases` at `client.ts:97`): a part this app has nothing to say
   about is omitted so api applies its own behaviour, and an empty string written into a bookmarked URL pins
   nothing useful. A `q` of only whitespace is an empty `q`.
4. **Search is a separate GET form above the filter nav, and it preserves the active query.** Chosen by Steve
   2026-09-17 over folding `q` into the builder form and over a search that resets conditions. The search form
   carries the current `filter`, `where` (one hidden input per condition) and `sort` as hidden inputs, so
   submitting a search composes with an active query — api decision 10 ANDs `q` with `filter` and `where`, so
   the UI must be able to express "Smith, within Enroled, received in June". A standalone form keeps search a
   first-class entry gesture rather than something reached past the whole builder. It does **not** carry
   `page`: a new search starts at its first page, exactly as applying a query does (`index.ts:52`,
   api decision 5's sibling reasoning).
5. **The reference-match redirect and the substring semantics are api's, stated by api, never reimplemented
   here.** This repo does not normalise the reference (case, hyphens, whitespace — api decision 9), does not
   decide which fields a name matches, and does not lower-case anything for comparison. It sends the raw
   trimmed term and renders `referenceMatch` and the rows. A local matcher would be a second opinion about a
   rule api owns, and the two would drift — the same reasoning as not resolving a filter tab locally
   (`service.ts:40-56`).
6. **`newSurname` becomes the list table's seventh column.** api decision 13. `CASE_LIST_COLUMNS`
   (`list-view.ts:41`) and `CaseListRow` (`list-view.ts:19`) gain it, `buildCaseList` (`list-view.ts:55`)
   maps it through the shared `format`, and the template's row array (`index.njk:250-257`) and header loop
   render it. Its sort field is `newSurname` **[PROVISIONAL]** — confirm it is in api's sortable-fields list
   when the spec is refreshed (that list is prose in the `sort` parameter description, not an enum, per
   `list-view.ts:36-40`), because a column offering a sort api refuses is a 400 waiting to happen.
7. **No JavaScript.** Plan 10 established JS as enhancement over a working round trip and plan 11 added none;
   a search box is a native `<input type="search">` submitting a GET form. Do not add any.
8. **The empty-search state is the list as it is today.** With no `q`, `GET /caseworker/cases` must behave
   byte-identically to now — api decision's own constraint, and this app's mirror of it: an absent `q` is not
   sent, so the request is the one the list already makes. Nothing about the no-search page changes except
   the new `newSurname` column.

## Open questions — flagged, NOT answered here

- **Whether `q` should have a minimum length.** A one-character substring search over six name columns is a
  table scan returning most of the table. api's plan does not cap it and neither does this — but if volumes
  later make it a problem, a client-side minimum (with a message) is a cheaper fix than an index. Recorded so
  it is a known lever, not a surprise. Do not add one speculatively (YAGNI).
- **Whether a reference-match redirect should be suppressible.** A caseworker who typed a full reference but
  wanted the list (e.g. to see it beside its neighbours) is redirected past it. Unlikely, and the back button
  handles it, but if it turns out to matter the answer is a `&list=1` escape rather than dropping the
  redirect. Not built.
- **Highlighting the matched term in the results.** A nicety, not asked for, and it needs the UI to know
  *which* field matched — which api does not currently say (it says only `referenceMatch`, and only for the
  exact-reference case). Out of scope; recorded so nobody assumes it was forgotten.
- **Welsh.** New strings follow the page's existing pattern — inline English in the handler's `en`/`cy`
  content objects, `cy = { ...en }` (`index.ts:123`). Consistent, still not right, still page-wide work.
  `yarn welsh:check` exists; do not let this plan make its output worse.
- **`referenceMatch` when the term matches a reference *and* names.** api decision 11 says `referenceMatch`
  is the exact-reference hit or null; presumably a term that is a valid reference redirects even if it also
  substring-matches a name somewhere. Confirm against the built api — if `referenceMatch` is populated, the
  UI redirects, full stop. Do not add logic weighing one against the other.

## Constraints

- **No `prisma.*`, no migration, no database, no local search.** There is none in this repo. `q` goes to api
  over HTTP through `libs/deed-poll-api-client`; api does the matching.
- **`Caller` is `{ accessToken }` and nothing else** (`libs/deed-poll/src/api/deed-poll-api.ts:51`), and a
  page obtains one from `callerFromRequest(req)` (`src/auth/current-user.ts:35`).
- **A page may not call the api client directly.** `callApi` is deliberately absent from
  `libs/deed-poll/src/index.ts`'s public surface — see the comment at lines 9-14. Pages call service
  functions in `libs/deed-poll/src/`.
- **The adapter never throws.** It returns `ApiResult<T>`; `callApi` maps a failed result to the domain
  errors `src/errors.ts` already renders. **No request or response logging at all** — `client.ts:8-14` states
  the no-PII rule has no debugging exception, and a search term is user text that may name a person.
- **The list URL wire format lives in `libs/deed-poll/src/deed-poll/case-query.ts`.** `caseListSearch`
  (line 137) is the one place a link to the list is built, and `CaseListLink` (256) is what it takes.
  `q` is added to both, and every existing caller (`listHref` at `index.ts:266`, the tab/sort/paging/clear
  links) inherits it. **Do not build a search URL any other way** — a second URL builder is exactly how one
  link forgets `q`.
- **The wire query type is `CaseListQuery` in `client.ts` and `DeedPollQuery` in `service.ts`.** `listCases`
  (`client.ts:97`) appends parameters to `URLSearchParams`; add `q` there the way `filter` and `sort` are
  added — set only when defined. `DeedPollQuery` (`service.ts:141`) and `findDeedPolls` (`service.ts:57`)
  thread it through. `size` is the model for an optional scalar that is omitted when absent.
- **`CaseSummary` and `CaseList` are wire types re-exported as domain types**, aliased not restated
  (`.claude/rules` — "the adapter's domain types are aliases of the wire types"). Adding `newSurname` to the
  wire schema flows to `buildCaseList`'s input automatically; adding `referenceMatch` to `caseListSchema`
  flows to what `findDeedPolls` returns. No separate domain type to edit.
- **Never run bare `yarn test`.** It fans 8 packages across 14 CPUs and the workers do not start:
  `Tasks: 0 successful, 8 total`, `Tests no tests`. Use `yarn turbo test test:app --concurrency=1`. **And do
  not treat `0 successful, 8 total` as proof that nothing ran** — it has also meant a real first-workspace
  failure stopping the other seven. Read the per-workspace output.
- **A worker-startup timeout is an environment failure, not a code failure.** `Failed to start forks worker`
  / `Timeout waiting for worker to respond` — **re-run before investigating.** It is a filesystem resource
  race, flaky not deterministic.
- **`yarn lint` is a single `biome check .`** It exits 0 today with two pre-existing `noUndeclaredEnvVars`
  warnings and a stale `biome.json` schema notice. Do not let the count grow.
- **Do not touch `charts/`**, and do not add a `values.template.yaml`. Nothing here is a deployment change.
- **`src/deployment-chart.test.ts` and `src/pipeline.test.ts` must stay green.** Neither should be affected;
  if either breaks, something outside this plan's scope was changed.
- **Do not delete any of the six pipeline scripts** — `lint`, `test`, `test:coverage`, `test:a11y`,
  `test:smoke`, `test:functional`. The Jenkins stage fails on a missing one and `src/pipeline.test.ts` pins
  it.
- **`libs/deed-poll` and `src/` tests stub the client rather than driving the mock.** They
  `vi.mock("@hmcts/deed-poll-api-client")` or `vi.mock("@hmcts/deed-poll")`. Only the api-client package's
  own `client.test.ts` and `mock/server.test.ts` start the in-memory mock in process
  (`.claude/rules/testing.md`).

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

**The baseline is measured, not estimated.** It is the same tree plan 11 measured on 2026-09-17 from a
`/tmp` copy of `case-query-fixes`'s tip (`d430d50`), all three commands green — **but this plan runs on top
of plan 11 (or a refreshed master), so re-measure the baseline against whatever tree this branch actually
starts from before trusting the delta.** The 2026-09-17 figure, for reference:

| Package | Tests |
|---|---|
| `//` (the app) | 488 |
| `@hmcts/deed-poll` | 684 |
| `@hmcts/deed-poll-api-client` | 192 |
| `@hmcts-cft/cloud-native-platform` | 140 |
| `@hmcts-cft/express-govuk-starter` | 127 |
| `@hmcts-cft/simple-router` | 41 |
| `@hmcts-cft/express-session-postgres` | 23 |
| `@hmcts-cft/express-session-redis` | 7 |
| **Total** | **1,702**, 8 of 8 tasks successful, 0 failures, 0 worker errors |

`yarn lint` exits 0 with exactly two `noUndeclaredEnvVars` warnings plus two infos — the documented
pre-existing state, not a regression. Compare **totals** and expect the count to rise monotonically; if a
total *falls*, stop — a test was lost, not replaced.

**Run these from a `/tmp` copy, not in the clone.** Measured 2026-09-16: the same `yarn build` took 19m26s in
the working tree and 13.8s in a `git archive HEAD` copy under `/tmp`. Use
`git archive HEAD | (mkdir -p /tmp/dpa-search && tar -x -C /tmp/dpa-search)`, then `yarn install` and run
there. This is the difference between a validation pass and a command that looks hung.

**For driving the app by hand while working:**

```bash
yarn mock:api          # in-memory api on :3200 — starts with NO cases
yarn mock:seed         # 32 cases across all five filter tabs, forename "Filterby", one with no surname
yarn idam:users        # admin@example.com / Pa55word11, in-memory, gone on restart
yarn dev:nowatch:web   # :3000 — prefer this over `yarn dev`; `turbo watch` stalls on this filesystem
```

**The seed's surname coverage is thin.** `scripts/seed-local-cases.mjs` seeds every case with forename
`Filterby` and one with no surname; it does **not** seed a spread of distinct surnames, so a `q=Smith` search
against the seed will match nothing until the mock and/or the seed grow surname data. Task 2 adds surname
matching to the mock; if the by-hand check needs varied surnames, extend the seed in the same task rather
than testing against a single forename. Note `yarn mock:seed`, **not** `yarn seed:cases` — the script's own
docblock names a script that does not exist.

## Tasks

### Task 0: Reconcile this plan against the refreshed spec — RUN THIS FIRST, ALONE

**Do not proceed past this task if it finds a divergence. Report and stop.**

Read `libs/deed-poll-api-client/openapi.json` and confirm it carries the search surface. Check, and write
the answer into the task log:

- **The `q` parameter on `GET /caseworker/cases`** — its exact name, and that it is a string query parameter.
- **`referenceMatch` on the list response schema** — its exact property name and type (a nullable string id,
  per api decision 11), and the exact schema name it sits on (`CaseListResponse` today).
- **`newSurname` on the summary schema** — its exact name and type, and the schema name
  (`CaseSummaryResponse` today).
- **Whether `newSurname` is a sortable field** — read the `sort` parameter's *description* prose per
  `SPEC-PROVENANCE.md`'s note (the operator/field vocabulary arrives as prose, not an enum). If it is not
  sortable, decision 6's sort field is wrong and the column must ship without a sort header — correct the
  plan.
- The exact reference-normalisation and name-field behaviour api implemented, so decision 5's "api owns this"
  is checked against what api actually did, not what its plan proposed.

Then **correct every [PROVISIONAL] marker in this document** to match, and delete the marker. A task below
that names a field the spec does not have is a task to rewrite before running, not to work around.

If the spec has no `q`, `referenceMatch` or `newSurname`, the gate at the top has not been met: stop.

- [ ] Spec confirmed to carry `q`, `referenceMatch` and `newSurname`; each name, type and owning schema
      recorded in the task log; `newSurname` sortability confirmed from the `sort` description; every
      [PROVISIONAL] marker corrected or the run stopped with a report

### Task 1: The wire schema additions and the adapter parameter

`libs/deed-poll-api-client/src/api/wire.ts`, then `client.ts`, then `contract.test.ts`. This is the task that
would turn the gate red if run early — it is here first among the implementation tasks so the schema and the
spec move together.

1. Add **`newSurname`** to `caseSummarySchema` (`wire.ts:239`), beside `newForename`, as
   `z.string().nullish()` — a response property with no published nullability is `.nullish()`, exactly as
   `newForename` is. **[PROVISIONAL]** on the exact name.
2. Add **`referenceMatch`** to `caseListSchema` (`wire.ts:257`) as `z.string().nullish()` — an id or null,
   api decision 11. **[PROVISIONAL]**.
3. **`STRICT_RESPONSE_PROPERTIES` (`wire.ts:454`) needs no change unless api publishes either new property as
   non-nullable** — neither is a Java primitive, so both stay nullish and neither joins the strict list. But
   the per-schema strictness test (`contract.test.ts:110`) asserts the schema rejects null for *exactly* the
   pinned set, so if `referenceMatch`/`newSurname` are added as nullish (they should be), that test stays
   green with no edit. Confirm, do not assume.
4. Add **`q`** to `CaseListQuery` and set it in `listCases` (`client.ts:97`): `if (query.q !== undefined)
   parameters.set("q", query.q)`, placed beside `filter`. It is a scalar set-once parameter, not repeated
   like `where`.

`contract.test.ts` needs **no new entry** — `q` adds no operation and no schema, and `referenceMatch`/
`newSurname` are properties of schemas already registered, so the existing per-schema property test
(`contract.test.ts:85-87`) is what proves they match the spec. That test is the whole point of doing this
task against a refreshed spec: green means the adapter and api agree on the new fields.

- [ ] `newSurname` on `caseSummarySchema` and `referenceMatch` on `caseListSchema`, both nullish and matching
      the refreshed spec's exact names; `q` set in `listCases` beside `filter`, omitted when undefined;
      `contract.test.ts` green (the per-schema property test is the proof); no strictness-list edit needed and
      confirmed so

### Task 2: The in-memory mock

`libs/deed-poll-api-client/src/mock/server.ts`. The unit suites and `yarn dev` both drive this, so a search
the mock does not answer cannot be developed against.

In `list()` (`server.ts:217`), read `parameters.get("q")` and, when present and non-blank, filter the
matching cases by it **before** paging. Model api's decisions 9–10 as closely as the mock models everything
else — it is a stand-in for the contract (`server.ts:5`):

- Trim the term. A blank `q` is no filter.
- **Reference match**: normalise case, hyphens and surrounding whitespace on both the term and the case's
  `displayReference` (and `referencenumber` as a string), and test equality. On an exact hit, that case's id
  is the response's `referenceMatch`.
- **Name match**: case-insensitive substring against `newForename`, `newSurname`, `oldForename`,
  `oldSurname`, `parents`, `representativeName` **[PROVISIONAL]** — use whatever field list the refreshed spec
  and api's decision 9 settle on.
- The two ORed per case; the `q` filter ANDed with the existing filter/where/sort chain
  (`server.ts:251-254`). **Keep the matcher in one helper** so it reads as one rule, mirroring api's
  decision-12 "one function" instruction.

Add **`referenceMatch`** to the response object (`server.ts:258-267`): the id of the exact-reference hit
among the *matching* set, or null when there is no `q` or no exact hit. Add **`newSurname`** to `toSummary`
(`server.ts:861`), from `record.newSurname`.

The seed (`scripts/seed-local-cases.mjs`) gives every case forename `Filterby` and thin surname data; if the
mock's own tests or a by-hand check need distinct surnames to exercise name matching, extend the seed here in
the same task rather than leaving surname matching untestable against real fixtures.

- [ ] `q` filters the list before paging, reference-exact ORed with name-substring in one helper, ANDed with
      the existing chain; `referenceMatch` set to the exact-reference hit or null; `newSurname` on
      `toSummary`; a mock test that a reference term populates `referenceMatch` and a name term does not; seed
      surname data added if the by-hand path needs it

### Task 3: The list URL carries q, and the query type threads it

`libs/deed-poll/src/deed-poll/case-query.ts` and `libs/deed-poll/src/deed-poll/service.ts`. Decision 1 — the
correctness core of the plan.

1. Add `q?: string` to **`CaseListLink`** (`case-query.ts:256`).
2. In **`caseListSearch`** (`case-query.ts:137`), set `q` on the `URLSearchParams` when it is defined and
   non-blank, following the `filter`/`sort` pattern at lines 143-145: `if (link.q !== undefined && link.q.trim()
   !== "") parameters.set("q", link.q.trim())`. Trimmed and omitted-when-empty, decision 3.
3. Add `q?: string` to **`DeedPollQuery`** (`service.ts:141`) and pass it through **`findDeedPolls`**
   (`service.ts:57`) into `listCases`'s query object, beside `filter`.
4. `case-query.test.ts` round-trips parse↔serialise; `caseListSearch` gains a `q` — add cases asserting `q`
   is carried, trimmed, and omitted when blank, in the style of the existing filter/sort cases.

**Do not add a `q` reader to `parseConditions` or the builder** — `q` is not a condition, it is a sibling
parameter. It is read from `req.query.q` in the handler (task 4), not parsed as a `where` entry.

- [ ] `q` on `CaseListLink` and `DeedPollQuery`, threaded through `caseListSearch` (trimmed, omitted when
      blank) and `findDeedPolls` into `listCases`; `case-query.test.ts` covers carried/trimmed/omitted; no
      change to condition parsing

### Task 4: The handler reads q, redirects on a reference match, and carries q on every link

`src/pages/deed-polls/index.ts`. This is where decisions 1, 2 and 4 meet.

1. **Read `q`** from `req.query.q` in `GET` (near the `filter`/`sort` reads at `index.ts:129-131`), trimmed;
   an empty string is `undefined`. Add it to the `ListView` interface (`index.ts:291`) and pass it into
   `runQuery`.
2. **Thread `q` into every `listHref` call** — the tab links (`index.ts:205`), the clear link
   (`index.ts:207`), the sort headers (`index.ts:215`), and the paging href builder (`index.ts:168`).
   `listHref` (`index.ts:266`) gains `q` in its parameter object and passes it to `caseListSearch`. Miss one
   and that link drops the search: decision 1. The cleanest implementation is to add `q` to the `ListView`
   destructured in `render()` and include it in the single `listHref` shape, so every call site inherits it.
3. **Redirect on a reference match** (decision 2): in `runQuery` (`index.ts:160`), after `findDeedPolls`
   returns, if the result's `referenceMatch` is a non-null id, `return res.redirect(\`/deed-polls/\${results.referenceMatch}\`)`
   before building the view. Do not redirect on `total == 1`.
4. **The search form's hidden inputs** need the current `filter`, each `where` condition, and `sort` — pass
   the serialised conditions (`serialiseConditions`, `case-query.ts:101`) and the `sort` value and filter key
   into the render model so the template (task 5) can emit them as hidden inputs. `q` itself is the visible
   input's value, so the search box shows what was searched.
5. Content strings in `en` (`index.ts:53`): a search label, a hint, and the button text. `cy = { ...en }`.

**A search that finds nothing is not an error** — it renders the empty-list state the page already has
(`index.njk:240`), with the search term still in the box so the caseworker can refine it. Do not add an error
path for a zero-result search.

- [ ] `q` read from the query, trimmed, empty→undefined, on `ListView`; carried through every `listHref`
      (tabs, clear, sort headers, paging) so no link drops it; a non-null `referenceMatch` redirects to the
      case and `total==1` does not; the serialised filter/where/sort passed to the render model for the search
      form's hidden inputs; search strings in `en`/`cy`; a handler test that every link carries `q` and that a
      reference match redirects

### Task 5: The search form and the new surname column in the template

`src/pages/deed-polls/index.njk`, and the list view model in `libs/deed-poll/src/deed-poll/list-view.ts`.

**The view model first** (decision 6): add `newSurname` to `CaseListRow` (`list-view.ts:19`), to
`CASE_LIST_COLUMNS` (`list-view.ts:41`) with sort field `newSurname` **[PROVISIONAL]**, and to `buildCaseList`
(`list-view.ts:55`) via `format("newSurname", record.newSurname)`. `list-view.test.ts` pins
`CASE_LIST_COLUMNS.length` (line 94) and the formatted fields (line 100) — update both to include the new
column; the count assertion rises by one.

**The template**: add a **search form above the filter nav** (`index.njk`, before line 27), per decision 4:

```njk
<form method="get" action="/deed-polls" class="govuk-!-margin-bottom-4" role="search">
  {# The active query travels as hidden inputs so a search composes with it — decision 4. #}
  <input type="hidden" name="filter" value="{{ activeFilter }}">
  {% for entry in searchWhere %}<input type="hidden" name="where" value="{{ entry }}">{% endfor %}
  {% if sortValue %}<input type="hidden" name="sort" value="{{ sortValue }}">{% endif %}
  {{ govukInput({
    id: "q", name: "q", type: "search", value: searchTerm,
    label: { text: searchLabel, classes: "govuk-label--s" },
    hint: { text: searchHint }
  }) }}
  {{ govukButton({ text: searchButton, classes: "govuk-button--secondary" }) }}
</form>
```

Then add the `newSurname` cell to the table row array (`index.njk:250-257`) — `{ text: c.newSurname }` after
the forename cell — so the seven columns match `CASE_LIST_COLUMNS`. The sort header loop (`index.njk:264-268`)
already renders one header per column from `sortHeaders`, so the new column's header appears automatically
once the view model carries it; no separate template edit for the header.

The empty-search and empty-list states are the same markup (`index.njk:240`); nothing to add there.

- [ ] `newSurname` on `CaseListRow`, `CASE_LIST_COLUMNS` and `buildCaseList`; `list-view.test.ts` count and
      field assertions updated (count +1); a `role="search"` GET form above the nav carrying filter/where/sort
      as hidden inputs and `q` as the visible search input; the surname cell in the row array so seven columns
      render; `index.njk.test.ts` updated for the new column and asserting the search form preserves an active
      query's hidden inputs

### Task 6: An e2e journey, and full validation

`e2e-tests/tests/deed-polls.spec.ts` — one happy path only, per the repo's e2e rules: seed cases, type a name
into the search box, submit, see the results filtered with the surname column populated; then type a full
reference and confirm the redirect lands on that case's detail page. Run the axe check the existing specs run.
Because the seed's surname data is thin (see the validation note), seed the cases the journey needs
explicitly via the mock's `POST /__mock/cases` or an extended seed rather than relying on `Filterby`.

Then the full validation from a `/tmp` copy:

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
yarn test:e2e --workers=1
```

Record the unit total against the baseline measured at this branch's actual start point (not the 1,702 figure
blindly — this branch sits on plan 11 or a moved master). **Re-run once before believing any worker-startup
failure.** Confirm `yarn welsh:check` is no worse than at the branch point.

- [ ] One e2e happy path — a name search filtering results and a reference search redirecting to the case —
      with an axe check; lint exit 0 with no new warnings; unit total up from the measured branch-point
      baseline with no suite lost; build green; e2e green; `welsh:check` no worse; the measured numbers written
      into this task's log rather than estimated

## Deliberately not in this plan

- **Saved and shared queries** — naming a query, publishing it, the library, the nav's second group. Plan 11,
  branch `saved-queries-ui`.
- **A minimum search length, term highlighting, or a suppressible redirect.** Open questions above; none asked
  for, none built (YAGNI).
- **Any local matching, normalisation or field-selection logic.** api owns the matching (decision 5); this
  repo sends `q` and renders the answer.
- **Fuzzy / trigram matching.** api decision 12 keeps v1 substring-only behind one function on its side and
  needs an infra `azure.extensions` change this repo has nothing to do with.
- **Any change to `CurrentUser`, the session, or auth.** Search carries no identity beyond the token every
  call already carries.
- **Welsh translation of the new strings.** Page-wide work, unchanged.
- **Indexing for `q`.** api's concern, and nothing is deployed to measure.
