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

- [ ] Inventory numeric editable fields, their nullability/integer semantics and all patch-builder
      callers. Check current schema/API constraints and document the supported input syntax here.
- [ ] Add failing tests for `12x`, `£25.00`, `1e999`, `NaN`, `Infinity` and non-scalar submitted values.
      Assert invalid input is distinct from blank and cannot yield a `null` numeric patch.
- [ ] Implement the shared typed parser/result with finite-number checks and integer validation.
      Cover decimal refund amounts, integer ages, zero, whitespace-only blanks, absent values,
      readonly fields, fractions in integer fields and unsafe integer values.
- [ ] Pin exponent, sign and non-decimal-prefix behaviour explicitly according to the documented
      syntax decision. Preserve existing legitimate values; do not silently round or strip characters.
- [ ] Ensure callers cannot accidentally bypass invalid results and build an update. Keep package
      exports narrow and adapt existing callers as needed to maintain a coherent build.
- [ ] Run focused tests and all Validation Commands; record red/green evidence.

### Task 2: Render numeric field errors without a write

**Files:** `src/pages/deed-polls/[id]/edit/[tab].ts`, its colocated test,
the existing form/error view-model helpers and locale entries needed by the new messages.

- [ ] Add failing POST-handler tests for invalid refund and age inputs. Assert `updateDeedPoll` is
      never called, the appropriate field/error-summary link appears and the original text survives.
- [ ] Apply numeric validation before patch construction/mutation alongside the existing date checks.
      Reuse the parsing result instead of converting strings a second time under different rules.
- [ ] Combine date and numeric errors in one re-render. Preserve other submitted values, tab routing,
      API field editability and existing API validation/conflict handling.
- [ ] Provide concise field-specific messages following the repository's English/Welsh workflow.
      Do not display a currency-formatted substitute for the invalid raw value.
- [ ] Test blank nullable clearing, zero, valid decimal amounts and valid integer ages; assert exact
      mutation payloads and one write for valid submissions. Missing/readonly fields remain omitted.
- [ ] Run focused tests, translation checks and all Validation Commands; record results.

### Task 3: Prove the HTTP-to-payload boundary

**Files:** the edit handler's colocated tests or a focused integration test outside `src/pages`;
`libs/deed-poll/src/deed-poll/form-payload.test.ts` and relevant domain tests.

- [ ] Submit URL-encoded forms through real Express body parsing and the actual edit handler with
      domain persistence mocked. Include typo, currency-symbol, overflow, fractional-age and duplicate/
      non-scalar field inputs. Browser controls cannot be relied on for server validation.
- [ ] Assert invalid submissions render errors, preserve input and make zero domain writes. For valid
      and deliberate-clear submissions, assert the exact outgoing payload and normal redirect.
- [ ] Prove no accepted numeric payload contains `NaN` or infinity before JSON serialization, and
      serialization preserves every accepted numeric value. An invalid value must not become `null`.
- [ ] Check other patch-builder callers remain safe, date behaviour is unchanged and readonly numeric
      data cannot be injected by posting an extra field.
- [ ] Run focused tests, translation checks and all Validation Commands; record results and limits.

### Task 4: Document the form contract and review

**Files:** `CLAUDE.md` or existing form-validation guidance, and this plan's Execution notes.

- [ ] Document absent/blank/valid/invalid semantics, accepted numeric syntax, integer/decimal rules and
      the requirement to validate before mutation. State that API business validation still applies.
- [ ] Record starting/final commits, changed files, regression evidence, counts, skips and translation
      baseline/delta. Distinguish mocked persistence tests from a live database update.
- [ ] Run all Validation Commands and hand off to Ralphex review phases. Record review findings and
      revalidation for any fixes.

## Acceptance Criteria

- Invalid/non-finite input causes a field error and no write; submitted text is preserved.
- Deliberate blank input still clears nullable fields; absent and readonly fields remain omitted.
- Valid amounts and integer ages retain their values, including zero; integer fields reject fractions.
- One parsing contract governs validation and payload creation, and invalid values cannot serialize
  into accidental clearing instructions.
- Existing date validation, editability and API error behaviour remain intact.

## Execution notes

Planning only, 20 October 2026. Ellis authored this plan from review finding E04. No implementation,
new validation run or Ralphex execution has been performed for this plan. Append execution evidence here.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Publishing, merging and deployment are separate actions.
Move this plan to `docs/plans/completed/` only after implementation and review. Do not start Ralphex as
part of authoring this plan.
