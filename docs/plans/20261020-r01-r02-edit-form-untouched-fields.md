# Plan: a case edit save must not clear fields the caseworker did not touch

## Overview

Address review findings **R01 (Medium)** and **R02 (Medium)** from the repeat quality and security review
(workspace `local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`). Both make a save on the case
edit form clear stored values the caseworker never touched:

- **R01:** after any refused save (a date or number error, or api's own 400), the redrawn form shows ticked
  checkboxes unticked, so the corrected resubmit sends `false` and `[]` for them.
- **R02:** a field the type's rules hide is never rendered, so it is absent from the body, and the patch builder
  turns an absent text, select or date field into `null`. Saving a Deed of Relinquishment's Application tab clears
  seven stored fields.

Fix both so that an unchanged save writes back exactly what is stored, and a refused save redraws exactly what was
submitted.

## Context

Reviewed baseline: `23d3186` on admin `origin/master`; this branch starts from `cb91197` (master after #216).
Read `CLAUDE.md` (especially "Numeric case-form input") and the applicable `.claude/rules/` before implementation.
Record the execution baseline and recheck both findings there before changing anything.

### R01

- `src/pages/deed-polls/edit.njk:76` renders a boolean as `checked: (f.value == true)`, and `:81` a multiselect
  option as `checked: (o.value | int) in (f.value or [])`.
- `libs/deed-poll/src/deed-poll/edit-view.ts` `decorate()` sets `value` from the stored record on a normal render
  (booleans are `true`/`false`, multiselects arrays of numbers) but from the submitted body on a replay (the strings
  `"true"`/`"on"`, and a string or array of strings).
- So on a replay `"true" == true` is false and every ticked boolean renders unticked. `["1","4"]` does not contain
  the number 1, so a multiselect with two or more ticks renders all unticked. A single tick survives only because
  Nunjucks' `in` on a string coerces (`"4".indexOf(4)`).
- `decorate()` also replays a **locked** field (a non-admin's privacy select, rendered `disabled`) from the body,
  which a disabled control is never part of, so it redraws blank. Nothing is written for it (privacy is
  `notNullable`), but the caseworker sees a wrong value.
- The fields involved today: booleans `inPerson`, `retainPermanently`, `publishToLondonGazette`; multiselects
  `iShall`, `iHaveSubscribed`, `andAlsoMyOld` (`libs/deed-poll/src/deed-poll/form-fields.ts`). Recheck the list.

### R02

- `edit.njk:46` renders nothing for a field whose `rule.visible` is false.
- `libs/deed-poll/src/deed-poll/deed-poll-validation.ts` `getFieldRules` hides, for a Deed of Relinquishment,
  `oldForename`, `oldMiddleName`, `oldSurname`, `maritalStatus`, `nationality`, `nationalitySection`,
  `nationalitySectionOther`, `dateNoticeSentToLondonGazette` and the minor-only fields; for Adult types the
  minor-only fields (`minorDateOfBirth`, `ageOfMinor`, `ageOfMinorMonths`, `parents`); and for any type with
  Publish to London Gazette = No, `dateNoticeSentToLondonGazette`.
- `libs/deed-poll/src/deed-poll/form-payload.ts` `buildUpdatePatch` already omits an **absent** number (E04), but
  turns an absent text or enum field into `null`, and an absent date into `null` via `composeDateParts`.
- The POST handler `src/pages/deed-polls/[id]/edit/[tab].ts` reads no case before saving (by design: api owns the
  write), so it does not know which rules applied when the page was rendered.

**Why "absent means omit" is sound for text, enum and date:** a rendered text input, textarea or select always
submits its value, even an empty string, and a rendered date always submits its three parts. So an absent text,
enum or date field was not rendered: hidden by its rule, disabled, or not on this tab. A deliberate clear arrives
as a present empty string and must still clear. Checkboxes are different: an unticked checkbox is also absent, so
"absent means omit" must **not** be applied to booleans or multiselects. Today no boolean or multiselect field is
ever hidden by `getFieldRules`. Pin that with a test, so a future rule that hides one fails loudly rather than
silently clearing it.

**Do not lose the deliberate clears.** Admin currently nulls a hidden Gazette notice date and hidden minor-only
fields only *by accident* of this defect: `applyGazetteGate` and `applyMinorGate` exist in
`deed-poll-validation.ts`, but check whether anything on the edit write path calls them. The repeat review read
api's own gates (`DeedPollService.java` around lines 410-415 on api `origin/master` `554fe49`), which clear the
minor-only fields and the Gazette notice date on write. **Verify that in the api clone's `origin/master` before
relying on it** (read only, from the `deed-poll-api` clone's `origin/master` ref; do not switch its branch or
edit it), and record what you found in the execution notes. If api does not clear something that admin was
clearing, apply that clear explicitly and intentionally here (for example, by calling the existing gate function),
never through absent-means-null.

Review evidence (portable reproductions to adapt into real tests; do not import workspace files):
`local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-forms.probe.test.ts`, groups "defect A1"
(R01) and "defect A2" (R02). They show how to read a rendered page back as the form a browser would submit
(enabled controls only, ticked boxes only, each select's selected option).

## Development Approach

1. **R01: compute checked state in the view model, not the template.** Give each boolean field a `checked`
   boolean and each multiselect option a `checked` boolean, derived from either source: stored `true`, or
   submitted `"true"`/`"on"`, for a boolean; stored numbers or submitted strings, compared as the same type, for a
   multiselect. The template reads those flags and stops comparing raw values. Keep the replay of other kinds
   exactly as it is (submitted text is redrawn as typed).
2. **R01: a locked field redraws from the stored record**, never from the body, because a disabled control is
   never submitted.
3. **R02: in `buildUpdatePatch`, an absent text, textarea, enum or date field is omitted from the patch**, the way
   an absent number already is. A present empty value still produces `null` (or is refused for a `notNullable`
   field, as today). Booleans and multiselects keep their current absent handling.
4. **R02: add a guard test** that no boolean or multiselect field is ever hidden by `getFieldRules`, for every
   type and every combination of migrated and publish-to-Gazette.
5. **Keep the existing deliberate clears**, as described in Context. Do not invent new clears or new business
   rules. api remains authoritative for permissions and validation.
6. **Out of scope:** R07 (a stored null "In person" becoming false), R08 (malformed array/object/bracketed input),
   and every other review finding. Do not change booleans to radios, and do not change the parser for malformed
   shapes. No new dependency, no api or schema change, no UI copy change.
7. Work test first: each task starts with a test that fails on the current code for the reason in the finding, then
   the fix. Preserve others' changes. Local task commits are appropriate; publishing, merging and deployment are
   separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips; distinguish baseline failures from regressions, and inspect formatting diffs for unrelated changes.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

For the red/green cycle, shell-quote bracketed paths:

```bash
yarn vitest run 'src/pages/deed-polls/[id]/edit/[tab].test.ts'
(cd libs/deed-poll && yarn vitest run src/deed-poll/edit-view.test.ts src/deed-poll/form-payload.test.ts)
```

## Implementation Steps

### Task 1: Redraw ticked boxes and locked fields correctly after a refused save (R01)

**Files:** `libs/deed-poll/src/deed-poll/edit-view.ts` and its test, `src/pages/deed-polls/edit.njk`, and a
handler-level test beside `src/pages/deed-polls/[id]/edit/[tab].test.ts` (or an `edit.njk` template test following
`.claude/rules/testing.md`'s template test pattern).

- [ ] Record the execution baseline (commit, validation results) in the execution notes.
- [ ] Add failing tests: a replayed body with `inPerson=true`, `retainPermanently=true` and two or more ticks in
      each multiselect renders them all checked; one tick and no ticks also render correctly; the stored
      (non-replay) render is unchanged; a non-admin's locked privacy select redraws the stored value on a replay.
- [ ] Add a failing end-to-end test through the real handler and real `edit.njk`: load an Application tab with both
      booleans true and multi-ticked declarations, submit it with one bad date, read the 400 page back as the form a
      browser would submit, fix the date, resubmit, and assert the patch keeps every boolean and multiselect value.
- [ ] Implement the view-model flags and switch the template to them. Run focused tests, then all Validation
      Commands, and record the results.

### Task 2: Leave fields the form never rendered out of the patch (R02)

**Files:** `libs/deed-poll/src/deed-poll/form-payload.ts` and its test, `deed-poll-validation.ts`'s test (for the
guard), and a handler-level test.

- [ ] Verify api's minor and Gazette clears on write in the api clone's `origin/master` (read only), and record
      the file, line and behaviour in the execution notes. Check whether admin calls `applyGazetteGate` or
      `applyMinorGate` anywhere on the edit write path.
- [ ] Add failing tests: an absent text, textarea, enum or date field is omitted from the patch; a present empty
      value still clears (or is refused for `notNullable`); booleans and multiselects are unchanged.
- [ ] Add a failing handler-level test: an unchanged save of a Deed of Relinquishment's Application tab, as
      rendered, produces no key for any of the seven hidden fields; the same for an Adult case's minor-only fields.
- [ ] Add the guard test that no boolean or multiselect field is hidden by `getFieldRules` in any combination.
- [ ] Implement. If Task 2's first step found a clear api does not perform, keep it explicitly and test it.
      Run focused tests, then all Validation Commands, and record the results.

### Task 3: Record the rule and hand off

**Files:** `CLAUDE.md`, this plan.

- [ ] Add a short "Case edit form saves" section to `CLAUDE.md`, next to "Numeric case-form input": what "absent"
      means for each field kind, why absent text/enum/date is omitted and absent checkboxes are not, the guard test,
      where checked state is computed, and that a locked field redraws from the stored record. Reference this plan
      and findings R01/R02.
- [ ] Record final commits, changed files, test counts and the api verification in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- A refused save followed by a resubmission that changes only the corrected field produces a patch equal to the
  stored value for every boolean and multiselect on the tab.
- A non-admin's locked privacy select redraws its stored value after a refused save.
- An unchanged save of any tab writes no key for a field its rules hid, for every case type.
- A present empty text, select or date still clears a nullable field; `notNullable` fields behave as today.
- The minor and Gazette clears still happen, by api or by an explicit admin call, never by absent-means-null.
- A test fails if a future rule hides a boolean or multiselect field.
- All Validation Commands pass with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence, the api verification and final results here.)

## Post-Completion

Publishing, merging and deployment are separate from this plan.
