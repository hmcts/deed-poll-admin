# Plan: the sign-in error page says only what this app chose to say, and the 403 rule is described accurately

## Overview

Address review findings **R10 (Lower)** and **R14 (Lower)** from the repeat quality and security review (workspace
`local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`):

- **R10:** the IDAM callback (`src/pages/oauth2/callback.ts`, around line 34) renders
  `req.query.error_description ?? req.query.error` onto the service's own 403 page. When the session holds a login
  flow, `?error=…&error_description=<anything>` puts an attacker's sentence on the page as body text, escaped but
  verbatim, under the GOV.UK header. Creating a flow needs no sign-in: any link to `/login` does it. With no
  description, any `error` string is shown, though the security event in the same handler refuses unrecognised
  values; a repeated `error_description` arrives as an array. This is content spoofing, not script execution.
- **R14:** `src/errors.ts` answers every `ForbiddenError` with status 403 on the **404 view**. `CLAUDE.md` and
  `.claude/rules/backend.md` say this keeps `/judicial/**` non-enumerable and that a guessed judicial URL "discloses
  nothing". The status does disclose that the area exists. **Steve's decision (2026-10-21): keep the 403 status,
  which is deliberate and pinned by the e2e specs (`e2e-tests/tests/judicial.spec.ts` around line 605,
  `staff-roles.spec.ts`), and correct the documentation to say exactly what it does and does not reveal.** No
  behaviour change for R14.

## Context

Baseline: admin `origin/master` `2a87bf5`. Read `CLAUDE.md` ("Personas and role gating", "Security events") and the
applicable `.claude/rules/` first. Record the execution baseline and recheck both findings there.

- `src/pages/oauth2/callback.ts`: the `error` branch emits `auth.login.failed` with `outcome: idamErrorCode(error)`,
  where `IDAM_ERROR_CODE = /^[a-z_]{1,64}$/` and anything else is `unrecognised`, then renders `errors/403` with
  `reason`. Keep the event exactly as it is.
- `src/pages/errors/403.njk` renders `reason` as a paragraph when present, then a fixed sign-in/permissions sentence.
  The template is the login flow's own, and is hardcoded English.
- RFC 6749 §4.1.2.1 defines the authorization endpoint's `error` codes: `invalid_request`, `unauthorized_client`,
  `access_denied`, `unsupported_response_type`, `invalid_scope`, `server_error`, `temporarily_unavailable`. OpenID
  Connect adds `login_required`, `consent_required`, `interaction_required` and others.
- R14's wording lives in `CLAUDE.md` (around line 227: "so a guessed judicial URL discloses nothing") and in
  `.claude/rules/backend.md` (the `forbidden` row of the error table: "keeps `/judicial/**` non-enumerable, so a
  caseworker who guesses a judicial URL is not told there is something behind it"). Check `src/errors.ts`'s comment
  there as well.

Review evidence (a portable reproduction to adapt into a real test; do not import workspace files):
`local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-output-auth.probe.test.ts`, tests "AO-A1"
(R10) and "AO-A3" (R14, which is now a documentation change only).

## Development Approach

1. **R10: a fixed sentence per known code, and never IDAM's prose.** The callback maps a small set of known `error`
   codes to this app's own sentences: at least `access_denied` (the user declined or was refused), and one shared
   sentence for the temporary codes (`temporarily_unavailable`, `server_error`). Any other code, an unrecognised
   value, a non-string or an array gets no `reason` at all, so the page shows only its fixed text.
   `error_description` is never read for display. The sentences live in the handler's `en`/`cy` content, with the
   `cy` left in English for translation (the repo's practice; do not write Welsh). Confirm with `yarn welsh:check`
   that only the new strings are added. That needs the Welsh extractor working (admin#249); if it isn't on master
   yet, check the new pair by hand and say so in the execution notes.
2. Keep everything else in the branch exactly: the security event, the 403 status, and consuming the login flow.
3. **R14: documentation only.** Correct the `CLAUDE.md` sentence, the `.claude/rules/backend.md` row and any matching
   code comment. They should say that the 404 *view* reveals nothing about what was refused, and the gate fires before
   anything is looked up, so whether a particular resource exists is never disclosed. But the 403 *status* does show
   that the area exists and the caller may not enter it: a deliberate choice, pinned by the e2e specs. Do not change
   `src/errors.ts`'s behaviour or any test's expected status.
4. **Out of scope:** the other review findings, the 403 template's own hardcoded English, IDAM configuration.
5. Work test first for R10. Local task commits are appropriate; publishing is separate.

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

### Task 1: The callback shows only this app's own words (R10)

**Files:** `src/pages/oauth2/callback.ts` and its tests (handler, and a template test rendering the real
`errors/403.njk`).

- [x] Record the execution baseline in the execution notes.
- [x] Add failing tests, with a login flow on the session:
  - a synthetic marker in `error_description` never appears in the HTML;
  - an unrecognised `error` (including a marker), an `error` with characters outside the code pattern, and a
    repeated `error` or `error_description` (arrays) all render the page with no `reason`;
  - `access_denied` and `temporarily_unavailable` render their fixed sentences;
  - the security event and the 403 status are unchanged in every case.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: Describe the 403 accurately (R14)

**Files:** `CLAUDE.md`, `.claude/rules/backend.md`, and `src/errors.ts`'s comment if it repeats the claim.

- [x] Correct the wording as described in the Development Approach. **Reference this plan by its
      `docs/plans/completed/` path**, since that is where it will be once the run ends.
- [x] Run all Validation Commands (no test changes are expected) and record the results.

### Task 3: Hand off

- [ ] Record final commits, changed files and test counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- No text from the IDAM redirect's query string ever appears on the page; known codes get this app's own sentences.
- The callback's security event, status and flow handling are unchanged.
- The docs describe exactly what a refused request reveals: the area, not the resource. No behaviour or expected
  status changed for R14.
- All Validation Commands pass with no new failures or skips.

## Execution notes

### Task 1 (R10)

- **Baseline:** branch `fix/r10-r14-error-disclosure` at `852db63` (the plan commit on `origin/master` `2a87bf5`),
  `REDIS_URL=redis://127.0.0.1:6379`. `yarn lint` clean (one Biome config-migration info, pre-existing), `yarn build`
  8/8 tasks, `yarn turbo test test:app --concurrency=1 --force` 8/8 tasks: app 123 files / 2601 tests, deed-poll
  68 / 1401, api-client 14 / 852, express-govuk-starter 12 / 127, cloud-native-platform 13 / 157,
  express-session-postgres 2 / 30, express-session-redis 1 / 7, simple-router 4 / 41. No failures, no skips.
- **Rechecked R10 at baseline:** the `error` branch rendered `req.query.error_description ?? req.query.error`.
  Confirmed by the new tests failing red: 15 failures across `callback.test.ts` and the new
  `callback.njk.test.ts` (marker text on the page, raw codes as `reason`). The repeated-`error` case already passed:
  an array is not a string, so it skips the refusal branch and ends on the exchange-failure 403 with no `reason`.
  That behaviour is kept and now pinned.
- **Implementation:** `src/pages/oauth2/callback.ts` maps `access_denied` to "Sign in was cancelled or refused." and
  `temporarily_unavailable`/`server_error` to one shared "not working at the moment" sentence, through a `Map` so a
  code such as `constructor` resolves to nothing. Every other value gets no `reason`; `error_description` is no
  longer read. The `en` pair has `cy = { ...en }` for translation. The security event, the 403 status and the flow
  consumption are unchanged and pinned (event outcome for a known, unknown and malformed code).
- **Welsh:** `src/pages/oauth2` was not in the extractor's `INCLUDE`, so it is added. `yarn welsh:check` still
  crashes on master (`scripts/extract-welsh-strings.mjs:185`, admin#249 not merged), so the new pair was checked by
  hand: two English keys, `accessDenied` and `unavailable`, mirrored by `cy`, and nothing else in the directory.
- **Green:** focused `src/pages/oauth2` 2 files / 40 tests. Full run: lint clean, build 8/8, tests 8/8 with app
  124 files / 2618 tests and every library count as at baseline. No failures, no skips. `yarn format` changed nothing.

### Task 2 (R14)

- **Rechecked R14:** `src/errors.ts` still answers every `ForbiddenError` with `res.status(403).render("errors/404")`.
  The "non-enumerable" / "discloses nothing" claim appeared in four places, not three: `CLAUDE.md` (Personas and role
  gating), the `forbidden` row of `.claude/rules/backend.md`, the comment in `src/errors.ts`, and
  `docs/ARCHITECTURE.md`'s Authorization paragraph. All four corrected.
- **Wording:** the 404 view says nothing about what was refused, and the gate fires before any lookup, so whether a
  particular resource exists is never disclosed. The 403 status does disclose that the area exists and is closed to
  the caller, which is deliberate and pinned by the e2e specs. `CLAUDE.md` and `backend.md` cite this plan at its
  `docs/plans/completed/` path. No behaviour, test or expected status changed.
- **Validation:** `yarn format` changed nothing, `yarn lint` clean (the same pre-existing info), build 8/8, tests 8/8
  with counts identical to Task 1: app 124 / 2618, deed-poll 68 / 1401, api-client 14 / 852, starter 12 / 127,
  cloud-native-platform 13 / 157, session-postgres 2 / 30, session-redis 1 / 7, simple-router 4 / 41. No failures,
  no skips.

## Post-Completion

Publishing, merging and deployment are separate from this plan.
