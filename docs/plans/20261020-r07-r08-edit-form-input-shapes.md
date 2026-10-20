# Plan: keep "not answered" and refuse malformed input on the case edit form

## Overview

Address review findings **R07 (Lower)** and **R08 (Lower)** from the repeat quality and security review
(workspace `local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`). They follow R01/R02
(`docs/plans/completed/20261020-r01-r02-edit-form-untouched-fields.md`, admin#220) in the same parser:

- **R07:** "In person" (`inPerson`) is nullable in api's contract but rendered as a single checkbox. An unticked box
  and an unanswered question both arrive as absent, and `buildUpdatePatch` reads an absent boolean as `false`. So
  any save of the Application tab turns a stored `null` into "No", even when the caseworker changed only another
  field.
- **R08:** E04 made a number that is not one plain string an error. The other kinds still coerce what numbers
  refuse: a bracketed or repeated text field becomes a clear or its first value, bracketed date parts become a clear
  with no error, a boolean of anything but `"true"`/`"on"` becomes `false`, and multiselect values go through a
  bare `Number()` with no option-set check (`["1e0","0x2"," 3 ","","99"]` becomes `[1,2,3,0,99]`, `"abc"` becomes
  `[]`, `["1","2.5"]` becomes `[1]`).

Make an unanswered "In person" survive a save, and apply one rule to every field kind: a value the rendered form
could not have sent is a field error and no write.

## Context

This branch starts from admin#220's branch (`fix/r01-r02-edit-form-untouched-fields`, `ddd1a79`), because it changes
the same code. Its PR must not be opened until #220 has merged; then merge `origin/master` in and re-validate.

Read `CLAUDE.md` (especially "Numeric case-form input" and "Case edit form saves") and the applicable
`.claude/rules/` before implementation. Record the execution baseline and recheck both findings there.

### R07

- `libs/deed-poll-api-client/openapi.json`: `UpdateCaseRequest` and `CreateCaseRequest` type `inPerson` as
  `["boolean", "null"]`; `retainPermanently` and `publishToLondonGazette` are plain `boolean`. Recheck. Only a
  nullable boolean needs a third state; the other two stay checkboxes.
- `libs/deed-poll/src/deed-poll/form-fields.ts` declares `inPerson` as `kind: "boolean"`; `edit.njk` renders every
  boolean as one checkbox; `form-payload.ts` reads an absent boolean as `false` (`isTicked`, in
  `checkbox-input.ts`).
- `getFieldRules` makes `inPerson` required for Adult, Minor and Relinquishment types. Admin's
  `validateCaseForSubmit` is never called on the edit path; do not start enforcing "required" here (api owns that).
- Check whether the new-case form (`src/pages/deed-polls/new.ts` and its template) also renders `inPerson`, and
  handle it the same way if so.
- Check how the case detail view and any list or query formatting render `inPerson` (Yes / No / blank), and keep
  them consistent with the new control.

### R08

- `libs/deed-poll/src/deed-poll/form-payload.ts` `str()` takes an array's first element and turns anything that is
  not a string into `""`; `form-validation.ts` has its own `str()` doing the same for date parts, and
  `collectDateErrors` reads all-blank parts as a clear.
- `checkbox-input.ts` `tickedValues()` is used for both stored values (numbers) and submitted values (strings).
  Stored values must keep being read as they are; only *submitted* values need the strict rule.
- `readNumericInput` (`numeric-input.ts`) is the model: absent, blank, valid, invalid, with `invalid` refused before
  any write by `collectFormErrors` and again by `buildUpdatePatch`.
- What the rendered form can send, per kind: a text, textarea or select sends one string; a date sends three
  strings (`-day`, `-month`, `-year`); a boolean checkbox sends the string `"true"` when ticked and nothing when not
  (`"on"` is a browser's default for a checkbox without a value; keep accepting it); a multiselect sends zero or
  more strings, each an option value from the field's option set (`enumOptions`). Anything else did not come from
  this form.

Review evidence (portable reproductions to adapt into real tests; do not import workspace files):
`local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-forms.probe.test.ts` ("defect A3" is R07,
"defect A4" is R08) and `arbor-review-forms-lib.probe.test.ts` ("defect C1", "defect C2").

## Development Approach

1. **R07: render a nullable boolean as Yes / No radios**, with neither selected when the stored value is `null`.
   Yes sends `true`, No sends `false`, and nothing selected is absent, which (by R02's rule) leaves the stored value
   alone. Give it its own field kind or a flag on the `FieldDef` (for example `nullable: true` on a boolean), driven
   by the contract, and pin it to `openapi.json` in `form-fields.test.ts` as the numeric format already is. Use the
   existing GOV.UK radios pattern, the existing "Yes"/"No" content if the app already has it (en and cy), and the
   same redraw-after-error behaviour as R01 (checked state computed in the view model).
2. **R08: one input rule for every kind.** A submitted value that is not one string (an array or object) is
   invalid for text, textarea, select, each date part and a boolean. A boolean's one string must be `"true"` or
   `"on"`. Each multiselect member must be a string exactly equal to one of the field's option values; any other
   member (including `""`, whitespace, exponents, hex, decimals and values outside the option set) is invalid. An
   empty multiselect (nothing ticked) still clears. Surrounding whitespace on text stays trimmed as today.
3. **Refuse before any write**, as numbers do: add the new checks to `collectFormErrors` (in field order, alongside
   dates and numbers), render GOV.UK field errors, redraw the submitted values, and make `buildUpdatePatch` throw
   `InvalidInputError` on the same inputs so a caller that skips validation still gets no patch. Use one parser per
   kind shared by validation and the patch builder, so they cannot drift.
4. **Messages** are English-only domain strings in `form-validation.ts`, like the date-part and numeric messages,
   and must not add to `yarn welsh:check`. Word them for the caseworker ("Select an option from the list", "Enter
   a single value"), never naming the input shape.
5. **Out of scope:** every other review finding; any new business rule or required-field enforcement; changing
   `retainPermanently` or `publishToLondonGazette`; api or schema changes. No new dependency.
6. Work test first: each task starts with a test that fails on the current code for the reason in the finding, then
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
`yarn welsh:check` exits 1 by design; run it before and after, and confirm its counts change only by any new
caseworker-facing strings.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

For the red/green cycle, shell-quote bracketed paths:

```bash
yarn vitest run 'src/pages/deed-polls/[id]/edit/[tab].test.ts' src/case-edit-untouched-fields.test.ts
(cd libs/deed-poll && yarn vitest run src/deed-poll/form-payload.test.ts src/deed-poll/form-validation.test.ts src/deed-poll/edit-view.test.ts)
```

## Implementation Steps

### Task 1: Keep an unanswered "In person" through a save (R07)

**Files:** `libs/deed-poll/src/deed-poll/form-fields.ts` and its test, `form-payload.ts`, `edit-view.ts`,
`src/pages/deed-polls/edit.njk`, their tests, and the new-case form if it renders `inPerson`.

- [x] Record the execution baseline (commit, validation results, `welsh:check` counts) in the execution notes.
- [x] Add failing tests: with `inPerson: null` stored, an Application save that changes only `feeReference` sends no
      `inPerson` key; choosing Yes sends `true` and No sends `false`; a stored `true` or `false` renders with that
      radio selected; after a refused save the submitted choice (or no choice) is redrawn; `form-fields.test.ts`
      pins which booleans are nullable to `openapi.json`.
- [x] Implement, then run focused tests and all Validation Commands, and record the results.

### Task 2: Refuse input the form could not have sent (R08)

**Files:** `libs/deed-poll/src/deed-poll/form-payload.ts`, `form-validation.ts`, `checkbox-input.ts`, their tests,
and a handler-level test through the real edit handler.

- [ ] Add failing tests, through `collectFormErrors`, `buildUpdatePatch` and the real handler: an array or object
      in a text, select, date part or boolean control is a field error with no write; a boolean of `"TRUE"` or
      `["true"]` is an error; multiselect members `"1e0"`, `"0x2"`, `" 3 "`, `""`, `"2.5"`, `"abc"` and an
      out-of-set value are errors; an empty selection still clears; every valid value the rendered form sends still
      saves exactly as today.
- [ ] Implement with one parser per kind shared by validation and patch construction. Stored values keep being read
      as before. Run focused tests and all Validation Commands, and record the results.

### Task 3: Record the rules and hand off

**Files:** `CLAUDE.md`, this plan.

- [ ] Extend the "Case edit form saves" section in `CLAUDE.md`: nullable booleans as radios and why, and the one
      input rule per kind (what each kind may send, and that anything else is refused before any write). Reference
      this plan and findings R07/R08.
- [ ] In the same section, correct the R01/R02 plan reference to `docs/plans/completed/20261020-r01-r02-edit-form-untouched-fields.md`
      (it still names `docs/plans/`, where the plan no longer is).
- [ ] Record final commits, changed files, test counts and `welsh:check` counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- An unanswered "In person" stays unanswered through any save that does not choose Yes or No; Yes and No save
  `true` and `false`; the choice redraws correctly after a refused save.
- `retainPermanently` and `publishToLondonGazette` behave exactly as today.
- An array, object or out-of-set value in any control produces a field error and no api write, for every kind.
- Every value the rendered form can send still saves as it does today, and an empty multiselect still clears.
- Validation and patch construction share one parser per kind.
- All Validation Commands pass with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence and final results here.)

### Baseline (Task 1, 2026-10-20)

- Commit `eec41ea` on `fix/r07-r08-edit-form-input-shapes`. `yarn lint` clean (one Biome config-migration info,
  pre-existing); `yarn build` 8/8; `yarn turbo test test:app --concurrency=1 --force` 8/8 tasks, 4979 tests, 0
  failures, 0 skips (app 2463, deed-poll 1314, api-client 847, cloud-native-platform 157, express-govuk-starter 127,
  simple-router 41, express-session-postgres 23, express-session-redis 7). `yarn welsh:check`: 727 strings, 510
  identical in cy (503 prose, 7 not prose).
- Rechecked R07: `openapi.json` types `inPerson` as `["boolean", "null"]` on both `UpdateCaseRequest` and
  `CreateCaseRequest`; `retainPermanently`, `publishToLondonGazette` and `migratedRecord` are plain `boolean`.
  `publishToLondonGazette` sits on the retired referral tab, so it is not in `EDITABLE_FIELDS`; the only editable
  booleans are `inPerson` and `retainPermanently`. The new-case form asks only type, names and date received, so it
  does not render `inPerson`. `formatValue` already shows `null` as not provided and `true`/`false` as Yes/No, and
  the query builder's boolean radios are unaffected.

### Task 1 (R07)

- Red: 9 lib tests (contract pin, omitted absent answer, view-model `answer`) and 5 handler tests in
  `src/case-edit-untouched-fields.test.ts` (no `inPerson` key on a fee-reference-only save, radios rendered and
  selected per stored value, a submitted No redrawn) failed on the old code.
- Green: `nullable: true` on `inPerson` (pinned to the contract in `form-fields.test.ts`), `yesNoAnswer` in
  `checkbox-input.ts` shared by `buildUpdatePatch` and `buildEditView` (`answer` on `EditField`), inline Yes / No
  radios in `edit.njk`, and `yes`/`no` on the edit page's `en`. Tests that used `inPerson` as the checkbox example
  now use `retainPermanently`; the harness's `serialise()` skips unselected radios.
- Validation: lint clean, build 8/8, 4999 tests passed (app 2472, deed-poll 1325, others unchanged), 0 failures, 0
  skips. `welsh:check` 729 / 512 identical: the two new strings `yes` and `no` (the page's `cy` spreads `en`).

## Post-Completion

Do not open a PR until admin#220 has merged; then merge `origin/master` into this branch and re-validate.
Publishing, merging and deployment are separate from this plan.
