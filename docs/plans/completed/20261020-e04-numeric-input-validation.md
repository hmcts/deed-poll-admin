# Plan: reject invalid numeric input before building case updates

## Overview

Address review finding **E04 (Medium)**: invalid numeric text becomes `null` in a case update, turning
a typo into an instruction to clear data. Distinguish deliberate blanks from valid numbers and
invalid input; show field errors and preserve submitted text without sending a write.

## Context

Reviewed baseline: `649c30e01870abe2b57be43d6c17a02fbfffad72` on admin `origin/master`.
Read `CLAUDE.md` and applicable `.claude/rules/` before implementation. Record the actual execution
baseline and recheck the finding. Use an isolated feature worktree on the intended integration branch;
the older `fix/api-transport-tls` authoring checkout belongs to existing work.

`libs/deed-poll/src/deed-poll/form-payload.ts` currently maps invalid numeric conversion to `null`.
An overflow such as `1e999` becomes `Infinity`, which JSON serialization also turns into `null`.
The edit handler `src/pages/deed-polls/[id]/edit/[tab].ts` validates date parts before constructing
the patch, but has no corresponding numeric-input guard.

At the reviewed baseline, editable numeric fields include integer `ageOfMinor`/`ageOfMinorMonths`
and decimal `refundAmount`. Recheck metadata, schemas and the API contract; readonly numeric fields
must not become writable. The review demonstrated payload construction, not a real persisted update.

Optional historical probes and the review report are under workspace
`local-notes/deed-poll-admin/`. Convert the payload examples into portable tests; do not import notes.

## Development Approach

1. Use one small typed parsing contract that distinguishes absent, blank, valid and invalid. Share it
   between validation and patch construction so two different numeric rules cannot drift.
2. Blank input may produce `null` only for a nullable editable field. Absent and readonly fields remain
   omitted. Invalid and non-finite values must never produce a clearing patch or reach serialization.
3. Enforce integer versus decimal semantics from the existing contract. Require finite values and
   safe integer representation for integer fields. Do not invent new age ranges, currency precision,
   positivity requirements or currency-symbol stripping.
4. Pin accepted string syntax against the existing form and contract before changing conversion.
   Preserve legitimate decimal/zero values and contract-permitted signs. Explicitly test whitespace,
   exponent notation and non-decimal prefixes; reject overflow and malformed values regardless.
   Any stricter syntax decision must be documented, not hidden in an incidental regex.
5. Follow the existing date-validation and GOV.UK field-error presentation. Preserve the exact submitted
   invalid text on re-render, combine date/numeric errors, and perform no mutation if either is invalid.
   The API remains authoritative for permissions and domain business rules.
6. Keep this scoped to numeric form parsing and its callers. No generic form framework, dependency,
   API-schema change or database change. Use test-first tasks, preserve others' work and record a
   review base. Local task commits are appropriate; publication, merging and deployment are separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Record baseline/results, counts and skips; separate
pre-existing failures from regressions. Follow formatting rules and inspect unrelated changes.

During red/green work use the package's existing test command for domain tests and, for the page:

```bash
yarn vitest run 'src/pages/deed-polls/[id]/edit/[tab].test.ts'
yarn welsh:check
```

Run `yarn welsh:check` before changes as well. If the repository already has missing translations,
record the exact baseline and resolve new omissions according to its existing translation workflow;
do not describe an unrelated nonzero baseline as a clean pass.

## Implementation Steps

### Task 1: Define numeric parsing without accidental clearing

**Files:** `libs/deed-poll/src/deed-poll/form-payload.ts`, `form-payload.test.ts`, `form-fields.ts`,
the relevant schema definitions and a colocated numeric helper/test if extraction improves clarity.

- [x] Inventory numeric editable fields, their nullability/integer semantics and all patch-builder
      callers. Check current schema/API constraints and document the supported input syntax here.
- [x] Add failing tests for `12x`, `£25.00`, `1e999`, `NaN`, `Infinity` and non-scalar submitted values.
      Assert invalid input is distinct from blank and cannot yield a `null` numeric patch.
- [x] Implement the shared typed parser/result with finite-number checks and integer validation.
      Cover decimal refund amounts, integer ages, zero, whitespace-only blanks, absent values,
      readonly fields, fractions in integer fields and unsafe integer values.
- [x] Pin exponent, sign and non-decimal-prefix behaviour explicitly according to the documented
      syntax decision. Preserve existing legitimate values; do not silently round or strip characters.
- [x] Ensure callers cannot accidentally bypass invalid results and build an update. Keep package
      exports narrow and adapt existing callers as needed to maintain a coherent build.
- [x] Run focused tests and all Validation Commands; record red/green evidence.

**Task 1 inventory and syntax decision (recorded 2026-10-20).**

- Editable number fields (`EDITABLE_FIELDS`, kind `number`): `ageOfMinor` and `ageOfMinorMonths`
  (`UpdateCaseRequest`: `["integer","null"]`, `int32`) and `refundAmount` (`["number","null"]`). No
  minimum, maximum or precision is published; `UpdateCaseRequest` sets `additionalProperties: false`.
  Read-only numbers (`referencenumber`, `daysReceivedToEnroled`, `daysReceivedToReturned`) are never patched.
  Local zod (`schemas.ts`) agrees: `z.int().nullish()` / `z.number().nullish()`.
- The one `buildUpdatePatch` caller is `src/pages/deed-polls/[id]/edit/[tab].ts`; it calls it inside the
  `try` that already re-renders `InvalidInputError`, so invalid numbers re-render instead of writing.
- Parser: `libs/deed-poll/src/deed-poll/numeric-input.ts` (`readNumericInput`, not exported from the
  package index). Outcomes `absent | blank | valid | invalid`. Accepted syntax after trimming surrounding
  whitespace is plain decimal `^[+-]?(\d+(\.\d*)?|\.\d+)$`: signs allowed (contract has no minimum),
  exponent (`1e3`), `0x`/`0b`/`0o` prefixes, `NaN`/`Infinity`, currency symbols, separators and
  non-ASCII digits refused, never stripped. Non-finite results are invalid. Integer fields (`numberFormat:
  "integer"` on `FieldDef`, pinned to the contract by `form-fields.test.ts`) must be an integer in int32
  range; `7.0` reads as 7, `7.5` is refused, not rounded. A non-string body value (duplicate field array,
  bracketed object) is invalid.
- `buildUpdatePatch`: number absent → omitted (previously nulled), blank → `null` unless `notNullable`,
  valid → the number, invalid → collected and thrown as one `InvalidInputError` naming each field, so no
  patch is returned. Other kinds unchanged.

### Task 2: Render numeric field errors without a write

**Files:** `src/pages/deed-polls/[id]/edit/[tab].ts`, its colocated test,
the existing form/error view-model helpers and locale entries needed by the new messages.

- [x] Add failing POST-handler tests for invalid refund and age inputs. Assert `updateDeedPoll` is
      never called, the appropriate field/error-summary link appears and the original text survives.
- [x] Apply numeric validation before patch construction/mutation alongside the existing date checks.
      Reuse the parsing result instead of converting strings a second time under different rules.
- [x] Combine date and numeric errors in one re-render. Preserve other submitted values, tab routing,
      API field editability and existing API validation/conflict handling.
- [x] Provide concise field-specific messages following the repository's English/Welsh workflow.
      Do not display a currency-formatted substitute for the invalid raw value.
- [x] Test blank nullable clearing, zero, valid decimal amounts and valid integer ages; assert exact
      mutation payloads and one write for valid submissions. Missing/readonly fields remain omitted.
- [x] Run focused tests, translation checks and all Validation Commands; record results.

### Task 3: Prove the HTTP-to-payload boundary

**Files:** the edit handler's colocated tests or a focused integration test outside `src/pages`;
`libs/deed-poll/src/deed-poll/form-payload.test.ts` and relevant domain tests.

- [x] Submit URL-encoded forms through real Express body parsing and the actual edit handler with
      domain persistence mocked. Include typo, currency-symbol, overflow, fractional-age and duplicate/
      non-scalar field inputs. Browser controls cannot be relied on for server validation.
- [x] Assert invalid submissions render errors, preserve input and make zero domain writes. For valid
      and deliberate-clear submissions, assert the exact outgoing payload and normal redirect.
- [x] Prove no accepted numeric payload contains `NaN` or infinity before JSON serialization, and
      serialization preserves every accepted numeric value. An invalid value must not become `null`.
- [x] Check other patch-builder callers remain safe, date behaviour is unchanged and readonly numeric
      data cannot be injected by posting an extra field.
- [x] Run focused tests, translation checks and all Validation Commands; record results and limits.

### Task 4: Document the form contract and review

**Files:** `CLAUDE.md` or existing form-validation guidance, and this plan's Execution notes.

- [x] Document absent/blank/valid/invalid semantics, accepted numeric syntax, integer/decimal rules and
      the requirement to validate before mutation. State that API business validation still applies.
- [x] Record starting/final commits, changed files, regression evidence, counts, skips and translation
      baseline/delta. Distinguish mocked persistence tests from a live database update.
- [x] Run all Validation Commands and hand off to Ralphex review phases. Record review findings and
      revalidation for any fixes.

## Acceptance Criteria

- Invalid/non-finite input causes a field error and no write; submitted text is preserved.
- Deliberate blank input still clears nullable fields; absent and readonly fields remain omitted.
- Valid amounts and integer ages retain their values, including zero; integer fields reject fractions.
- One parsing contract governs validation and payload creation, and invalid values cannot serialize
  into accidental clearing instructions.
- Existing date validation, editability and API error behaviour remain intact.

## Execution notes

Authored 20 October 2026 by Ellis from review finding E04. Executed 20 October 2026 via Ralphex;
evidence per task follows.

**Task 1 (Ralphex iteration 1, 2026-10-20).** Execution baseline `d99babb` on
`fix/e04-numeric-input-validation` (master `5b94315` plus this plan). Finding rechecked at baseline: `Number`
fallback mapped `12x`/`NaN` to `null` and `1e999` to `Infinity`. Red: 13 of the new `form-payload.test.ts`
cases failed against the baseline `form-payload.ts`; green after the change. Validation with
`REDIS_URL=redis://127.0.0.1:6379`: `yarn lint` clean (one pre-existing Biome schema-version info), `yarn build`
8/8, `yarn turbo test test:app --concurrency=1 --force` 8/8 tasks, no skips — app 2328, deed-poll 1275,
api-client 778, cloud-native-platform 157, express-govuk-starter 127, simple-router 41, session-postgres 23,
session-redis 7. `yarn welsh:check` exits 1 at baseline and after (727 strings, 510 identical in cy);
Task 1 changed only `libs/deed-poll`, outside the extractor's scope, so the delta is zero.

**Task 2 (Ralphex iteration 2, 2026-10-20).** Start `eec06da`. `collectNumericErrors` (one pass of
`readNumericInput`, the rule `buildUpdatePatch` now also refuses through) and `collectFormErrors` (dates and
numbers in field render order) added to `form-validation.ts`; the edit handler calls `collectFormErrors` before
building the patch, so `updateDeedPoll` is never reached on either error. `collectDateErrors` is unchanged for its
other callers (`new.ts`, the query builder). Red: the five invalid-input handler cases already passed, because
Task 1's throw inside the handler's `try` re-renders; the combined date-plus-number case failed (only the date error
rendered) and passes now. Four valid-write cases first failed on the test's own expectation — the refund tab also
carries `refundReference`, a text field whose absence still nulls, as before this plan — and were corrected to
submit it. Messages ("… must be a number", "… must be a whole number") are domain field errors like the date
messages, which are English-only domain strings outside the Welsh extractor's page scope; no page `en`/`cy` was
added. The raw submitted text is replayed unformatted. Validation: `yarn lint` clean (same Biome schema info),
`yarn build` 8/8, full suite 8/8 tasks, no skips — app 2342, deed-poll 1280, others unchanged. `yarn welsh:check`
exits 1 with the unchanged baseline (727 strings, 510 identical in cy); delta zero.

**Task 3 (Ralphex iteration 3, 2026-10-20).** Start `2a29e50`. Added `src/case-edit-numeric.test.ts` (29 cases):
URL-encoded posts through `express.urlencoded({ extended: true })` (the parser `app.ts` mounts) into the real edit
handler, rendering the real `deed-polls/edit.njk` through Nunjucks, with only `findDeedPoll`/`updateDeedPoll`
mocked. Covers typo, currency symbol, separator, overflow, exponent, hex/binary prefixes, `NaN`, `Infinity`,
fractional and beyond-int32 ages, and repeated/bracketed (array, object) field names; each is a 400 with the
summary link, the message and the exact typed text in the input, and no write. Valid decimal, zero, signed,
leading-dot, whitespace-padded and blank/whitespace-only (clearing) submissions assert the exact patch and the
302 to `#refund`; ages pin `7.0` → 7, zero, and an unsubmitted age omitted. Every accepted number in the outgoing
patches is finite and survives `JSON.stringify` unchanged. Read-only `referencenumber`, `daysReceivedToEnroled`
and `daysReceivedToReturned` posted as extra fields (valid or not) never reach the patch, and another tab's
numeric field does not ride along. Date behaviour: combined date+number errors re-render together with both texts
kept, valid date parts compose as before. `buildUpdatePatch` still has one caller (the edit handler); the create
page builds no numeric patch, and `updateDeedPoll` forwards the patch unchanged to `patchCase`. Red: with
`libs/deed-poll/src` and the handler checked out at baseline `d99babb`, 16 of the 29 failed (every invalid input,
and the absent-age omission); green at HEAD. Limit: persistence mocked, no live api or database update; decimal
precision beyond a double (e.g. 16+ significant digits) is `Number()`'s and not refused, which the plan does not
ask for. Validation: `yarn lint` clean (same Biome schema info), `yarn build` 8/8, full suite 8/8 tasks, no skips —
app 2371 (+29), others unchanged. `yarn welsh:check` exits 1 with the unchanged baseline (727 strings, 510
identical in cy); delta zero.

**Task 4 (Ralphex iteration 4, 2026-10-20).** Start `dac7746`. Documented the contract in `CLAUDE.md` ("Numeric
case-form input"): the four outcomes, the accepted decimal syntax, integer/decimal from the contract, validation
before mutation with `buildUpdatePatch`'s own throw as a backstop, and that api's business validation still applies.
Overall: starting commit `d99babb` (master `5b94315` plus this plan); task commits `eec06da`, `2a29e50`, `dac7746`
and this one. Changed files: `form-fields.ts`/`.test.ts`, `form-payload.ts`/`.test.ts`, `form-validation.ts`/`.test.ts`,
`numeric-input.ts`/`.test.ts` (new), `src/case-edit-numeric.test.ts` (new), the edit handler and its test,
`edit.njk` (comment), `CLAUDE.md` and this plan.
Review (code-reviewer agent over `d99babb..HEAD`) found no path from invalid or non-finite input to a `null`,
`NaN` or infinite patch value or a write. Findings and outcomes:
1. Absent number fields are now omitted rather than nulled, so the minor ages, which the rules hide on Adult and
   Relinquishment cases, are no longer sent as `null` on an Application save, while `minorDateOfBirth` and `parents`
   still are. No change: the plan requires absent fields to be omitted, and api's minor write gate (`applyMinorGate`,
   listed in the mock's docblock as api's) clears all four minor-only fields on those types. `refundAmount` is never
   hidden.
2. Integer text beyond double precision (`7.00000000000000001`) rounded to a whole number and was accepted. Fixed:
   integer fields now refuse any non-zero fractional digit, checked on the text. The test failed red first (1 of 56),
   then passed. Docblock and `CLAUDE.md` now state that `Number()` rounds an over-long decimal.
3. Two stale comments (`form-validation.ts` split docblock, edit handler's "blanking absent ones"). Fixed.
Revalidation with `REDIS_URL=redis://127.0.0.1:6379`: `yarn lint` clean (pre-existing Biome schema-version info),
`yarn build` 8/8, full suite 8/8 tasks, no skips. App 2371, deed-poll 1282 (+2 over Task 3), api-client 778,
cloud-native-platform 157, express-govuk-starter 127, simple-router 41, session-postgres 23, session-redis 7.
Across the plan: app +43 (2328 → 2371), deed-poll +7 (1275 → 1282). `yarn welsh:check` still exits 1 at the
unchanged baseline (727 strings, 510 identical in cy), so the plan's translation delta is zero. Every test here mocks
persistence (`findDeedPoll`/`updateDeedPoll`, or the adapter). No live api or database update was performed.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Publishing, merging and deployment are separate actions.
Move this plan to `docs/plans/completed/` only after implementation and review. Do not start Ralphex as
part of authoring this plan.
