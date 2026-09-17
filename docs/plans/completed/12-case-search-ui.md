# Plan 12: a case search — the caseworker's side

## The api gate is MET — but this plan is still blocked on plan 11

**Reconciled 2026-09-17 against the refreshed spec.** This plan was written ahead of api's contract, with
every claim flagged. api's `saved-queries-and-search.md` has since **run and merged**
([`hmcts/deed-poll-api#16`](https://github.com/hmcts/deed-poll-api/pull/16)), and every contract claim below
has now been checked against the published document rather than assumed. **All [PROVISIONAL] markers are
resolved and removed.** Nothing in the search surface diverged from what api's plan proposed.

Verified against `libs/deed-poll-api-client/openapi.json` as refreshed by commit `f08ccd2` (api commit
`19fbb39`, 26 operations, 19 schemas):

| What this plan needs | In the refreshed spec |
|---|---|
| `q` query parameter on `GET /caseworker/cases` | **present** — `in: query`, `type: string`, `required: false` |
| `referenceMatch` on `CaseListResponse` | **present** — `type: string`; properties are `cases`, `filter`, `page`, `referenceMatch`, `size`, `total`, `totalPages` |
| `newSurname` on `CaseSummaryResponse` | **present** — `type: string` |
| `newSurname` sortable (decision 6) | **yes** — named in the `sort` description's field list |
| The six searched name fields (task 2) | **exactly** `newForename`, `newSurname`, `oldForename`, `oldSurname`, `parents`, `representativeName` |

**Task 0 is already partly done, by plan 11, and this is important.** Commit `f08ccd2` on branch
`saved-queries-ui` refreshed the spec **and registered both of plan 12's response properties** — because
`contract.test.ts` asserts exact property equality, an unregistered property would have made plan 11's suite
red for every one of its tasks. So `caseSummarySchema.newSurname` and `caseListSchema.referenceMatch` are
**already in `wire.ts`**, both `z.string().nullish()`, each with a comment naming plan 12 as the consumer.
**Task 1 must verify rather than re-add them** — see the task, which is rewritten accordingly.

**The remaining blocker is plan 11, not api.**

- **The refreshed spec exists only on `saved-queries-ui`.** `master` and this branch (`case-search-ui`) still
  carry the pre-refresh document — `git show master:libs/deed-poll-api-client/openapi.json | grep -c
  referenceMatch` returns `0`. **Running this plan on a tree without that refresh puts the contract test red
  from task 1**, which is the exact failure mode this section used to warn about. Do not branch plan 12 off
  `master`.
- **Both plans edit `src/pages/deed-polls/index.ts` and `src/pages/deed-polls/index.njk`.** They must not run
  in parallel; the second rebases on the first. See "Sequencing against plan 11" below.

**The gate, therefore, in order:**

1. **Let plan 11 finish** (it was mid-run on `saved-queries-ui` when this was reconciled) and land.
2. **Rebase this branch on plan 11's result**, so the tree carries the refreshed `openapi.json` and the two
   registered properties.
3. Then run from Task 0, which is now a verification task rather than a refresh task.

Should api's contract change again before this runs, the spec still wins and this plan is still wrong —
Task 0 exists to catch that.

## Overview

Plan 10 gave a caseworker a field-by-field query builder. It answers *"show me every Minor received in
June"* well and *"find the Smith case"* badly — a name is a `contains` condition three clicks deep, and a
reference number is not a queryable field at all. This plan adds the other half: **a single search box** that
matches a reference exactly or a name loosely, composing with whatever filter and conditions are already
applied.

The matching is entirely api's. This repo sends `q` and renders what comes back — it does not split the term,
decide what counts as a reference, or search anything locally. Three api-side facts drive the UI, all three
now confirmed against the published document:

- **`q` is one parameter on `GET /caseworker/cases`** (api decision 8), ORed internally across six name
  fields and the reference and ANDed with `filter` and `where` (decisions 9–10). The published description
  states the rule in full, and two details worth having in the UI's head: matching is **substring, not
  fuzzy** — a misspelling does not match, so there is no "did you mean" to render — and a term **longer than
  100 characters is truncated rather than refused**, so a paste of junk returns results rather than a 400.
  Addresses and narrative fields are deliberately not searched.
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

- **Plan 11 has already refreshed `openapi.json`** (commit `f08ccd2`) and registered plan 12's two response
  properties with it. So plan 12's Task 0 is a verification, not a refresh — and plan 12 **must** run on a
  tree containing that commit.
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
   render it. Its sort field is `newSurname`, **confirmed sortable**: the `sort` parameter's description names
   it in the sortable-field list (that list is prose, not an enum, per `list-view.ts:36-40`). So the column
   ships *with* a sort header, and there is no 400 risk.
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

### Task 0: Confirm the tree carries plan 11's spec refresh — RUN THIS FIRST, ALONE

**This is now a verification task.** The reconciliation it used to demand was done by hand on 2026-09-17 and
its results are written into this plan — every claim in the table at the top was checked against the
published document, and no `[PROVISIONAL]` markers remain. What this task guards is different and narrower:
**that the tree you are about to run against actually contains the refreshed spec.**

That matters because the refresh lives on plan 11's branch, not on `master`. Run these three checks:

```bash
# 1. The spec must carry referenceMatch on the LIST response. Must print a name, not an error.
yq -p json -o json '.components.schemas.CaseListResponse.properties.referenceMatch' \
  libs/deed-poll-api-client/openapi.json
yq -p json -o json '.components.schemas.CaseSummaryResponse.properties.newSurname' \
  libs/deed-poll-api-client/openapi.json
yq -p json -o json '.paths."/caseworker/cases".get.parameters[] | select(.name == "q") | .name' \
  libs/deed-poll-api-client/openapi.json

# 2. Plan 11 already registered both properties in the zod schemas — both must ALREADY be here.
grep -c 'referenceMatch' libs/deed-poll-api-client/src/api/wire.ts   # expect 1 (0 = wrong tree)
grep -c 'newSurname'     libs/deed-poll-api-client/src/api/wire.ts   # expect 3 (2 = wrong tree)

# 3. The authoritative gate, and the one to trust over any grep above.
yarn workspace @hmcts/deed-poll-api-client run test
```

**Read check 2's `newSurname` count carefully: it is 3, not 1.** `newSurname` is already a property of two
*other* schemas — the case-detail response (`wire.ts:111`) and the update request (`wire.ts:302`, which is
`.max(1000)`, not nullish). Only the third occurrence, on **`caseSummarySchema`** (the schema behind the
*list rows*), is the one this plan needs. Verified 2026-09-17: pre-refresh trees have 2, refreshed have 3, so
a bare "is it there at all" grep gives a **false pass**. `referenceMatch` is unambiguous at 1 versus 0.

**Check 3 is the one that cannot be fooled.** If the counts and the test disagree, believe the test and
investigate — the counts are a fast triage, not the contract.

**If check 1 errors or returns null for any of the three, STOP.** The tree predates plan 11's `f08ccd2`;
rebase on plan 11 and start again. Proceeding would put `contract.test.ts` red from task 1 and every later
task would report the same red, which teaches nothing.

**If check 2 finds both already registered, that is expected, not a surprise** — plan 11 added them so its own
suite would not be red. Task 1 verifies them rather than adding them.

Then re-read the table at the top of this plan against the spec in *this* tree. If api has shipped a further
change since `19fbb39` that contradicts any row, **the spec wins, this plan is wrong, and the right move is
to stop and report** rather than to work around it.

- [x] Refreshed spec confirmed present in this tree (`q`, `referenceMatch`, `newSurname` all found);
      `wire.ts` confirmed to already carry both properties as `nullish`; `@hmcts/deed-poll-api-client` test
      suite green **before** any edit; the table at the top re-checked against this tree's spec and either
      confirmed or the run stopped with a report

**Verified 2026-09-17 at `6d70e6e` (branch `case-search-ui-rebased`).** Every row of the table at the top of
this plan re-checked against *this* tree's spec, all confirmed, nothing contradicted:

- `openapi.json` carries **26 operations, 19 schemas** — the `f08ccd2` refresh, matching the figure the table
  cites. `CaseListResponse.properties` is exactly `cases, filter, page, referenceMatch, size, total,
  totalPages`, with `referenceMatch: {type: string}` and no `required` array; `CaseSummaryResponse.newSurname`
  is `{type: string}`, also with no `required`. So both are correctly `.nullish()` and neither belongs on
  `STRICT_RESPONSE_PROPERTIES` — task 1's point 3 holds.
- `q` is present on `GET /caseworker/cases` as `in: query`, `type: string`, `required: false`. Its published
  description names **exactly** the six searched fields task 2 lists — `newForename`, `newSurname`,
  `oldForename`, `oldSurname`, `parents`, `representativeName` — and states the OR-then-AND rule, substring
  not fuzzy, the 100-character truncation, that addresses and narrative fields are excluded, and that
  `referenceMatch` carries the exactly-matched case's id. Nothing to reinterpret.
- `newSurname` appears in the `sort` parameter's sortable-field prose, so decision 6's column ships with a
  sort header and no 400 risk.
- Check 2's counts came back as the plan predicts a *refreshed* tree: `referenceMatch` 1, `newSurname` 3 (the
  third being `caseSummarySchema` at `wire.ts:263`; the other two are the detail response at 124 and the
  update request at 324). Both plan-12 properties are registered as `z.string().nullish()` at `wire.ts:263`
  and `wire.ts:285`, each with the comment task 1 point 2 tells us to rewrite.
- Check 3, the gate that cannot be fooled: `@hmcts/deed-poll-api-client` **4 files, 221 tests, all passing**
  before any edit. Note 221, not the 192 in the baseline table — plan 11 added tests after that figure was
  measured, so **this package's branch-point baseline is 221**, and task 6 should compare against a baseline
  re-measured here rather than the 1,702 total.
- One immaterial correction to task 1's prose: the update request's `newSurname` (`wire.ts:324`) is
  `.max(1000).nullish()`, not `.max(1000)` alone as the task text says. It is not a property this plan edits.

### Task 1: The wire schema additions and the adapter parameter

`libs/deed-poll-api-client/src/api/wire.ts`, then `client.ts`. **Most of the schema half of this task is
already done** — plan 11's `f08ccd2` registered both response properties, for its own sake rather than this
plan's. So this task is now mostly `q`, plus a verification.

1. **Verify, do not add: `newSurname` on `caseSummarySchema`** (around `wire.ts:250`) as
   `z.string().nullish()`, beside `newForename`. It is already there with a comment naming plan 12 as the
   consumer. If it is missing, Task 0's check 2 failed and you are on the wrong tree — stop.
2. **Verify, do not add: `referenceMatch` on `caseListSchema`** (around `wire.ts:272`) as
   `z.string().nullish()`. Also already there, also commented. Same instruction if missing.
   - Both comments say "nothing reads this until plan 12". **This plan is what makes them read.** Update both
     comments to describe the property rather than promise a consumer — a comment that still says "nothing
     reads it" once something does is worse than no comment.
3. **`STRICT_RESPONSE_PROPERTIES` (`wire.ts:454`) needs no change.** Both properties are published as
   `type: string` with no `required` entry, so both are `.nullish()` and neither joins the strict list. The
   per-schema strictness test (`contract.test.ts:110`) asserts the schema rejects null for *exactly* the
   pinned set, so it stays green with no edit. Confirm by running the suite, do not assume.
4. **The one real code change: add `q`** to `CaseListQuery` and set it in `listCases` (`client.ts:97`):
   `if (query.q !== undefined) parameters.set("q", query.q)`, beside `filter`. It is a scalar set-once
   parameter, not repeated like `where`.

`contract.test.ts` needs **no new entry** — `q` adds no operation and no schema, and both properties belong to
schemas already registered, so the existing per-schema property test (`contract.test.ts:85-87`) is what proves
the adapter and api agree.

- [x] Both response properties confirmed present and nullish (not re-added); both stale "nothing reads this
      yet" comments updated now that plan 12 reads them; `q` on `CaseListQuery` and set in `listCases` beside
      `filter`, omitted when undefined; `@hmcts/deed-poll-api-client` suite green; no strictness-list edit
      needed and confirmed so

**Done 2026-09-17.** `caseSummarySchema.newSurname` (`wire.ts:263`) and `caseListSchema.referenceMatch`
(`wire.ts:285`) were both already `z.string().nullish()` and were left as they are; only their comments
changed, each now describing the property instead of promising plan 12 as a future consumer. The code change
is `q?: string` on `CaseListQuery` with `if (query.q !== undefined) parameters.set("q", query.q)` beside
`filter` in `listCases` — a set-once scalar, not appended like `where`.

`STRICT_RESPONSE_PROPERTIES` was not edited and `contract.test.ts` stayed green, so point 3 is confirmed by
the suite rather than assumed. `client.test.ts` gains one test that records the request URL off its own
`http` server — the mock cannot answer a `q` until task 2, and what is worth pinning at this layer is the URL:
`{filter: "open", q: "Smith"}` produces `?filter=open&q=Smith` and `{filter: "open"}` produces `?filter=open`
with no empty `q=`. Measured after the change: api-client **222** (was 221), full suite **1,895** across 8 of
8 tasks with 0 failures (redis 7, cnp 140, simple-router 41, session-postgres 23, api-client 222, deed-poll
740, govuk-starter 127, app 595). `yarn lint` exit 0 with the documented 2 warnings and 2 infos; `yarn build`
green in 14.6s from the `/tmp` copy.

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
- **Name match**: case-insensitive substring against exactly `newForename`, `newSurname`, `oldForename`,
  `oldSurname`, `parents`, `representativeName` — **confirmed**: these are the six the published `q`
  description names, and the list is closed. Addresses and narrative fields are deliberately excluded, so the
  mock must not match them either. Substring, **not fuzzy** — do not add any tolerance for misspelling.
- The two ORed per case; the `q` filter ANDed with the existing filter/where/sort chain
  (`server.ts:251-254`). **Keep the matcher in one helper** so it reads as one rule, mirroring api's
  decision-12 "one function" instruction.

Add **`referenceMatch`** to the response object (`server.ts:258-267`): the id of the exact-reference hit
among the *matching* set, or null when there is no `q` or no exact hit. Add **`newSurname`** to `toSummary`
(`server.ts:861`), from `record.newSurname`.

The seed (`scripts/seed-local-cases.mjs`) gives every case forename `Filterby` and thin surname data; if the
mock's own tests or a by-hand check need distinct surnames to exercise name matching, extend the seed here in
the same task rather than leaving surname matching untestable against real fixtures.

- [x] `q` filters the list before paging, reference-exact ORed with name-substring in one helper, ANDed with
      the existing chain; `referenceMatch` set to the exact-reference hit or null; `newSurname` on
      `toSummary`; a mock test that a reference term populates `referenceMatch` and a name term does not; seed
      surname data added if the by-hand path needs it

**Done 2026-09-17.** `list()` reads `parameters.get("q")`, trims it, and applies `matchesTerm` as a fourth
`.filter` in the existing chain — after the tab and the conditions, **before** the sort and the slice, so the
term narrows what is paged rather than the page being matched after the fact. A blank or whitespace-only term
is no filter, so the no-search request is byte-identically the one the list already made (decision 8).

`matchesTerm` is the one helper api's decision 12 asks for: `matchesReference` ORed with a case-insensitive
substring over `SEARCHED_NAME_FIELDS`, a new module-level const holding exactly the six fields the published
`q` description names. The reference match normalises case, hyphens and spaces on both sides
(`normaliseReference`), tests `displayReference` and `referencenumber` as a string, and returns false for a
term that normalises to empty — otherwise a case with no reference would match a blank term. No fuzziness and
no field beyond the six: a test seeds `applicantAddress1` and `returnReason` with the search term and asserts
zero matches, so a later widening of the matcher fails here.

`referenceMatch` is the exact hit **among the matching set**, or null — computed off `matching`, not off every
case, because a page redirecting to a case the caseworker's own filter had just excluded is worse than the
empty list they asked for. That is pinned: `q=<reference>&filter=open` on an Enroled case answers `total: 0`
with `referenceMatch: null`. `toSummary` gains `newSurname` from `record.newSurname`.

**The seed was not changed, deliberately.** The plan's validation note calls its surname data thin, but
`scripts/seed-local-cases.mjs` already sets `newSurname` per group — `Adultcase` (26), `Minorcase` (3),
`Returnedcase` (2), one blank — and a `displayReference` per case, so the by-hand path has both a name search
that returns a subset and a reference search that redirects. Distinct per-case surnames would have bought
nothing and would have broken the `newSurname:is:Adultcase` condition the seed's own docblock relies on.

Measured: api-client **242** (was 222 after task 1), full suite **1,915** across 8 of 8 tasks, 0 failures —
redis 7, cnp 140, simple-router 41, session-postgres 23, api-client 242, deed-poll 740, govuk-starter 127, app
595. `yarn lint` exit 0 with the documented 2 warnings and 2 infos. `yarn build` green in 13.3s from a `/tmp`
copy carrying the working tree.

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

- [x] `q` on `CaseListLink` and `DeedPollQuery`, threaded through `caseListSearch` (trimmed, omitted when
      blank) and `findDeedPolls` into `listCases`; `case-query.test.ts` covers carried/trimmed/omitted; no
      change to condition parsing

**Done 2026-09-17.** `q?: string` is on `CaseListLink` and on `DeedPollQuery`, and `caseListSearch` sets it
between `filter` and the `where` entries with `if (link.q !== undefined && link.q.trim() !== "")
parameters.set("q", link.q.trim())` — so the term is trimmed once, in the one place a list URL is built, and
a term that is only whitespace produces no parameter at all rather than `q=`. `findDeedPolls` passes
`query.q` straight into `listCases` beside `filter`; it does **not** trim, because the trim belongs where the
URL is written and a service that trimmed too would be a second opinion about the same string.

`parseConditions` and the builder are untouched — `q` is read from `req.query.q` by the handler in task 4,
not parsed as a `where` entry.

Two existing `service.test.ts` assertions compared the `listCases` argument by exact equality, so both now
name `q: undefined`; that is the assertion earning its keep rather than noise — an exact-equality test is
what would catch `q` being sent as `""`. New tests: three in `case-query.test.ts` (carried beside
filter/where/sort/page, trimmed, omitted when blank or undefined) and two in `service.test.ts` (the term
reaches `listCases` alongside the tab and the conditions; `referenceMatch` comes back out of `findDeedPolls`
untouched, since deciding what counts as an exact reference is api's).

Measured: `@hmcts/deed-poll` **745** (was 740), full suite **1,920** across 8 of 8 tasks, 0 failures — redis
7, cnp 140, simple-router 41, session-postgres 23, api-client 242, deed-poll 745, govuk-starter 127, app 595.
`yarn lint` exit 0 with the documented 2 warnings and 2 infos. `yarn build` green in 12.9s from a `/tmp` copy.
One note for later tasks: a `/tmp` copy made with `tar` rather than `git archive` carries the untracked
`tsconfig.tsbuildinfo` files, and with `dist/` excluded `tsc` then emits nothing and
`express-govuk-starter#build` fails on `cp`. Delete the `*.tsbuildinfo` files in the copy — it is not a code
failure.

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

- [x] `q` read from the query, trimmed, empty→undefined, on `ListView`; carried through every `listHref`
      (tabs, clear, sort headers, paging) so no link drops it; a non-null `referenceMatch` redirects to the
      case and `total==1` does not; the serialised filter/where/sort passed to the render model for the search
      form's hidden inputs; search strings in `en`/`cy`; a handler test that every link carries `q` and that a
      reference match redirects

**Done 2026-09-17.** `searchTerm(query.q)` is the handler's own reader — trimmed, `undefined` for a blank or
whitespace-only term, and `undefined` for a repeated `?q=a&q=b` that arrives as an array. It is local rather
than beside `parseSort` in the domain deliberately: `q` is free text this app has no opinion about
(decision 5), so all it decides is whether there is a term at all.

`q` is on `ListView` and in `listHref`'s single parameter shape, which is what made decision 1 hold without
visiting each link: the tab links, the clear link, the sort headers and the paging hrefs all inherited it
from that one shape. Pinned by tests per link class rather than as one assertion, because the failure this
guards is exactly one call site being missed.

**Two carriers the task text did not name, both added:**

- **The builder form.** Its "Apply filters" submit is the one round trip on the page that is not a link, so
  the term travels as a hidden `q` control (`index.njk`) and the canonical redirect at `index.ts` includes
  it. Without both, applying a filter to a set of search results silently dropped the search — decision 1's
  own failure mode, reached by a route the task's list of `listHref` call sites did not cover. The template
  edit is one input and its comment; task 5's search form is untouched by it.
- **`res.render`'s `searchTerm` and `searchWhere`.** `searchTerm` is `q ?? ""` so the box shows what was
  searched; `searchWhere` is `serialiseConditions` over the conditions **minus blank rows** — a row holding
  nothing narrows nothing, and emitting `where=:` from the search form would put a parameter in the URL that
  says nothing (the same exception `caseListSearch` makes). `filterValue` and `sortValue` were already in the
  model, so the form's other hidden inputs needed nothing new.

The redirect is `res.redirect(`/deed-polls/${results.referenceMatch}`)` on a truthy `referenceMatch`, before
the view is built, and nothing looks at `total`. Both halves are pinned: `referenceMatch: "case-1"` redirects
and renders nothing, and a one-row page with `referenceMatch: null` renders the list.

**Two things deliberately left carrying no `q`, so neither is mistaken for an oversight:**

- **The saved-query nav entries.** `buildSavedQueryNav` builds each href from the *saved* query's own
  filter/conditions/sort — it replaces the query rather than modifying it — and threading `q` through it
  means changing plan 11's domain signature. Out of this task's scope.
- **`saveQueryHref`.** api's saved query has a `searchTerm` column and `saved-queries/view.ts:165` records
  that writing it is "plan 12's". It is not written here either: saving a term means the save page reading
  `q` and the create body carrying it, which is the saved-query journey plan 12's own "deliberately not in
  this plan" hands back to plan 11. Flagged rather than done.

Measured: app **612** (was 595), full suite **1,937** across 8 of 8 tasks, 0 failures — redis 7, cnp 140,
simple-router 41, session-postgres 23, api-client 242, deed-poll 745, govuk-starter 127, app 612. The 17 new
tests are 15 in `index.test.ts` and 2 in `index.njk.test.ts` (the builder's hidden `q`, and its absence when
nothing was searched). No existing assertion needed changing: `toHaveBeenCalledWith` ignores an `undefined`
property, so the tests that compare the `findDeedPolls` argument by equality accepted `q: undefined` as they
already accepted `sort: undefined`. `yarn lint` exit 0 with the documented 2 warnings and 2 infos;
`yarn build` green in 13.9s from a `/tmp` copy with the `*.tsbuildinfo` files deleted.

### Task 5: The search form and the new surname column in the template

`src/pages/deed-polls/index.njk`, and the list view model in `libs/deed-poll/src/deed-poll/list-view.ts`.

**The view model first** (decision 6): add `newSurname` to `CaseListRow` (`list-view.ts:19`), to
`CASE_LIST_COLUMNS` (`list-view.ts:41`) with sort field `newSurname` (confirmed sortable), and to `buildCaseList`
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

- [x] `newSurname` on `CaseListRow`, `CASE_LIST_COLUMNS` and `buildCaseList`; `list-view.test.ts` count and
      field assertions updated (count +1); a `role="search"` GET form above the nav carrying filter/where/sort
      as hidden inputs and `q` as the visible search input; the surname cell in the row array so seven columns
      render; `index.njk.test.ts` updated for the new column and asserting the search form preserves an active
      query's hidden inputs

**Done 2026-09-17.** `newSurname` is `CASE_LIST_COLUMNS`' seventh entry — appended **after** `newForename`
rather than inserted beside it, so every existing index-keyed assertion in `list-sort.test.ts` and
`index.test.ts` still names the column it did before; the cell went in the same position in the template's row
array. `buildCaseList` maps it through the shared `format`, so an unset surname shows the same placeholder the
other cells show rather than an empty td.

The count assertion in `list-view.test.ts` needed no edit: it compares the row's cell keys against
`CASE_LIST_COLUMNS.length`, so it moved from 6 to 7 on both sides at once and is the assertion that would have
caught a column added to one and not the other. **Two enumerated assertions elsewhere did need the new entry**
— `list-sort.test.ts:83`'s list of unsorted-column hrefs and `index.test.ts:598`'s list of sort-header hrefs —
which is those tests earning their keep: a header offering an order the table cannot show is decision 8's own
failure mode.

The search form is above the nav, `role="search"`, `method="get"`, and carries `filterValue`, each entry of
`searchWhere` and `sortValue` as hidden inputs with **no `page`**. The visible control is `govukInput` with
`type="search"` — a labelled, hinted, `aria-describedby`-wired native input, no JavaScript, so a set of results
is a shareable URL. The hint states what api actually matches: a reference has to be whole, a name matches any
part, and there is no tolerance for a misspelling.

**One existing test had to change rather than be added to**, and it is worth naming: `index.njk.test.ts`'s
"carries no search control when nothing was searched" asserted the markup contained no `name="q"` at all,
which was true only while the builder's hidden control was the page's only `q`. It is now scoped to
`<input type="hidden" name="q"` — the builder's copy is what must be absent when there is no term, while the
search box is always named `q`. Left as a bare `name="q"` it would have failed for the right reason and the
wrong cause.

Also updated for accuracy rather than behaviour: `list-sort.ts`'s docblock said "only the six columns the
table shows are sortable" and `buildCaseList`'s said a table "that shows six cells", both now unnumbered or
seven — a comment that counts wrongly is worse than one that does not count.

Measured: `@hmcts/deed-poll` **748** (was 745, +3 in `list-view.test.ts`), app **621** (was 612 — 8 search-form
tests and 1 for the column and its header). Full suite **1,949** across 8 of 8 tasks, 0 failures — redis 7,
cnp 140, simple-router 41, session-postgres 23, api-client 242, deed-poll 748, govuk-starter 127, app 621.
`yarn lint` exit 0 with the documented 2 warnings and 2 infos. `yarn build` green in 13.6s from a `/tmp` copy
of the working tree with the `*.tsbuildinfo` files excluded.

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

- [x] One e2e happy path — a name search filtering results and a reference search redirecting to the case —
      with an axe check; lint exit 0 with no new warnings; unit total up from the measured branch-point
      baseline with no suite lost; build green; e2e green; `welsh:check` no worse; the measured numbers written
      into this task's log rather than estimated

**Done 2026-09-17.** One journey, `caseworker searches the list by name, and is taken to the case when the term
is a whole reference`, in `e2e-tests/tests/deed-polls.spec.ts` — the two things a term can be, in one test,
because they are one gesture with two answers. A name narrows the list; a whole reference redirects. Both axe
checks run inline, on the results page and on the case the redirect lands on, per `.claude/rules/e2e-testing.md`.

`seedCasesToSearch` seeds three cases through `POST /__mock/cases`: two sharing a surname unique to the test
run and one with a different one, so a matcher that returned everything fails here rather than passing on a
list it never narrowed. **The display references are unique per run too, and that is load-bearing rather than
tidy**: the redirect goes to the *first* case whose reference matches, so a second case carrying the same
reference would send the journey to somebody else's case and the heading assertion would still pass. Four
digits off the clock in seconds, with a leading digit clear of the other seeds' `1`/`2`/`3` and of the
`0000n` serials a create allocates.

**The seed was still not extended** (the validation note suggested it might need to be): a journey that needs
two cases with one surname and one without is three seeded cases, not a change to the 32-case fixture every
other spec shares — and `scripts/seed-local-cases.mjs` gives every case one of three surnames, so a search
for any of them matches 26 rows rather than a subset worth asserting on.

**Two mechanics worth recording, neither a product defect:**

- **The seventh sort header is activated from the keyboard, not clicked.** Its link is "Sort by" as visually
  hidden text plus the label, and in the narrowest column that wraps onto two lines — the centre of a wrapped
  anchor's bounding box is the gutter between its line boxes, where the `<th>` is what paints, so Playwright's
  centre click is intercepted by the cell. A real user clicks the words. `focus()` then `Enter` is what a
  keyboard user does and is layout-independent; the markup is not worked around because nothing about it is
  wrong.
- **The URL after that press is waited for, not read.** `keyboard.press` does not await the navigation it
  starts, so `page.url()` a moment later is still the URL that was searched — the first version of the
  assertion read `sort` as `null` for exactly that reason. `expect(page).toHaveURL` retries; the `q` check
  then reads a settled URL.

**Measured on the working tree, from `/tmp/dpa-t5` carrying it, servers started by hand (`yarn mock:api`,
`build:app:dev` + `tsx src/server.ts`) and reused by Playwright's `webServer`:**

| Command | Result |
|---|---|
| `yarn lint` | exit 0, **2 warnings, 2 infos** — the documented pre-existing state, unchanged |
| `yarn turbo test test:app --concurrency=1` | **1,949**, 8 of 8 tasks, 0 failures, 0 worker errors |
| `yarn build` | green, 13.0s |
| `yarn test:e2e --workers=1` | **28 passed** (27 before, +1), 1.8m |

Unit totals per package, unchanged from task 5 because this task adds no unit test: redis 7, cnp 140,
simple-router 41, session-postgres 23, api-client 242, deed-poll 748, govuk-starter 127, app 621. Nothing
fell, so no suite was lost — the branch-point baseline was 1,702 as measured before plan 11's own additions,
and the api-client's own branch-point figure was 221 (task 0's note), so the delta this plan is responsible
for is api-client 221→242, deed-poll →748, app →621.

**One note on the `/tmp` copy, for the next run:** an `rsync` of the working tree carries the untracked
`rules-of-engagement.md` symlink, whose target is outside the repo, and `biome` then reports a third warning
as `internalError/fs`. It is the copy, not the code — the working tree reports exactly two. Delete the symlink
in the copy before trusting the count.

**`welsh:check` is no worse, and the arithmetic is worth stating rather than asserting.** Branch point
(`6d70e6e`): 225 strings, 200 still identical in `cy` (193 prose). Now: 228 strings, 203 identical (196 prose).
The three new strings are the search label, hint and button, English in `cy` via `cy = { ...en }` — the page's
existing pattern, and the plan's own open question. No previously translated string regressed; the untranslated
*proportion* is unchanged.

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
