# Plan: no Google Tag Manager in admin, and three small input gaps closed

## Overview

Address review findings **R12 (Lower)** and **R15 (Lower)** from the repeat quality and security review (workspace
`local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`). Steve's decisions, 2026-10-22: R12, turn
GTM off for admin; R15, fix all three gaps.

- **R12:** every page carries an inline, un-nonced Google Tag Manager bootstrap (and a `<noscript>` iframe) for the
  template's placeholder container `GTM-XXXXXX`, which the CSP then blocks. `configureHelmet()` is called with no
  options, so `script-src`, `connect-src`, `img-src` and `frame-src` still admit `*.googletagmanager.com` (and
  `img-src`/`connect-src` `*.google-analytics.com`). That host is a known CSP-bypass host, so the allowance weakens
  containment of any future injection for a feature admin does not use. `config/production.json` even sets
  `gtm.enabled: true`, though nothing reads `enabled`.
- **R15:** three input gaps:
  1. **Edit-form textareas advertise `maxlength` 2,000** (`noteMaxLength` in `src/pages/deed-polls/[id]/edit/[tab].ts`,
     passed to every field by `edit.njk`) but the save path enforces no limit, and api's columns are `text`, so a
     hand-crafted 5,000-character `returnReason` reaches the patch. The three textareas are `referralNotes`,
     `masterDirections` and `returnReason`.
  2. **Blank witnesses:** `libs/deed-poll/src/witnesses/schemas.ts` has no trim or minimum, so an empty or
     whitespace-only name, address or occupation is created or saved, and counts towards the enrolment-witness
     threshold.
  3. **Untrimmed new-case names:** `src/pages/deed-polls/new.ts` sends `"  Applicant  "` unchanged, where the edit tabs
     trim (`readFieldInput`).

## Context

Baseline: admin `origin/master` `4785bd2`. Read `CLAUDE.md` ("Case edit form saves", "Numeric case-form input", "The
dev persona switcher", "Personas and role gating" for the Welsh extractor) and `.claude/rules/backend.md` and
`.claude/rules/frontend.md` first. Record the execution baseline and recheck each finding there.

### R12

- Templates: `libs/express-govuk-starter/src/govuk-frontend/views/components/head-analytics.njk` and
  `body-start-analytics.njk` render GTM when the `gtm` nunjucks global has a `containerId`.
- `src/app.ts` passes `gtm: config.get("gtm")` as a nunjucks global and calls `configureHelmet()` with no options;
  `configureHelmet` (`libs/express-govuk-starter/src/helmet/helmet-middleware.ts`) defaults
  `enableGoogleTagManager` to `true`.
- Config: `config/default.json` `gtm: { containerId: "GTM-XXXXXX", enabled: false }`; `config/production.json`
  `gtm: { enabled: true }`. No chart or `custom-environment-variables.json` entry names GTM.
- **`libs/express-govuk-starter` is template-provided** (CLAUDE.md): an edit there is lost at the next re-scaffold.
  Make the change in the app (`src/app.ts`, `config/`), not in the starter.
- Dynatrace shares the same templates and globals; leave it exactly as it is.

### R15

- Edit form: `readFieldInput` (`libs/deed-poll/src/deed-poll/form-input.ts`) is the one parser per field kind, shared
  by `collectFormErrors` and `buildUpdatePatch`; `form-validation.ts` holds the English-only field-error messages.
  The edit POST reads no case first. api stores all three textareas as unbounded `text`. Whether migrated legacy
  values can exceed 2,000 characters is not recorded; the field definitions describe return reason as a
  "2000-character free-text field". If an older value is longer, the save is refused with an ordinary field error
  naming the limit and the caseworker can shorten it; nothing is cleared or lost. Record this in the execution notes.
- Witnesses: `createWitnessSchema` / `updateWitnessSchema` in `libs/deed-poll/src/witnesses/schemas.ts`, used by
  `src/pages/deed-polls/[id]/witnesses/new.ts` and `[witnessId]/edit.ts`, which read their `MAX_*` from the schema
  and render the schema's messages. Read both pages, their templates and tests before changing the schema.
- New case: `src/pages/deed-polls/new.ts` builds `createDeedPollSchema.safeParse({ … newForename: body.newForename ||
  undefined, newSurname: … })`.

## Development Approach

1. **R12: no GTM markup and no GTM or Google Analytics host in the CSP.** In `src/app.ts` call
   `configureHelmet({ enableGoogleTagManager: false })` and stop passing a `gtm` global, so neither template renders
   anything. Remove the `gtm` blocks from `config/default.json` and `config/production.json` (nothing else reads
   them; check with a grep, tests included). Do not edit `libs/express-govuk-starter`. Keep every other CSP directive
   and the Dynatrace global unchanged. A short comment at the call site says why (finding R12, and that adopting GTM
   later needs a real container, a nonce and analytics consent).
2. **R15.1: enforce the advertised limit.** A textarea field on the edit form longer than 2,000 characters (after the
   same trimming `readFieldInput` already applies) is `invalid`: a GOV.UK field error from `collectFormErrors` in field
   order, the exact submitted text redrawn, no write, and `buildUpdatePatch` throws `InvalidInputError` on it. Use one
   constant for the limit, shared with the `maxlength` the page advertises, so the two cannot drift. Count characters
   the way the browser's `maxlength` does (UTF-16 code units, i.e. `string.length`), so text a browser accepts is never
   refused. The message is an English-only domain string like the numeric ones.
3. **R15.2: a witness needs a real name, address and occupation.** Trim all three; an empty result is a field error
   on create, and on edit for any field present in the body. The trimmed values are what is sent. Keep the existing
   maximum lengths and messages' style; measure the maximum after trimming. Pages keep rendering the schema's messages,
   so check what the user sees for each new refusal and that the submitted text is redrawn.
4. **R15.3: trim the new-case names.** `newForename` and `newSurname` are trimmed before the schema; a whitespace-only
   value reads as absent (so it gets the same "required" error, if any, as an empty one). The edit tabs already trim.
5. **Welsh:** any new string a caseworker sees that lives in a page's `en` must have a `cy` copy in English (never
   write Welsh), and `yarn welsh:check` must change only by those strings. Domain messages in `libs/` add nothing.
6. **Out of scope:** api limits (a separate api change), existing blank witnesses or over-long values already stored,
   the other review findings, Dynatrace, the starter library. No new dependency.
7. Work test first. Local task commits are appropriate; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips; distinguish baseline failures from regressions, and inspect formatting diffs.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: No Google Tag Manager (R12)

**Files:** `src/app.ts`, `config/default.json`, `config/production.json`, and a test (an existing app or helmet test
in `src/`, or a new colocated one).

- [ ] Record the execution baseline in the execution notes.
- [ ] Add failing tests through the real app: a rendered page holds no `googletagmanager` or `GTM-` text, and the
      `Content-Security-Policy` header names no `googletagmanager.com` or `google-analytics.com` host, while still
      carrying the nonce and the other directives it has today.
- [ ] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: Edit-form textarea limit (R15.1)

**Files:** `libs/deed-poll/src/deed-poll/form-input.ts`, `form-validation.ts`, `form-payload.ts` and their tests;
`src/pages/deed-polls/[id]/edit/[tab].ts` (the shared constant); `src/case-edit-untouched-fields.test.ts` or a sibling
handler test.

- [ ] Add failing tests: 2,000 characters saves; 2,001 is a field error with no write and the text redrawn;
      `buildUpdatePatch` throws on it; an unchanged save of an ordinary value still writes it back exactly; the
      rendered `maxlength` equals the enforced limit.
- [ ] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Witness fields and new-case names (R15.2, R15.3)

**Files:** `libs/deed-poll/src/witnesses/schemas.ts` and its tests; the witness new/edit pages and tests;
`src/pages/deed-polls/new.ts` and its tests.

- [ ] Add failing tests: blank and whitespace-only name, address and occupation are refused on create and edit with
      no api call and the input redrawn; padded values are sent trimmed; the maximum is measured after trimming; a
      partial edit that omits a field is unchanged; `"  Applicant  "` is sent as `"Applicant"` and a whitespace-only
      name behaves as an empty one.
- [ ] Implement, run focused tests and all Validation Commands, and record the results.

### Task 4: Record the rules and hand off

**Files:** `CLAUDE.md`, this plan.

- [ ] `CLAUDE.md`: in "Case edit form saves", the textarea limit and its shared constant; a short note that admin
      carries no GTM and why (finding R12), near the CSP or deployment facts. **Reference this plan by its
      `docs/plans/completed/` path**, since that is where it will be once the run ends.
- [ ] Run `yarn welsh:check` and record that it changed only by any new strings (it exits 1 by design).
- [ ] Record final commits, changed files and test counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- No page carries GTM markup and the CSP names no Google Tag Manager or Google Analytics host; Dynatrace and every
  other directive are unchanged.
- An edit-form textarea over 2,000 characters is a field error with no write; the advertised and enforced limits are
  one constant.
- A witness cannot be created or saved with a blank or whitespace-only name, address or occupation, and values are
  sent trimmed.
- New-case names are sent trimmed.
- All Validation Commands pass with no new failures or skips.

## Execution notes

(Record baseline, red/green evidence and final results here.)

## Post-Completion

Publishing, merging and deployment are separate from this plan. api limits for the three textareas are a separate
api change.
