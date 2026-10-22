# Plan: dot-segment ids never reach an api path, and the observe-check script runs only the request it checked

## Overview

Address review findings **R11 (Lower)** and **R16 (Lower)** from the repeat quality and security review (workspace
`local-notes/deed-poll-admin/20261020-arbor-quality-security-review.md`):

- **R11:** the api client builds paths with `encodeURIComponent(id)`, which leaves dots alone, so an id of `.` or `..`
  (or an empty one) changes the path. `action=review:..` on the Gazette batch page sends `GET /caseworker/` with the
  caller's token, and the resulting 404 renders as a Gazette outage. A document download with `documentId=..` requests
  `GET /caseworker/cases/case-1/file`. Nothing wrong was served, the caller's own token is used, and browsers normalise
  dot segments, so only a hand-crafted request reaches this. It is hardening: no request with a dot-only segment
  should ever leave the adapter.
- **R16:** `scripts/rate-limit-observe-check.sh` (an operator tool from #198) validates the **first** `https://` URL
  anywhere in a copied curl command, then `eval`s the whole command. With a preview URL in a `Referer` header placed
  before the destination, a *send* command passes both guards, so an irreversible email send could be replayed by a
  tool that promises "Nothing is sent". A genuine browser "Copy as cURL" puts the destination first, so this needs an
  edited command.

## Context

Baseline: admin `origin/master` `3eb272d`. Read `CLAUDE.md` ("Redirect paths", "No data access layer", "Abuse
limits") and `.claude/rules/backend.md` first. Record the execution baseline and recheck both findings there.

### R11

- `libs/deed-poll-api-client/src/api/client.ts` has about 20 `encodeURIComponent(...)` path interpolations, some
  through helpers (`notePath`, `witnessPath`, `referralPath`, `emailsPath`, `emailTemplatePath`,
  `judicialReferralPath`, `savedQueryPath`, and the case, document and Gazette paths). The adapter **never throws**: it
  returns `ApiResult<T>`, and `callApi` turns `{ kind: "not-found" }` into `NotFoundError`.
- `src/path-segment.ts` already refuses empty, `.` and `..` for redirects and hrefs built in TypeScript, with a
  fixed-message `NotFoundError`. The adapter cannot import app code (package boundary), so it needs its own small
  equivalent.
- Callers observed in the review: `src/pages/deed-polls/gazette/batch.ts` `selectCases` (the `review:<id>` action),
  and the caseworker document route `src/pages/deed-polls/[id]/documents/[documentId]/file.ts`. The judicial routes
  already refuse first through `referralPath`/`pathSegment`.

### R16

- `scripts/rate-limit-observe-check.sh` reads a "Copy as cURL (bash)" file and checks two things with `grep`: that
  the first `https://` substring matches AAT admin's `/deed-polls/<id>/emails/<template>/preview`, and that a
  `--data*` option is present. It then runs the file through `eval` 35 times, counting statuses. It must never print
  the cookie, and the file holds a live session cookie.
- The script is documented in `docs/DEPLOYMENT.md` ("Checking the abuse limits in observe"). It ran successfully on
  2026-10-20 (35 previews, all 200, 7 `observe` lines per app); keep that use working.

Review evidence: `local-notes/deed-poll-admin/20261020-arbor-review-evidence/arbor-review-gazette.probe.test.ts`
("G01") and `arbor-review-output-documents.probe.test.ts` ("AO-D2") for R11. For R16 there's no probe: the review ran
the guard's lines on crafted files without executing curl.

## Development Approach

1. **R11: refuse dot-only segments once, in the adapter.** A small helper beside the path builders turns an id into a
   path segment, or reports that it cannot be one (empty, `.`, `..`). Every id interpolated into a path goes through
   it. An unusable id produces `{ ok: false, error: { kind: "not-found", status: 404, message: <fixed text> } }`
   **without sending any request**. The message is fixed and never includes the id. Ordinary ids (UUIDs, and any id
   with other characters, still encoded once as today) are unchanged. `contract.test.ts` and the mock must keep
   passing.
2. **R11: the Gazette review action renders "not found", not "unavailable".** Check how `batch.ts` classifies a
   `NotFoundError` from the case read today. A dot-only id (or any not-found case) on `review:<id>` must not render
   the Gazette-outage page or discard the visit's state as an outage would. Prefer the page's existing invalid or
   not-found handling; do not add new copy unless there is no fitting message.
3. **R16: run exactly the request that was checked.** Parse the copied command into an argument list (for example with
   Python's `shlex` via `python3 -I`, which the devcontainer and macOS both have), and accept it only if:
   - its first word is `curl`;
   - it has exactly one URL argument (positional, or via `--url`), and that URL matches the preview pattern;
   - every other `https?://` value sits inside a `-H`/`--header` value for `Referer`, `Origin` or similar request headers, never as a second URL;
   - there is no method override other than `POST` (`-X`/`--request`), no `-K`/`--config`, `--next`/`-:`, no output or
     upload options (`-o`, `-O`, `-T`, `--upload-file`), and no shell syntax (the parser refuses unbalanced quotes,
     and any `;`, `|`, `&`, `$(`, backtick or redirection outside quotes is refused);
   - it has a form body (`--data*`).

   Then run that argument list directly (an array, no `eval`), appending the existing `--silent --output /dev/null
   --write-out '%{http_code}'`. Never echo the arguments, the cookie or the body. Keep the window-alignment logic, the
   request count limits and the summary output exactly.
4. **R16: a test for the guard.** Add a test that runs the script's parser on crafted files and checks what it refuses:
   a Referer-first send, a second URL, a `-X GET`, `-K`, `--next`, an `-o`, shell syntax, no body. It must also accept a
   genuine browser-shaped preview copy. Do this without making any network request. Split the parser into a small
   function or mode (for example `--check-only`) the test can call, rather than running curl.
5. **Out of scope:** the other review findings, `src/path-segment.ts`'s behaviour, template hrefs, the rate limits
   themselves. No new dependency.
6. Work test first. Local task commits are appropriate; publishing is separate.

## Validation Commands

Run from the admin repository root before implementation and after each task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Use installed dependencies and local Redis. Never flush Redis: it is shared. Record actual counts, failures and
skips; distinguish baseline failures from regressions, and inspect formatting diffs. **Never run the observe-check
script against AAT or any live host**, and never with a real cookie: tests use crafted files and make no request.

Run every build and test command in the foreground and wait for it to finish. A backgrounded build ends the
session and the next one builds over it, wiping the results.

## Implementation Steps

### Task 1: No dot-only segment leaves the adapter (R11)

**Files:** `libs/deed-poll-api-client/src/api/client.ts` and its tests; `src/pages/deed-polls/gazette/batch.ts` and
its tests if its classification needs changing; the caseworker document route's test.

- [x] Record the execution baseline in the execution notes.
- [x] Add failing tests, against a local server that records request paths:
  - for every adapter function that takes an id, `""`, `"."` and `".."` produce a not-found result with no request
    made;
  - an ordinary id still requests exactly today's path;
  - the Gazette `review:..` action renders the not-found or invalid state, not the outage page;
  - the caseworker document download with `documentId=..` or `id=..` answers 404 with no api request.
- [x] Implement, run focused tests and all Validation Commands, and record the results.

### Task 2: The observe-check script runs only what it checked (R16)

**Files:** `scripts/rate-limit-observe-check.sh`, a small parser beside it if that is cleaner, and a test for it
(a `*.test.ts` that spawns the parser on crafted files, under `src/` like `src/welsh-extractor.test.ts`, or beside the
script if the root vitest config picks it up).

- [ ] Add failing tests for each refusal listed in the Development Approach, plus one accepted browser-shaped preview
      copy, with no network request.
- [ ] Implement, run focused tests and all Validation Commands, and record the results.

### Task 3: Record the rules and hand off

**Files:** `CLAUDE.md`, `docs/DEPLOYMENT.md`, this plan.

- [ ] `CLAUDE.md` "Redirect paths": the adapter refuses empty and dot-only ids itself, so no api request carries one.
      `docs/DEPLOYMENT.md`'s observe-check section: the script parses the copied command and runs exactly the checked
      preview request, never `eval`. **Reference this plan by its `docs/plans/completed/` path**, since that is where it
      will be once the run ends.
- [ ] Record final commits, changed files and test counts in the execution notes.
- [ ] Run all Validation Commands and hand off to the Ralphex review phases.

## Acceptance Criteria

- No api request is ever sent with an empty, `.` or `..` path segment; such ids are a not-found result, and ordinary
  ids are unchanged.
- The Gazette review action and the caseworker download never show an outage for a dot-only id.
- The observe-check script refuses any command whose single destination is not a preview POST to AAT admin, and runs
  exactly the checked argument list without `eval`. A genuine copied preview still works.
- All Validation Commands pass with no new failures or skips.

## Execution notes

### Baseline (2026-10-22)

Branch `fix/r11-r16-path-segments-and-observe-guard` at `7707dfa` (plan commit on `origin/master` `3eb272d`),
`REDIS_URL=redis://127.0.0.1:6379`. `yarn lint`: 523 files, no fixes, one Biome info (configuration migrate notice).
`yarn build`: 8/8 tasks. `yarn turbo test test:app --concurrency=1 --force`: 8/8 tasks, no failures or skips reported —
app 125 files / 2619 tests, deed-poll 68 / 1401, deed-poll-api-client 14 / 852, express-govuk-starter 12 / 127,
cloud-native-platform 13 / 157, simple-router 4 / 41, express-session-postgres 2 / 30, express-session-redis 1 / 7.
Both findings rechecked at the baseline: `encodeURIComponent` built every id segment, and `review:..` reached
`findDeedPoll`, whose 404 `operationFailed` rendered as the outage page (503).

### Task 1 (R11)

- **Where the guard is.** One check in `exchange` (`hasUsableSegments` in `client.ts`), not a helper at each path
  builder as the Development Approach suggested. Every operation reaches `exchange` (through `request`, `send`,
  `requestNoContent`, `download` and `gazetteRequest`), and no fixed path contains an empty or dot segment, so such a
  segment can only have come from an id. Ids are encoded as before, so `%2E` is sent as `%252E`. An operation added
  later cannot skip the check. The result is `{ kind: "not-found", status: 404, message: "deed-poll-api path would
  contain an unusable id" }`, a fixed message that names no id, and no request is sent.
- **Red.** `client-path-segments.test.ts` against a server recording every path: 111 cases (each of the 36
  id-taking operations, each id position, `""`/`.`/`..`) failed before the guard, because each sent a request.
  The 37 ordinary-id path tests and the encoding test passed before and after. With the guard disabled, the
  document-route cases failed (4) and the Gazette cases rendered 503.
- **Gazette.** `selectCases` now treats a `NotFoundError` from the `review:<id>` read as the existing `invalid`
  state, rendered with the visit's selection kept (400). That covers both a dot-only id and a case api no longer
  has. No new copy. The other steps' `operationFailed` is unchanged.
- **Document route.** No handler change. The route's new tests run the real domain and adapter, and
  `documentId=..`, `id=..`, `.` and `""` reject with `NotFoundError` (which `src/errors.ts` renders as the 404 page)
  and send no request.
- **Green.** `yarn lint` clean (same one info), `yarn build` 8/8, tests 8/8: app 125 / 2627 (+8), deed-poll-api-client
  15 / 1039 (+187), others unchanged. `yarn format` changed only this task's files.

## Post-Completion

Publishing, merging and deployment are separate from this plan.
