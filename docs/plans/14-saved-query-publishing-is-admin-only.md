# Plan 14: publishing a saved query is an Administrator's act — the staff service's half

## Overview

Two changes, one plan, because they are the same rule seen from two sides:

1. **The "Publish this query" checkbox is an Administrator's control**, so a caseworker never sees it — on
   `queries/new` and on `queries/[queryId]/edit`.
2. **The two kinds of saved query are grouped on screen** — "Your queries" versus "Query library" — in *both*
   places that list them: the library page and the case list's filter bar.

The rule: saving a query for yourself is everybody's; publishing one to the library, where every caseworker
can find and add it, is an Administrator's. Product owner's decision, 2026-09-22.

## What api does, and why this plan does not wait for it

`deed-poll-api`'s half is [`gate-saved-query-publishing.md`](https://github.com/hmcts/deed-poll-api/blob/master/docs/plans/gate-saved-query-publishing.md),
merged as a plan in `#39`. It adds `SavedQueryPermissions.publishableBy` and refuses a non-Administrator's
`shared: true` with **403**, on create and on patch.

**The two repos are independent, and this was checked rather than assumed.** `contract.test.ts` is set-equality
over `components.schemas` and `paths`; it does not compare response codes. api carries **no `@ApiResponse`
annotations anywhere** — behaviour is documented in Javadoc — so its new 403 changes neither schemas nor paths
and triggers no spec refresh here. Either repo may land first, and this plan neither needs a regenerated
`openapi.json` nor may quietly refresh one.

Until api's half lands, this plan's UI gate is the only thing enforcing the rule, and it is presentational
only. That is stated as a known interim gap, not a design position: a caseworker who hand-crafts the POST
still publishes until api refuses.

## Decisions — implement these, do not revisit

### 1. The control is hidden, not disabled

`queries/index.ts` already records the reason for the Amend link, from `witness-edit.njk`: **a disabled
button has no value to read.** Hiding is also what makes the caseworker's form honest — there is no
"you may not do this" state to explain on a page where the action was never theirs.

### 2. The gate reads the app's own `isAdmin`, never api's `editable`

`userFromRequest(req).isAdmin` is the established pattern for presentational role gating —
`deed-polls/[id].ts:192` and `deed-polls/[id]/edit/[tab].ts:74` both do exactly this. It is derived from
`rolesFrom` and fails closed for an unlisted role.

**Do not reach for `row.editable`.** That flag answers a different question — *may this caller amend this
existing query* — and plan 11's decision 3 says the UI renders api's per-query flags and never recomputes
them. Publishing eligibility is a property of the **caller**, not of a row, so it is not something api's row
flags can answer and not something to add to them.

### 3. The grouping axis is published-ness, not ownership

"Your queries" is every query that is **not published**; "Query library" is every query that **is**,
including your own. Confirmed with the product owner.

Worth knowing why the axis is nearly moot: **for a caseworker the two axes render identically**, because
their own queries are always unpublished and everything published belongs to somebody else. They diverge only
for an Administrator who published their own query — and published-ness puts it in the group that tells the
truth about who else can see it.

### 4. `view.ts` performs the split; the template renders it — and `view.ts`'s docblock must change

`buildSavedQueryLibrary`'s docblock currently says the opposite: *"the template decides how to group them and
this file makes no claim about which grouping reads better."* That was correct while grouping was undecided.
It is now decided, and the same grouping must hold on two different screens, so it belongs in one tested
function rather than being re-derived in two templates.

**Update that docblock in the same commit as the change.** Leaving it would tell the next reader that grouping
is still an open question, which is precisely the drift this repo's docblocks exist to prevent.

### 5. An empty group renders no heading — in both places

`filterGroups` already encodes this, and its reason generalises: *"a labelled group over nothing announces a
list that is not there, and to a screen-reader user a heading is a promise of content."* With two saved-query
groups instead of one, that rule now has to hold **twice over** and in both directions — a caseworker with no
saved queries of their own and three from the library must see one heading, not an empty one above it.

The all-empty case on the library page keeps its existing single `empty` message rather than growing two.

### 6. Welsh carries English, and `yarn welsh:check` is **not** a validation command

The convention is `const cy = { ...en }`, deliberately — see the note in `deed-polls/index.ts:166`: build the
`en`/`cy` shape now, translate later, so translating is a content change rather than a page rewrite. New
copy follows it.

**`yarn welsh:check` exits 1 on clean master today** — verified 2026-09-22: `466 strings, 441 still identical
in cy`. It is a translation-progress report, not a gate, and it is **not** one of the six scripts the Jenkins
pipeline invokes. Putting it in the validation commands would start every task red, the same trap plan 13
recorded for `cnp-flux-config`'s `lint-yaml.sh`. New strings will raise that count, which is expected.

No change is needed to `scripts/extract-welsh-strings.mjs` — its `INCLUDE` already covers
`src/pages/deed-polls`, so `queries/**` is in scope. Verified.

### 7. api's 403 is left rendering on the 404 view

`src/errors.ts` maps `forbidden` → 403-on-the-404-template. For a form POST that is a poor page, and it is
**still the right answer here**: after decision 1 no page can produce the request, so the only ways to reach
it are a hand-crafted POST or an Administrator who lost the role between rendering the form and submitting
it. Building a bespoke refusal page for that would be speculative work on an unreachable path, and the
alternative — weakening the shared mapping — would degrade every other caseworker-facing 403.

### 8. The mock stays role-blind; the domain test supplies the refusal itself

The in-memory mock reads a **name and a subject** out of the forwarded token and deliberately **no roles**,
and that is fidelity rather than laziness: IDAM tokens carry no roles, and api resolves them from
`/o/userinfo`. Its docblock lists the saved-query permission rules among the things deliberately not
modelled, with *"if a page ever does depend on one, model it here and say so"*.

**No page depends on one**, because decision 2's gate reads the app's own session. So the mock is unchanged.
To pin that api's 403 becomes the right domain error, the service test returns the `forbidden` `ApiResult`
directly — which is what `.claude/rules/testing.md` prescribes anyway: mock the adapter, return its union,
and pin that a classified failure becomes the right domain error. Do **not** teach the mock about roles to
get an e2e assertion; use the persona switcher (decision 9).

### 9. The e2e proof is the persona switcher, and it may not run here

The switcher signs in as a real IDAM persona, so `admin@example.com` and `caseworker@example.com` differ in
the roles the app itself resolves — which is exactly what decision 2's gate reads. One happy-path spec,
per `.claude/rules/e2e-testing.md`.

**Playwright's browser download is proxy-blocked in this devcontainer** (HTTP 400 `GatewayExceptionResponse`,
not slowness). The workaround is to symlink a cached chromium build to the wanted version. If the spec cannot
be run, say so in the task rather than marking it done — a spec that has never executed is not proof.

## Validation Commands

All verified **2026-09-22, before any task runs**:

```bash
yarn lint                                   # EXIT 0 — 385 files, 3 warnings, 2 infos (warnings do not fail)
npx turbo test test:app --concurrency=1      # EXIT 0 — 3,087 tests, 166 files, 8/8 packages
```

Notes so no task rediscovers them:

- **Do not use bare `yarn test` as the gate.** `test` is `turbo test test:app`, and the `:app` suffix is
  load-bearing — the app is the root package, so a root task must be `//#test:app`. Measure the totals;
  a run that selects nothing also exits 0.
- **`yarn lint` was red on this machine and it was not the repo's fault.** Two stale git worktrees under
  `.claude/worktrees/` (`notify-2-email-tab`, `referrals-admin-4`, both clean and both fully merged) each
  carried a `biome.json`, and Biome refuses a nested root configuration. They were removed with
  `git worktree remove` on 2026-09-22 and lint went green. **If lint fails with "Found a nested root
  configuration", run `git worktree list` before changing anything in `biome.json`.**
- `yarn welsh:check` is expected to exit 1 — decision 6.

## Tasks

### Task 0: Reconcile before changing anything

- [x] Confirm the checkbox is still unconditional in `queries/new.njk` and `queries/edit.njk`, and that
      neither handler passes an admin flag
- [x] Confirm `buildSavedQueryLibrary` and `buildSavedQueryNav` still return one flat list each
- [x] Confirm `filterGroups` still omits the second group when empty, and note its test
- [x] Re-read `libs/deed-poll/src/saved-queries/view.test.ts` for the round-trip it pins, so the split does
      not break it
- [x] Record anything that has moved, in this file, before writing code
- [x] Task 0 complete

#### What Task 0 found, 2026-09-22 — read this rather than repeating it

Reconciled at `a451833` (master, this plan's own merge commit). **Nothing has moved:** every premise in the
Decisions section still holds as written. Four confirmations, and two findings that change the work.

**Confirmed as stated.**

1. **The checkbox is unconditional in both templates** — `new.njk:50` and `edit.njk:59`, each a bare
   `govukCheckboxes({ name: "shared", … })` with no enclosing `{% if %}`. Neither `new.ts` nor
   `[queryId]/edit.ts` mentions `isAdmin` or `userFromRequest` at all, so Task 1 adds the first role-awareness
   these two pages have ever had.
2. **Both builders return flat lists** — `buildSavedQueryNav(…): SavedQueryNavEntry[]` (`view.ts:105`) and
   `buildSavedQueryLibrary(…): SavedQueryRow[]` (`view.ts:132`).
3. **`filterGroups`' empty-group rule is pinned**, by `src/pages/deed-polls/index.test.ts:221` — *"renders no
   second group when the caseworker has selected nothing, rather than a heading over nothing"* — with the
   populated case at `:178` asserting `filterGroups` has length 2.
4. **The test baseline still stands**, because everything merged since it was measured is documentation:
   **3,087 tests across 166 files, 8/8 packages.** No need to re-measure before Task 1.

**Finding A — Task 3 may need no template change at all.** `index.test.ts:127` reads *"groups the nav's
entries under a label, so a second group costs no template change"*, so the filter-bar template already
iterates an arbitrary number of groups rather than naming two. If that holds, Task 3 reduces to `view.ts` and
`filterGroups`, touching no `.njk`. **Verify it at Task 3 rather than assuming** — that test's wording is
about a *second* group, and this plan may produce a third.

**Finding B — the round-trip this task was told to protect cannot be broken by this plan.**
`view.test.ts:239` round-trips a link through `savedQueryLink` ↔ `savedQueryStored` to keep those two
inverses. That is a **different pair** from the two builders being split, so the split cannot reach it. The
concern was misplaced; recorded as answered rather than quietly dropped.

The tests that **will** need updating are three others, and they are the real inventory for Tasks 2 and 3
(`view.test.ts` holds 37 tests in total):

| Test | Why it changes |
|---|---|
| `:214` "should list every query the caller can see, not only their selection" | asserts the library's flat shape |
| `:171` "should render nothing for an empty selection, leaving the page to omit the group" | singular "the group" becomes two |
| `:177` "should carry api's flags through untouched, both ways" | must keep passing **unchanged** — it is the guard on decision 2 |

### Task 1: Hide the Publish control from a caseworker

- [x] `queries/new.ts` and `queries/[queryId]/edit.ts`: read `isAdmin` from `userFromRequest(req)` and pass it
      into the render model, on both the GET and the re-render-with-errors path — **a validation failure must
      not make the control reappear or vanish**
- [x] Both templates: render the checkbox only when the flag is set
- [x] `edit.ts`'s POST already reads the **stored** `shared` rather than the checkbox's value for its
      delete-confirmation branch. Confirm that still holds — a caseworker's submit now sends no `shared` key
      at all, and the stored value must continue to decide
- [x] Page tests for both, with the flag given **both** values; template tests for both. **Spread the content
      pair first and the handler's values over it** (`{ ...(model.en as object), ...model }`) — the reverse
      order makes a handler-resolved string win in the test and pins nothing
- [x] **Added, not in the original list:** omit `shared` from the amend patch when the caller may not publish
- [x] Task 1 complete

#### What Task 1 did, 2026-09-22

`canPublish: userFromRequest(req).isAdmin` goes into both pages' render models, and both templates wrap the
share box in `{% if canPublish %}`. Both handlers already funnelled every path through a single `render()`
helper, so the GET and every re-render are covered by one line each rather than two — nothing was needed at
the handler level.

**A defect this task's checklist did not anticipate, and the substantive part of the work.** The amend page
built its patch as `{ name, description, shared: parsed.data.shared }` unconditionally. With the checkbox
hidden, a caseworker's body carries no `shared`, the schema yields `false` — and sending that **silently
unpublishes the query on an edit to its name**, taking it out of every colleague's filter bar. Its own copy
says what that costs: *"Colleagues who added it lose it."*

It is reachable without any hand-crafting: **an Administrator publishes a query, later loses the role, and
keeps ownership.** They may still amend it (api's `editable` is owner-or-admin-of-shared), so they can still
reach the form — and renaming it would unpublish it.

The fix is the three-state patch the wire schema already supports (`shared: z.boolean().optional()`, and
`JSON.stringify` drops an undefined property, so omitted genuinely means "leave as stored"):

```ts
...(userFromRequest(req).isAdmin ? { shared: parsed.data.shared } : {})
```

**Two existing tests had encoded the old behaviour**, and neither was wrong — both were under-specified about
*who* was acting, which `pageRequest({ admin: true })` expresses directly:

- *"should send the three controls the form showed"* — asserts `shared` is sent, so it needs an Administrator.
- *"should unpublish a query whose share box was unticked"* — an Administrator unticking the box **should**
  unpublish, so the test's intent was right. Renamed to name the persona rather than deleted.

**One existing test got stronger for free and passes unchanged:** *"should decide on the stored share flag, not
on a box unticked without saving"* drives a caseworker, who now has no box to untick at all — so the stored
flag is the only thing that could decide the delete-confirmation branch. Its comment now says so.

**Measured, not asserted.** `yarn lint` EXIT 0, 385 files, 3 warnings and 2 infos — the same as the baseline,
so no new ones. `npx turbo test test:app --concurrency=1` EXIT 0, 8/8 packages, **3,102 tests across 166
files**, up exactly 15 from the 3,087 baseline. The six lines matching "failed" in that output are
`console.error` from tests that deliberately drive failure paths; no non-zero failure count appears anywhere.

### Task 2: Split the library page into two groups

- [x] `view.ts`: replace `buildSavedQueryLibrary`'s single list with the two-group shape, keeping
      `SavedQueryRow` as it is. Update the docblock per decision 4
- [x] `queries/index.ts`: new `en` keys for the two headings, `cy` per decision 6
- [x] `queries/index.njk`: two headed sections, each omitted entirely when empty (decision 5); the existing
      `empty` message when both are
- [x] Keep the `Published` and `In your filter bar` tags. `Published` is now partly redundant with its
      group, but it is what a row keeps when read on its own, and the green tag is a different fact
- [x] Tests: the split function directly, the page handler, the template — including a caseworker with only
      library queries and one with only their own
- [x] Task 2 complete

#### What Task 2 did, 2026-09-22

**`buildSavedQueryLibrary` is renamed to `buildSavedQueryGroups`** and returns `{ yours, library }`. The
rename is not cosmetic: a function called `…Library` returning both groups would be a name that lies, and
`libs/deed-poll/src/index.ts` re-exports with `export *`, so nothing else needed touching. `SavedQueryRow` is
unchanged; a private `savedQueryRow()` builds one and the exported function only partitions.

Its docblock was rewritten per decision 4, and **the old reasoning is preserved rather than deleted** — it
used to say grouping was the template's business and that the file "makes no claim about which grouping reads
better". That was right while grouping was undecided; the new docblock says why it stopped being right.

The template uses a `queryGroup` macro so the row markup is written once — duplicating it is how one group
grows a control the other lacks.

**Three things beyond the checklist:**

1. **Heading levels moved.** Row titles were `h2`; with group headings now `h2`, rows became `h3`. Skipping or
   repeating a level breaks the hierarchy `.claude/rules/frontend.md` requires (h1 → h2 → h3).
2. **`sharedNote` moved under the library heading.** It warns that an added query stays its owner's and
   changes under you — true only of published queries, and a caller with nothing published has nothing to be
   warned about. It was previously under the page title, where it addressed everyone.
3. **A Welsh trap avoided, and a claim I had to correct.** The macro receives the *top-level* content names
   rather than `en.*`: the locale middleware spreads the **selected** pair over the model, so reaching into
   `en` would render English to a Welsh caseworker **while every test here still passed**, because the tests
   render with English selected. I first wrote that the macro *could not* see the template context; that was
   wrong — measured with a one-line Nunjucks render, a macro can. The comment now says the explicit parameter
   is for legibility, not necessity, because an inaccurate "why" is worse than none.

**Measured.** `npx turbo test test:app --concurrency=1` EXIT 0, 8/8, **3,113 tests across 166 files** — +11
for this task, +26 since the 3,087 baseline, which matches the 15 added in Task 1 exactly.
`@hmcts/deed-poll` went 1,050 → 1,054 and the root app 1,277 → 1,299. **`yarn build` EXIT 0**, which is what
actually typechecks the rename — vitest transpiles without checking types, so a missed usage would not have
shown up in the suite.

**`yarn lint` went red once and the cause is worth recording.** One assertion of mine exceeded the 160-column
width; `yarn lint:fix` rewrapped it and lint returned to EXIT 0. While diagnosing it I mis-attributed the
failure to an unused `UUID` const in `emails/[template]/compose.test.ts` — that is a real pre-existing
**warning**, left behind by notify-2's `2546c95` when it deleted the three tests that used it, and it is on
master. So the baseline's "3 warnings, 2 infos" is not noise: the warnings are that unused const plus two
turbo `env` declarations, and the infos are `biome.json`'s `$schema` pinned at `2.1.4` against a CLI at
`2.5.13`. None are this plan's, and none fail the build — but a future task should not read them as its own.

### Task 3: Split the filter-bar nav

- [ ] `view.ts`: `buildSavedQueryNav` splits on the same axis, still filtering to `selected` only
- [ ] `deed-polls/index.ts`: `savedQueryGroupLabel` becomes two labels; `filterGroups` emits each group only
      when non-empty (decision 5), so the bar may now carry one, two or three groups
- [ ] The degraded path is unchanged: `savedQueryEntries` catches, logs without PII, and returns empty — which
      must now mean **both** groups absent, not one empty group
- [ ] Tests: `filterGroups` with each combination of the two groups empty and non-empty
- [ ] Mark completed

### Task 4: One e2e journey

- [ ] A spec proving the control is present for `admin@example.com` and absent for `caseworker@example.com`,
      via the persona switcher, and that the two groups render
- [ ] Run it. If the browser cannot be provisioned, record that rather than ticking it (decision 9)
- [ ] Mark completed

### Task 5: Full validation

- [ ] Run both validation commands and **record the counts here** rather than asserting green
- [ ] Confirm the total rose by the number of tests added, and that no package dropped to zero
- [ ] Note the new `welsh:check` identical-string count, which is expected to rise
- [ ] Mark completed

## Out of scope

- **api's gate.** Separate repo, separate plan, already merged as a plan.
- **Teaching the mock about roles.** Decision 8.
- **A bespoke page for api's 403.** Decision 7.
- **Letting an Administrator publish on somebody else's behalf, or transfer ownership.** The owner is the
  token's subject and api has nowhere in `CreateSavedQueryInput` to put anyone else — structurally, not by a
  check. Nothing here should try to work around that.
- **Warning an Administrator that colleagues have selected a query they are about to unpublish.** Needs a
  count api does not expose; already a recorded open question there.
- **Per-user ordering of the filter bar.** Recorded open question in api, needs a position column.
