# Plan 10: make the query builder usable — reachable values, a curated field list, a real filter nav

## Overview

Plan 08 built the query builder and plan 09's successor shipped it. **It works, and it is not usable.** Three
faults, found by driving it on 2026-09-16 with 32 seeded cases:

1. **The value control is unreachable except through a failed submit.** A caseworker picks a field and a
   comparison, and there is nowhere to type the value.
2. **The field chooser offers 68 options in one flat `<select>`**, many of which are per-case identifiers,
   narrative prose or address components nobody builds a worklist from.
3. **The filter tab bar is not a component.** It is a `<nav>` of bare inline elements held together by
   `govuk-!-` override utilities, with the current tab marked by `<strong>`.

This plan fixes all three. **It has no api dependency and can run today.** The saved-and-shared queries and the
case search that motivated this review are plans 11 and api's `saved-queries-and-search.md`; this plan
deliberately goes first because the builder has to be worth saving a query *of* before saving one is worth
building.

### The value-control fault, traced

Not inferred — traced through the domain functions with the operator arity that produces it:

```
pick field "type", pick comparison "is", press the only button on offer ("Apply filters")
  → ?where=type%3Ais%3A
  → api 400: "is takes one value, and was given 0"   (addressed to where.0)
  → page re-renders with control="select", field and operator preserved
```

So the value control **does** render, and the round trip **does** preserve the row. The fault is that the only
action which reveals it also runs the query, and an incomplete condition necessarily fails first. The caseworker
is shown an error for a step they have not been given the means to complete.

The cause is decision 7 of plan 08 — no JavaScript — combined with three actions (`add`, `remove`, `apply`) and no
fourth meaning *"I have chosen a comparison, show me its value control"*.

### What changed outside this repo

**JavaScript is now permitted.** Confirmed by Steve on 2026-09-16: this is an internal line-of-business
application on managed devices. **Accessibility expectations are unchanged and explicitly "the highest levels"**,
which is why decision 4 below keeps the server round trip working rather than replacing it.

## Decisions taken — implement these, do not revisit

1. **Apply becomes tolerant of incomplete conditions instead of failing on them.** A condition with no value is
   **kept as a row and not sent to api**. Apply then means *"run what is complete, and show me the rest to
   finish"*. This is the load-bearing fix: it turns a dead end into a step, needs no new button, and produces no
   error for a state the caseworker is mid-way through. **Do not fix this by adding a fourth submit button** — a
   "Refresh" beside "Apply filters" asks the caseworker to understand the round trip.
2. **An incomplete row gets an inline hint, not an error.** Wording along the lines of *"Enter a value to use this
   condition"*, rendered as a govuk hint on the row. **It must not be a `govukErrorMessage` and must not appear in
   the error summary**, and the response must stay **200**. A caseworker halfway through building a filter has
   made no mistake. api's real refusals keep their existing 400-and-error-summary treatment.
3. **A dropped incomplete condition must be visible, because silently filtering less than asked is the worse
   failure.** The results heading states what ran. If any row was ignored, say so above the table in plain words —
   not only via the row hint, which sits below the fold once there are four conditions.
4. **JavaScript is enhancement over the round trip, never a replacement.** On changing the field or the operator,
   JS swaps in the right value control with no submit. With JS off, decision 1's behaviour is the floor and the
   feature still works. Concretely, and these are accessibility requirements rather than polish:
   - the field/kind/operator/arity metadata is emitted once as JSON for the script to read — **do not duplicate
     the operator table in client code**, and do not fetch it per keystroke;
   - the appearance of a control is announced through an `aria-live="polite"` region;
   - **focus is not stolen.** Moving focus on every `change` event drags a keyboard user out of the select they
     are still using. Focus moves only when the caseworker acts to that end.
5. **Queryability is declared on the field, and the list stays derived.** Add `queryable?: boolean` to `FieldDef`
   in `form-fields.ts`, **defaulting to queryable**, and set `queryable: false` on the 25 exclusions in the table
   below. `QUERYABLE_FIELDS` goes on deriving from `FORM_TABS`. **Do not replace the derivation with a
   hand-written list** — `query-fields.ts` argues at length why derivation is the drift guard, and it is right: a
   field added to a case tab must become queryable without a second edit. Opt-in (`queryable: true`) is the wrong
   default because a new field would silently never appear.
6. **The field chooser is grouped by tab and section using `<optgroup>`.** 43 options in one flat list is barely
   better than 68. The groups already exist in `FORM_TABS`; use their labels. This is free, needs no JavaScript,
   and is properly announced. **A type-to-filter combobox is permitted as enhancement on top, not instead of** —
   and if it is added, the grouped `<select>` remains the no-JS floor.
7. **The filter nav becomes a small purpose-built component, and no design-system dependency is added.**
   `@ministryofjustice/frontend` was considered and rejected: the only workspace precedent (`pcs-frontend`) carries
   it for `moj-multi-file-upload` and uses no MoJ navigation, and plan 11 turns this bar into variable-length
   entries with per-entry actions, which `moj-sub-navigation` does not do either. So: a `<ul>`,
   `aria-current="page"` on the current entry, `govuk-link--no-visited-state` on the rest, and about ten lines of
   `app-`-prefixed SCSS built on GOV.UK mixins. The `govuk-!-margin-right-3` overrides come out of the markup
   because spacing becomes the component's job.
8. **Build the nav to hold two groups now, even though only one exists.** Plan 11 adds saved queries to this bar,
   and five short static tabs plus N entries like *"Urgent minors awaiting signature — Ops"* in one
   undifferentiated line will look broken at any width. Give the markup a group with a label from the start.
   **Do not build the saved-query group itself here** — that is plan 11.
9. **The current entry is not a `<strong>`.** `<strong>` means strong importance, not "you are here", and it
   leaves state conveyed by boldness alone. Use `aria-current="page"` plus a visible indicator that is not only
   weight.

## Open questions — flagged, NOT answered here

- **Welsh.** Plan 08 flagged that the list page's labels are inline English in the page handler rather than keys in
  `src/locales/cy.ts`. New strings here follow that, which is consistent and still not right. Unchanged, and still
  page-wide work.
- **`newSurname` is not in the list table, and api cannot send it.** `CASE_LIST_COLUMNS` is Reference, Privacy,
  Received, Type, State, New forename, and `CaseSummary` carries exactly those six. So the list shows a forename
  and no surname. **This becomes a real problem in the api plan, not here:** the case search will match on
  `newSurname`, and the results table cannot display the field it matched on. Adding `newSurname` to `CaseSummary`
  is an api change and belongs there.
- **Empty-result wording.** Still plan 08's open question. *"No cases match this filter"* is the tab wording; a
  query that matched nothing wants different words and a way back. A content decision, not a guess.

## Constraints

- **No `prisma.*`, no migration, no JSON route.** There is no database in this repo, and this plan adds no api
  operation — everything it needs already exists.
- **`Caller` is `{ accessToken }` and nothing else.**
- **The builder logic lives in `libs/deed-poll/src/deed-poll/`, not in the page.** Which comparisons a field
  admits, and therefore which control asks for its value, is a statement about the field. The page contributes
  words and URLs.
- **Never run bare `yarn test`.** It reports `0 successful, 8 total` and `no tests` — nothing ran, so nothing
  failed. Use `yarn turbo test test:app --concurrency=1`.
- **`yarn lint` is a single `biome check .`** It exits 0 today with two pre-existing `noUndeclaredEnvVars`
  warnings and a stale `biome.json` schema notice. Do not let the count grow.
- **Do not add a `values.template.yaml`, and do not touch `charts/`.** Nothing here is a deployment change.
- **`src/deployment-chart.test.ts` and `src/pipeline.test.ts` must stay green.** Neither should be affected; if
  either breaks, something outside this plan's scope was changed.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

**Take the baseline from `master` immediately before starting** and record it in the task log. Compare **totals**,
not passed counts: the three Redis session tests skip when no cache is reachable and pass when one is, so the
skip count moves with the environment rather than with the code.

**A vitest worker startup failure is an environment failure, not a code failure — do not spend time debugging the
code when you see it.** Measured on this branch on 2026-09-16: `yarn turbo test test:app --concurrency=1` reported
`Test Files 37 passed`, `Tests 603 passed`, **`Errors 5 errors`**, and the task still exited 1. All the errors were
the same and none was an assertion:

```
Error: [vitest-pool]: Failed to start forks worker for test files .../list-sort.test.ts
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
```

22 workers failed to boot while every test that ran passed. The cause is this filesystem: the same run reported
`tests 7.61s` behind **`import 1182.70s`**. It is a resource race, so it is **flaky rather than deterministic** —
the gate will pass on one run and fail on the next.

Two consequences for running this plan:

- **Re-run before investigating** a failure whose message is about starting a worker or waiting for one.
- **Prefer running validation from a `git archive HEAD` copy under `/tmp`.** Measured elsewhere in this repo at
  19m26s in-place versus 13.8s in `/tmp` for the same build. The repo mount is the bottleneck for everything here.

**And do not trust the summary line alone.** `Tasks: 0 successful, 8 total` has now meant two different things in
this repo: once that nothing ran at all, and once — this time — that a real failure in the first workspace stopped
the other seven under `--concurrency=1`. **Read the per-workspace output, not the summary.**

Deliberately **not** here: `yarn test:e2e`. It needs Docker, a seeded IDAM simulator and a browser, and it is only
true once the plan is finished. It lives in the final task.

**For driving the app by hand while working:**

```bash
yarn mock:api          # in-memory api on :3200 — starts with NO cases
yarn mock:seed         # 32 cases across all five filter tabs
yarn idam:users        # admin@example.com / Pa55word11, in-memory, gone on restart
yarn dev:nowatch:web   # :3000 — prefer this over `yarn dev`; `turbo watch` stalls on this filesystem
```

## Tasks

### Task 1: Declare queryability on the field, and curate the list

`libs/deed-poll/src/deed-poll/form-fields.ts`: add `queryable?: boolean` to `FieldDef`, defaulting to queryable
when absent. `libs/deed-poll/src/deed-poll/query-fields.ts`: `CHOOSABLE_FIELDS` filters on it, **alongside** the
existing `DERIVED_FIELD_NAMES` exclusion rather than replacing it — those two exclusions have different reasons
(api refuses a condition on a derived field; these are merely not worth offering).

Set `queryable: false` on exactly these 25, each with a short reason comment:

| Reason | Fields |
|---|---|
| unique per case — a lookup, never a filter | `feeReference`, `refundReference`, `onlineApplicationReference` |
| internal counter, not a caseworker concept | `postCounter` |
| free prose; the queryable fact is the enum beside it | `urgencyreason`, `nationalitySectionOther` |
| narrative | `referralNotes`, `masterDirections`, `returnReason` |
| address component; town and postcode carry the signal | `applicantBuildingNoName`, `applicantAddress1`, `applicantAddress2`, `representativeBuildingNoName`, `representativeAddress1`, `representativeAddress2` |
| legal declaration checkboxes — every case has them | `iShall`, `iHaveSubscribed`, `andAlsoMyOld` |
| duplicates `ageOfMinor` at finer grain | `ageOfMinorMonths` |
| records-management and Gazette process flags | `retainPermanently`, `publishToLondonGazette` |
| formatting varies too much for `contains`; email is the reliable contact lookup | `applicantTelephone`, `representativeTelephone` |
| only useful when working by solicitor region | `representativeTownCity`, `representativePostcode` |

**Deliberately kept**, so they are not cut later by someone reading this table as a pattern: `referencenumber` and
`displayReference` (the api plan's search matches on them), `parents`, `masterName`, `representativeName`,
`representativeCompany` — filtering by solicitor firm is a real caseworker need.

- [x] `queryable` on `FieldDef` defaulting true; 25 fields marked with reasons; `CHOOSABLE_FIELDS` filters on it
      **and** still excludes the derived pair; `QUERYABLE_FIELDS` still derived from `FORM_TABS` and unchanged in
      length; a test asserts the count is 43 and that `referencenumber` survives

### Task 2: Group the field chooser

`libs/deed-poll/src/deed-poll/query-builder.ts`: the field chooser's options gain a group, labelled from the tab
and section they came from. The template renders `<optgroup>`. Order stays form order, so a caseworker meets the
fields in the order the case tabs present them.

`QueryRow.field.options` is currently a flat list, so this changes its shape — **check every consumer**, including
`buildQueryRows`'s callers and the error-summary anchor, which uses `fieldControlName(row)` and must keep working.

- [x] Field options carry a group label derived from tab + section; the template renders `<optgroup>`; the
      "Choose a case field" placeholder stays outside any group; a test asserts the grouping and that no group is
      empty

      `CHOOSABLE_FIELD_GROUPS` in `query-fields.ts` is the new derivation and `CHOOSABLE_FIELDS` is now derived
      *from it*, so the flat list and the grouped one cannot disagree. Eleven groups, labelled `Tab: Section`
      except where a tab holds one section named after it — *"Signature: Signature"* says nothing twice. A
      section whose every field was curated out contributes no group. `QueryRow.field` changed shape from
      `QuerySelect` to `QueryFieldSelect` (`{ name, placeholder, groups }`); the only consumers were
      `index.njk` and the tests' own helper, and `fieldControlName` is untouched, so the error-summary anchor
      still resolves. The field chooser is hand-written markup in the template because `govukSelect` cannot
      render an `<optgroup>` — it keeps the component's classes, its visually-hidden label and its
      `aria-describedby`. Validation after the task: `yarn lint` exit 0 with the two pre-existing warnings,
      `yarn turbo test test:app --concurrency=1` 8 of 8 with 1656 tests (3 skipped, no Redis) and no worker
      failures, `yarn build` green.

### Task 3: Make the value control reachable — the server behaviour

This is the fix. `src/pages/deed-polls/index.ts` and `libs/deed-poll/src/deed-poll/query-builder.ts`.

A condition whose operator takes one or two values, and which has none, is **incomplete**. On Apply:

- incomplete conditions are **excluded from the `findDeedPolls` call**;
- they are **kept in the rendered rows** and in the URL, so the field and operator survive and the value control
  appears;
- the response is **200** with a **hint** on the row (decision 2), not a 400 with an error;
- if any condition was excluded, the page **says so above the table** (decision 3).

`isEmpty` and `isNotEmpty` take no value and are **never** incomplete — do not let an arity-0 operator fall into
this branch. `between` needs **both** slots; one of two is incomplete.

The existing api-refusal path is untouched: a condition api rejects still renders its message against its row with
a 400.

- [x] Incomplete conditions excluded from the api call, kept as rows, 200 with a hint and a statement above the
      table; arity-0 operators never incomplete; `between` incomplete with one of two values; api's own refusals
      still 400 with the error summary; a test for each of those five

      **The exclusion was already there, and was not the fault.** `findDeedPolls` filters through
      `caseQueryWhere`, so `where=type:is:` never reached api and the response was already 200 — traced
      again on 2026-09-17 and pinned by a new `service.test.ts` case for the exact scenario the plan
      records. So the plan's traced 400 does not reproduce on this branch, and what was actually missing
      was decisions 2 and 3: the page dropped the condition **silently**, which is the failure decision 3
      calls the worse one. The exclusion deliberately stays inside `findDeedPolls` rather than moving up
      to the page — pre-filtering before the call would renumber the conditions and break
      `rowForSentCondition`, which is how api's `where.0` finds the row a caseworker sees.

      New: `valueHint` in `query-builder.ts` puts `QueryRow.hint` on a row whose comparison is chosen and
      whose value is not given (`enterValue`, or `enterBothValues` for `between`), and
      `unusedConditionRows` names the rows the query ran without. Neither is an error: the hint is a
      `govuk-hint` announced through the row's field chooser via `aria-describedby`, there is no
      `govuk-form-group--error` and no error-summary entry, and the status stays 200. `isEmpty`/
      `isNotEmpty` are complete without a value and get neither; `isOneOf` is satisfied by one ticked box;
      `between` with one of two gets both. A row api refused gets its refusal and **not** a hint, and is
      left out of the statement — one unfinished row reading as two problems is worse than either.
      The statement is `govukInsetText` immediately above the table, from `unusedConditionsFor` in the
      page's content (*"Condition 2 was not used, because it is not complete."*, pluralising to
      *"Conditions 1, 2 and 3 were not used…"*). Validation after the task: `yarn lint` exit 0 with the two
      pre-existing warnings, `yarn turbo test test:app --concurrency=1` 8 of 8 with 1682 tests (3 skipped,
      no Redis) up from 1656, no worker failures, `yarn build` green.

### Task 4: Make the value control reachable — the JavaScript enhancement

`src/assets/`: on changing the field or the operator, swap in the right value control without a submit.

Read decision 4 before starting — it is mostly accessibility constraints. The metadata goes out once as JSON from
the existing domain functions; **do not restate the operator table or the arity table in client code**, because
two copies is exactly the drift `query-fields.ts` was written to prevent.

**With JavaScript disabled, task 3's behaviour must be unchanged.** Verify that by testing with scripts off, not
by reasoning about it.

- [x] Control swaps on field/operator change with no submit; metadata emitted once from the domain, not restated;
      `aria-live="polite"` announces the change; focus is not moved on `change`; behaviour with JS disabled is
      identical to task 3; a test with scripts off

      `queryBuilderMetadata` in `query-builder.ts` is the single emission: per operator its label and arity
      (from `OPERATOR_LABELS` and `valueArity`), per kind the operators it admits and the control each arity
      asks with (from `operatorsFor` and `valueControl`), and per field its kind and option-set members. It
      is keyed by **`QUERYABLE_FIELDS`, not the choosable list**, because a hand-edited URL can name a
      curated-out field and the row it renders has to keep working. `valueControl` now takes a `FieldKind`
      rather than a `FieldDef` — that is all it ever read, and the metadata asks it about a kind with no
      field in hand. The page serialises it once into a `<script type="application/json">` data block,
      escaping `<` and nothing else: a script element's contents are raw text, so the JSON cannot be
      HTML-escaped, and `<` is the one sequence that could close the element early.

      **No control name is composed in the browser.** `QueryRow.valueName` became `valueNames: [string,
      string]` — both slots, whatever the operator takes — and the row carries them as
      `data-value-name`/`data-upper-value-name` for the script to read, so `valueControlName` stays the only
      place that knows the format. The row also carries `data-condition-number`, since one live region serves
      every row and the announcements name the condition through a `{n}` placeholder.

      `src/assets/js/query-builder.ts` is the enhancement, imported by `index.ts` rather than loaded as a
      `<script>` of its own: `createAssetHelpers` names a nunjucks global after the entry file and
      `query-builder_js` is not an identifier a template can read. It rebuilds the **operator** chooser too,
      not only the value control — the comparisons are the kind's, and leaving a text field's list beside a
      date would offer comparisons the server drops on submit. A comparison the new kind also admits is kept.
      A control is rebuilt only when its *shape* changes (control, arity, and the field whose members it
      lists), so switching `contains` for `is` keeps a value already typed. The row's hint is managed with
      it, because the alternative is a lie: choosing `is empty` under a rendered *"Enter a value…"* would
      leave a row that needs no value being asked for one. A refusal from api is left alone, as the server
      leaves it.

      **Driven in a real browser, not reasoned about.** Two new journeys in `deed-polls.spec.ts`: one with
      scripts on covering the swap, the rebuilt operator list, the checkbox set, both bounds of a `between`,
      the announcements, the preserved value and **focus not moving onto what appeared**; one in a
      `test.describe` using `test.use({ javaScriptEnabled: false })` covering task 3's floor unchanged —
      field, apply, comparison, apply, value control visible with a hint, no error summary, a reloaded 200,
      the unused-condition statement, then the value and the right rows. No axe check in the scripts-off one:
      `AxeBuilder` injects a script to run.

      Validation after the task: `yarn lint` exit 0 with the two pre-existing warnings, `yarn turbo test
      test:app --concurrency=1` 8 of 8 with 1696 tests (up from 1682; 0 skipped here because Redis was up)
      and no worker failures, `yarn build` green, and `yarn test:e2e --workers=1` 26 passed — the whole
      Playwright suite, since the change touches the list template every list page renders. That run needed
      `yarn playwright install chromium` first: the cached browser was build 1228 and `@playwright/test`
      1.63.0 wants 1243.

### Task 5: The filter nav component

`src/pages/deed-polls/index.njk` and a new `app-`-prefixed SCSS partial. Decisions 7, 8 and 9.

Replace the bare `<nav>` with a `<ul>`, `aria-current="page"` on the current entry, `govuk-link--no-visited-state`
on the others, and a group wrapper with a label ready for plan 11's second group. Spacing moves from
`govuk-!-margin-right-3` in the markup into the component's SCSS, using GOV.UK mixins rather than raw values.

The current entry must be distinguishable by something other than font weight.

- [x] `<nav>` wraps a `<ul>`; `aria-current="page"` not `="true"`; no `<strong>`; `no-visited-state` on links;
      no `govuk-!-margin-*` left in the nav markup; group wrapper with a label present; current entry
      distinguishable without relying on weight; the existing nav tests still assert tab hrefs carry conditions
      and sort

      `app-filter-nav` is the component: `src/assets/css/components/_filter-nav.scss`, 30 lines of rules,
      `@use`d from `index.scss`. **The partial is under `components/` and not beside `index.scss`** because
      `vite.build.ts` globs `css/*.scss` into build entries, so a sibling partial would become a stylesheet
      of its own — the build still emits exactly `index_css` and `footer_css`. It `@use`s
      `govuk-frontend/dist/govuk/base`, not `index`, so it gets the settings, tools and helpers without
      re-emitting the framework, and it reads colours through `govuk-functional-colour(brand)` /
      `(secondary-text)` rather than `$govuk-brand-colour` — the variables are deprecated in
      govuk-frontend 6.
      Markup: `<nav class="app-filter-nav" aria-label="Filter by status">` → one
      `app-filter-nav__group` carrying an `<h2>` label (`filterGroupLabel`, "Status", new in `en`) → a `<ul>`
      of five `<li>`. The current entry is a `<span aria-current="page">` and the other four are
      `govuk-link govuk-link--no-visited-state`, so a tab already visited does not read as progress through
      them. Spacing is `govuk-spacing(3)` on the item and `govuk-responsive-margin(6, "bottom")` on the nav,
      which is what let the two `govuk-!-margin-right-3` and the `govuk-!-margin-bottom-6` come out of the
      markup. The current entry's indicator is a 4px bottom border in the brand colour; the bold weight
      repeats it rather than carrying it.
      The group wrapper exists with one group in it deliberately (decision 8) and has the
      `+ .app-filter-nav__group` spacing rule plan 11 will need; the saved-query group itself is not built
      here.
      Six new template tests in `index.njk.test.ts` under *the filter bar*, asserting against the nav
      extracted from the page rather than the whole markup — the list and its five items, `aria-current="page"`
      exactly once with no `<strong>` and no `aria-current="true"`, four no-visited-state links, no `govuk-!-`
      anywhere in the nav, the labelled group. The last reads the SCSS partial and pins
      `border-bottom: 4px solid` on `.app-filter-nav__current`, because "distinguishable by something other
      than weight" is a statement about how it is drawn and the only other place to make it is a screenshot.
      The model-level nav tests in `index.test.ts` are untouched and still pin that every tab href carries the
      conditions and the sort.
      Validation after the task: `yarn lint` exit 0 with the two pre-existing warnings, `yarn turbo test
      test:app --concurrency=1` 8 of 8 with 1702 tests (up from 1696; 0 skipped, Redis up), no worker
      failures, `yarn build` green with `app-filter-nav__current` in the emitted stylesheet.

### Task 6: Tests and a driven check

Unit tests are in the tasks above. This task is the suite and the browser.

`e2e-tests/`: extend the query journey to cover the sequence that was broken — choose a field, choose a
comparison, **see the value control without an error**, enter a value, apply, get the right rows. That journey is
the regression guard for the whole plan; without it the fault can return silently.

`yarn mock:seed` gives 32 cases across all five tabs. Pre-warm **both** the app and the mock on :3200 before
running e2e — readiness stays 503 until the mock answers, and the resulting failure reads as a test-isolation
problem rather than a missing dependency.

- [x] e2e journey covering field → comparison → value control with no error → value → apply → correct rows;
      an axe check on the builder with a value control revealed by JS; `yarn test:e2e --workers=1` green

      The journey is **two** journeys, because the sequence that was broken has two floors and the plan
      requires both: the scripts-off one added in task 4 is the regression guard for the fault as traced
      (field, apply, comparison, apply, value control with a hint and no error summary, a reloaded 200, the
      unused-condition statement, then the value and the two rows it matches), and the scripts-on one is the
      same sequence with no submit until the end. Extended here rather than added to, per
      `.claude/rules/e2e-testing.md` — one test per journey, with the accessibility checks inline.

      Two things were missing and are now there. The scripts-on journey **seeds cases and ends on rows**
      (`1 to 2 of 2 applications`, two `tbody` rows, no `govuk-inset-text`) instead of stopping at the
      canonical URL: a journey that asserts only the query string still passes when the query it built
      matches nothing, which is most of what "correct rows" is guarding. And it carries **two axe checks on
      markup the script built**, which is the point of having them here as well as in the round-trip journey
      — a control assembled in the browser has no template to carry its label, its `aria-describedby` or its
      fieldset legend, so a JS-built control is exactly where an accessible name goes missing. The first is
      on the revealed single value control with its hint and live-region announcement; the second is on the
      two `govukDateInput` fieldsets of a `between`, the most structured thing the script builds. Both clean.
      `seedCasesToFilter` now serves both journeys, each with a forename of its own so the four cases never
      meet.

      Validation after the task: `yarn lint` exit 0 with the two pre-existing warnings, `yarn turbo test
      test:app --concurrency=1` 8 of 8 with 1702 tests (0 skipped, Redis up) and no worker failures, `yarn
      build` green, and `yarn test:e2e --workers=1` **26 passed in 1.5m**. Both servers were pre-warmed
      before the browser started and `readiness` confirmed `{"redis":"UP","deedPollApi":"UP"}` — a 503 there
      reads as test isolation rather than a missing dependency, which is the trap the task text names.

### Task 7: Full validation

- [x] `yarn lint` exit 0 with no new warnings; `yarn turbo test test:app --concurrency=1` green with the total up
      from the recorded baseline and 8 of 8 tasks; `yarn build` green; `yarn test:e2e --workers=1` green; the
      counts recorded in the task log next to the baseline

      **The baseline was measured here, not at the start.** Task 1 deferred it (its log says so), so there was
      no number to compare against — it was taken now from a `git worktree` of `master` (`d86fff2`) under
      `/tmp`, installed and run in the same session with the same Redis up, which is the only way the skip
      count is comparable. Master and this branch report the **same 109 test files** because every test added
      by this plan went into a file that already existed; the plan's guidance to compare totals rather than
      passed counts is why that is not a warning sign.

      | | master (`d86fff2`) | `case-query-fixes` (`c3c2594`) |
      |---|---|---|
      | tasks | 8 of 8 | 8 of 8 |
      | test files | 109 | 109 |
      | tests | **1639** passed, 0 skipped | **1702** passed, 0 skipped (**+63**) |
      | worker-startup errors | 0 | 0 |

      Per workspace on the branch: app 488, `@hmcts/deed-poll` 684, `deed-poll-api-client` 192,
      `cloud-native-platform` 140, `express-govuk-starter` 127, `simple-router` 41,
      `express-session-postgres` 23, `express-session-redis` 7. The growth is all in the two workspaces this
      plan touched — app 465 → 488 and `deed-poll` 644 → 684 — and the other six are unchanged, which is the
      check that nothing outside the plan's scope moved. `deployment-chart.test.ts` and `pipeline.test.ts` are
      inside the app's 488 and green.

      `yarn lint` exit 0, the two pre-existing `noUndeclaredEnvVars` warnings (`src/server.ts` `PORT`,
      `src/session-store.test.ts` `REDIS_URL`) and the two infos, over 288 files — the count did not grow.
      `yarn build` 8 of 8 **uncached** (`--force`, 13.1s) with `app-filter-nav__current` present in the
      emitted `index_css` and `query-builder_js` emitted at 4.27 kB. `yarn test:e2e --workers=1` **26 passed
      in 1.5m** with both servers pre-warmed and `readiness` reporting `{"redis":"UP","deedPollApi":"UP"}`
      before the browser started, the mock seeded with 32 cases; the two journeys this plan added — the
      scripts-on swap and the scripts-off floor — are numbers 21 and 22 in that run. **No worker-startup
      flake in any run**, so the environment failure the plan warns about did not appear this time and no
      re-run was needed.

## Deliberately not in this plan

- **Saved and shared queries.** Plan 11, and api's `saved-queries-and-search.md` before it. They need per-user
  persistence this repo cannot have.
- **Case search by reference or name.** Same — the matching is api's.
- **Adding `newSurname` to the list table.** Needs `CaseSummary` to carry it. api's plan.
- **A "modified — save or reset?" indicator on a departed-from saved query.** Deliberately out of v1; revisit when
  saved queries exist and it is clear whether anyone misses it.
- **`@ministryofjustice/frontend`.** Decision 7 rejects it on the evidence available; revisit if plan 11 finds
  several components that want it.
- **Welsh translation of the new strings.** Follows the page's existing pattern; fixing it is page-wide.
