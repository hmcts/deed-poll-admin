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

- [x] Record the execution baseline in the execution notes.
- [x] Add failing tests through the real app: a rendered page holds no `googletagmanager` or `GTM-` text, and the
      `Content-Security-Policy` header names no `googletagmanager.com` or `google-analytics.com` host, while still
      carrying the nonce and the other directives it has today.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: Edit-form textarea limit (R15.1)

**Files:** `libs/deed-poll/src/deed-poll/form-input.ts`, `form-validation.ts`, `form-payload.ts` and their tests;
`src/pages/deed-polls/[id]/edit/[tab].ts` (the shared constant); `src/case-edit-untouched-fields.test.ts` or a sibling
handler test.

- [x] Add failing tests: 2,000 characters saves; 2,001 is a field error with no write and the text redrawn;
      `buildUpdatePatch` throws on it; an unchanged save of an ordinary value still writes it back exactly; the
      rendered `maxlength` equals the enforced limit.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Witness fields and new-case names (R15.2, R15.3)

**Files:** `libs/deed-poll/src/witnesses/schemas.ts` and its tests; the witness new/edit pages and tests;
`src/pages/deed-polls/new.ts` and its tests.

- [x] Add failing tests: blank and whitespace-only name, address and occupation are refused on create and edit with
      no api call and the input redrawn; padded values are sent trimmed; the maximum is measured after trimming; a
      partial edit that omits a field is unchanged; `"  Applicant  "` is sent as `"Applicant"` and a whitespace-only
      name behaves as an empty one.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

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

### Baseline (2026-10-22)

- Branch `fix/r12-r15-gtm-off-and-input-gaps` at `7394944` (the plan commit on admin `origin/master` `4785bd2`).
- `yarn lint`: clean, one pre-existing Biome info (the `biome migrate` configuration notice). `yarn build`: 8/8.
- `yarn turbo test test:app --concurrency=1 --force` with local Redis: all green, no skips. app 126 files / 2,669
  tests; deed-poll 68 / 1,401; deed-poll-api-client 15 / 1,039; express-govuk-starter 12 / 127; cloud-native-platform
  13 / 157; simple-router 4 / 41; express-session-postgres 2 / 30; express-session-redis 1 / 7.
- R12 rechecked: `/signed-out` rendered the GTM bootstrap for `GTM-XXXXXX`, and the CSP carried
  `*.googletagmanager.com` in `script-src`, `img-src`, `connect-src` and `frame-src` and `*.google-analytics.com` in
  `img-src` and `connect-src`. Only `src/app.ts` read the `gtm` config; no chart, env mapping or test named it.

### Task 1 (R12)

- New `src/analytics.test.ts` drives the real `createApp` (real starter, helmet, router and `/signed-out` page; Redis
  and the session store doubled, assets from `dist`). Red at baseline on both tests: GTM markup present, Google hosts
  in the CSP.
- `src/app.ts`: `configureHelmet({ enableGoogleTagManager: false })` with a comment citing R12, and no `gtm` global;
  the `gtm` blocks removed from `config/default.json` and `config/production.json`. Dynatrace and the starter are
  untouched.
- The CSP is pinned exactly (nonce normalised). Every directive is as before minus the Google sources; `frame-src`
  disappears because GTM was its only source, so frames fall back to `default-src 'self'`.
- After: lint clean (same info), build 8/8, app 127 files / 2,671 tests (+2), every other package unchanged, no skips.

### Task 2 (R15.1)

- Only `returnReason` (Return tab) is still editable; `referralNotes` and `masterDirections` sit on the retired
  Referral tab, outside `FORM_TABS`. The rule is on the `textarea` kind, so it covers all three wherever they render.
- `TEXTAREA_MAX_LENGTH = 2000` in `form-fields.ts` (exported through the package index). `readFieldInput` reads a
  textarea whose trimmed text is longer as `{ kind: "invalid", reason: "too-long" }`; `fieldInputMessage(field, input)`
  words it "Return reason must be 2,000 characters or less" (English-only domain string). `collectFormErrors` and
  `buildUpdatePatch` both pass the reading through, so field order, no write and the `InvalidInputError` follow from
  the existing paths. `string.length` counts UTF-16 code units, as `maxlength` does.
- `edit-view.ts` `couldBeRendered` now redraws a textarea's submitted string as typed (like a number), so an over-long
  value is shortened rather than retyped. An array in a textarea still redraws from the record.
- `[tab].ts` drops `noteMaxLength` from `en` and passes `textareaMaxLength: TEXTAREA_MAX_LENGTH` in the model;
  `edit.njk` reads that. It was a number, which the Welsh extractor never reported.
- Legacy values: whether migrated records hold a longer return reason is not recorded. If one does, its next save
  of the Return tab is refused with the field error naming the limit, the text is redrawn, and the caseworker
  shortens it; nothing is cleared or lost.
- Tests: `form-validation.test.ts` (+7), `form-payload.test.ts` (+2), `case-edit-untouched-fields.test.ts` (+4: the
  rendered `data-maxlength` equals the constant, 2,000 saves, 2,001 is a 400 with the error, no write and the text
  redrawn, an unchanged ordinary save writes back exactly). Red before the change except the unchanged-save test,
  which pins existing behaviour.
- After: lint clean (same info; Biome fixed formatting and import order only), build 8/8, app 127 / 2,675 (+4),
  deed-poll 68 / 1,410 (+9), every other package unchanged, no skips.

### Task 3 (R15.2, R15.3)

- `createWitnessSchema` now trims each of the three text fields and requires at least one character (`.trim().min(1).max(n)`),
  so the maximum is measured after trimming and the trimmed values are what is sent. `updateWitnessSchema` is still
  its partial, so an omitted field stays out of the patch. This is stricter than api, which still accepts `""`. The
  old schema test and page test that pinned "a blank is accepted" were replaced, and the page docblocks updated.
- Both witness pages now choose the message by Zod issue code: `too_big` gets the existing length message, and
  anything else on a text field (blank, whitespace-only, absent) gets a new `blankErrors` entry ("Enter the witness's
  name" / "address" / "occupation"). The submitted text is redrawn as before. That is three new page strings per page,
  with `cy` copied from `en` by the existing `{ ...en }`, so `yarn welsh:check` should grow by six rows.
- `src/pages/deed-polls/new.ts` trims `newForename`/`newSurname` through `trimmedOrAbsent`, so whitespace alone is
  absent like an empty value. A value that is not a string is passed on for the schema to refuse.
- Tests: schemas +6 net (blank ×3, trim, max-after-trim, update blank/trim, omitted field; one removed); new witness
  page +5 net; edit witness page +4; new case +2. Each refusal test failed before the change. The trim tests went
  green with the schema change, before the page change.
- After: lint clean (same info), build 8/8, app 127 / 2,686 (+11), deed-poll 68 / 1,416 (+6), every other package
  unchanged, no skips.

## Post-Completion

Publishing, merging and deployment are separate from this plan. api limits for the three textareas are a separate
api change.
