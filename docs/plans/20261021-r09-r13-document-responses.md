# Plan: tighten the document relay's inline rule, and keep api's text off the upload page

## Overview

Address review findings **R09 (Lower)** and **R13 (Lower)** from the repeat quality and security review (workspace
`local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`). Both are in the caseworker and judicial
document paths:

- **R09:** `src/document-response.ts` keeps api's `inline` disposition whenever the forwarded Content-Security-Policy
  has a `sandbox` without `allow-scripts`, whatever the content type. `text/html` with
  `sandbox allow-same-origin allow-forms allow-popups allow-top-navigation` is therefore forwarded inline. That policy
  replaces helmet's, so there is no `default-src` and no `form-action`. And `allow-same-origin` removes the unique
  origin the docblock relies on, so a form in such a document would post with `Sec-Fetch-Site: same-origin`, which
  `requireSameOrigin` admits. Today api pairs `inline` with `default-src 'none'; sandbox` for PDF, JPEG and PNG, so
  this matters only if api is loosened or a proxy rewrites headers, which is exactly the case the guard exists for.
- **R13:** the upload page (`src/pages/deed-polls/[id]/documents/upload.ts`) renders a `NotFoundError`'s message
  against the "Document type" field. That's api's 404 text, or the adapter's "deed-poll-api answered 404". The same
  file already logs rather than renders api wording for refusals that name no field.

## Context

Baseline: admin `origin/master` `25d5053`. Read `CLAUDE.md` (the judicial documents paragraph and "Security events")
and `.claude/rules/backend.md` / `frontend.md` first. Record the execution baseline and recheck both findings there.

- `src/document-response.ts`: `sendDocument` sets `Content-Type`, `nosniff` and the disposition. A private helper
  decides whether api's `inline` survives (around line 61), using `isInertPolicy` (around line 83). Both the caseworker
  route (`src/pages/deed-polls/[id]/documents/[documentId]/file.ts`) and the judicial route
  (`src/pages/judicial/referrals/[referralId]/documents/[documentId]/file.ts`) use it.
- What api sends today, per the docblock and existing tests: `inline` for PDF, JPEG and PNG, with
  `Content-Security-Policy: default-src 'none'; sandbox`. Verify against api's `origin/master` (read only, the
  `deed-poll-api` clone's `origin/master` ref; search for where the download sets its disposition and policy) and
  record what you found.
- `src/pages/deed-polls/[id]/documents/upload.ts`: an `InvalidInputError` naming no field already logs api's wording
  through `forLog` and renders the page's own `en.uploadRefused`. A `NotFoundError` renders `error.message` against
  `documentTypeId`.
- `src/for-log.ts` bounds and cleans text for logs; it is not a privacy filter.

Review evidence (portable reproductions to adapt into real tests; do not import workspace files):
`local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-output-documents.probe.test.ts`, tests
"AO-D1" (R09) and "AO-D3" (R13).

## Development Approach

1. **R09: `inline` survives only when all three hold:**
   - the content type is on an allowlist (PDF, JPEG, PNG, compared case-insensitively on the media type, ignoring
     parameters);
   - the forwarded policy has a `sandbox` directive with **no** `allow-*` token;
   - it has `default-src 'none'`.

   Anything else becomes `attachment`, keeping api's filename parameter as the current downgrade does. Today's
   PDF/JPEG/PNG case under `default-src 'none'; sandbox` must still render inline, exactly as now. Keep the policy and
   `nosniff` forwarding as they are. Update the docblock so it no longer claims that any `sandbox` gives a unique
   origin.
2. **R13: the page's own sentence.** On `NotFoundError`, render a fixed message against `documentTypeId` (for example
   "Select a document type from the list"), and log api's message through `forLog` with a fixed prefix, as the
   no-field `InvalidInputError` branch does. Add the new message as an `en`/`cy` pair, with the `cy` left in English
   for translation (the repo's practice for untranslated strings; do not write Welsh). Confirm `yarn welsh:check` changes
   only by the new string.
3. **Out of scope:** upload limits, api's content policy, any other route, and the other review findings. No new
   dependency.
4. Work test first. Local task commits are appropriate; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips; distinguish baseline failures from regressions, and inspect formatting diffs. Run `yarn welsh:check` before and
after (it exits 1 by design) and record both counts.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: Inline only for allowlisted types under a fully inert policy (R09)

**Files:** `src/document-response.ts` and its tests; the two `file.ts` routes' tests if their expectations change.

- [x] Record the execution baseline, `welsh:check` counts and the api verification in the execution notes.
- [x] Add failing tests:
  - `text/html`, `image/svg+xml` and an unknown type with `inline` and `default-src 'none'; sandbox` become `attachment`;
  - PDF with `inline` and `sandbox allow-same-origin` becomes `attachment`, and so does PDF with `sandbox` but no
    `default-src 'none'`;
  - PDF, JPEG and PNG (including `application/pdf; charset=binary` and upper-case types) with
    `default-src 'none'; sandbox` stay `inline`;
  - api's filename survives every downgrade.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: The upload page's own words for an unknown document type (R13)

**Files:** `src/pages/deed-polls/[id]/documents/upload.ts` and its tests (handler and template).

- [x] Add failing tests: a synthetic marker in api's 404 message (JSON and non-JSON) does not appear in the rendered
      HTML; the page's own sentence renders against `documentTypeId` with status 400; the marker appears in the
      log line, cleaned by `forLog`.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Record the rules and hand off

**Files:** `CLAUDE.md`, this plan.

- [ ] Add one or two sentences to `CLAUDE.md` beside the judicial documents paragraph: the relay renders `inline` only
      for PDF, JPEG and PNG under `default-src 'none'` and a bare `sandbox`, and downloads everything else. Also note
      that the upload page never renders api's 404 text. **Reference this plan by its `docs/plans/completed/` path**,
      since that is where it will be once the run ends.
- [ ] Record final commits, changed files, test counts and `welsh:check` counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- No document is ever served `inline` unless it is PDF, JPEG or PNG under a policy with `default-src 'none'` and a
  `sandbox` with no `allow-*` token. Today's api responses render exactly as before.
- The upload page never shows api's or the adapter's 404 wording; it shows its own sentence and logs api's.
- All Validation Commands pass with no new failures or skips.

## Execution notes

### Baseline (Task 1)

- Admin baseline `660cc84` (plan commit on `origin/master` `25d5053`), branch `fix/r09-r13-document-responses`.
- `yarn lint`: clean (519 files after the change, 518 before; one pre-existing Biome config-migration info).
  `yarn build`: 8/8 tasks. `yarn turbo test test:app --concurrency=1 --force` with local Redis: all pass, no skips —
  app 2551, deed-poll 1401, api-client 852, cloud-native-platform 157, express-govuk-starter 127, simple-router 41,
  express-session-postgres 30, express-session-redis 7.
- `yarn welsh:check` **crashes at baseline** rather than reporting counts:
  `TypeError: Cannot read properties of undefined (reading 'ESNext')` at `scripts/extract-welsh-strings.mjs:185`.
  The extractor uses `typescript`'s JS compiler API (`ts.ScriptTarget`, `ts.createSourceFile`), which the TypeScript
  7.x upgrade (`64d20b8`, renovate) no longer provides. Pre-existing and outside this plan's scope; no counts can be
  recorded before or after until it is fixed.
- Both findings recheck at baseline: `isInertPolicy` asked only that no `sandbox` carry `allow-scripts`, whatever the
  type, and `upload.ts` rendered `NotFoundError.message` against `documentTypeId`.
- api verification (`deed-poll-api` `origin/master` `554fe49`, read only):
  `src/main/java/uk/gov/hmcts/reform/deedpoll/api/DocumentFileResponses.java` sets `inline` only when the bare
  `type/subtype` is in `INLINE_MIME_TYPES = Set.of("application/pdf", "image/jpeg", "image/png")`, `attachment`
  otherwise, and always sends `Content-Security-Policy: default-src 'none'; sandbox` (`INERT_CONTENT_POLICY`) and
  `X-Content-Type-Options: nosniff`. So the new rule leaves every response api sends today unchanged.

### Task 1 (R09)

- New `src/document-response.test.ts` (20 tests). Red before the change: 11 failed (HTML, SVG, unknown type, a
  type prefixed by an allowlisted one, six policy shapes and the filename-on-type-downgrade case), 9 passed.
- `containedDisposition` now keeps `inline` only for `application/pdf`, `image/jpeg`, `image/png` (media type
  compared lower-case, parameters ignored) under a policy whose every `sandbox` is bare and whose every
  `default-src` is exactly `'none'`. Downgrades keep api's parameters, filename included. Policy and `nosniff`
  forwarding unchanged. The docblock no longer says a sandbox merely without `allow-scripts` gives a unique origin.
- Green: the new file plus both routes' tests, 47/47. Full validation: lint clean, build 8/8, all suites pass with
  no skips, app 2571 (+20), others unchanged.

### Task 2 (R13)

- Three new handler tests in `upload.test.ts` and a new `src/pages/deed-polls/document-upload.njk.test.ts`
  (3 tests) rendering the real template. Red before the change: all 6 failed.
- On `NotFoundError` the page now renders its own `en.unknownDocumentType` ("Select a document type from the list")
  against `documentTypeId` with status 400, and logs
  `document upload refused an unknown document type: <api's message through forLog>`. `cy` is `{ ...en }`, so the
  new string is English in the `cy` shape awaiting translation, as the rest of the page is.
- Green: focused 33/33. Full validation: lint clean (520 files), build 8/8, all suites pass with no skips,
  app 2577 (+6), others unchanged.
- `yarn welsh:check` still crashes at `scripts/extract-welsh-strings.mjs` as at baseline, so the expected +1 string
  cannot be confirmed by count until the extractor is fixed.

## Post-Completion

Publishing, merging and deployment are separate from this plan.
