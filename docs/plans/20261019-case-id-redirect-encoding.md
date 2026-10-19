# Plan: encode case IDs in admin redirects

## Overview

Keep case IDs as one URL path segment when the admin application redirects a browser. Apply this consistently
to case redirects throughout `src/pages/deed-polls`, including IDs returned by the API. Judicial referral
redirects in `src/pages/judicial/referrals/[referralId]/` get the same dot-segment guard (Task 5, added
2026-10-19 at the plan author's request after Fortify instance `2950F280FFBEA2323139B0FEC2DF034A`). Normal case IDs retain
their existing destinations, status codes, query markers and tab fragments.

This is defensive hardening following Fortify findings `14866335BEE273FA5B5E940E5044A8BA` and
`250FCCE3CA8D832C8F3F69CF2AE609E4`. Neither reported external redirect was reproducible: both destinations have
a fixed `/deed-polls/` prefix. Unencoded IDs can nevertheless alter the internal path, query or fragment.
Describe the change accurately; do not claim a confirmed external open redirect or a clean Fortify retest.

Scope chosen for this handoff: the consistent admin case-redirect sweep (estimated 2–4 hours), rather than
only the two reported files. This document is the deliverable of the planning session; implementation is pending.

## Context

Baseline inspected: admin `master`, `f30a8c4b9ea18b44bbdb39b347468f53b4349803`. The two reported source files match
the scan archive from `1b3b22cbf562e5e89818f4ac1944a8111d0f987d` byte for byte. Recheck paths against the execution
branch; other agents may have advanced the repository.

Read `CLAUDE.md`, `.claude/rules/backend.md`, `.claude/rules/frontend.md` and `.claude/rules/testing.md` first.
Existing page tests use `src/express-doubles.ts` and mock domain operations while keeping schemas/view models real.
`src/errors.ts` already renders `NotFoundError` as 404. Utility modules belong outside `src/pages`, where
the file-based router would otherwise discover them as routes.

Initial inventory (line numbers are baseline references, not stable identifiers):

| Files relative to `src/pages/deed-polls/` | Redirect cases |
|---|---|
| `[id]/edit/[tab].ts` | POST success; GET legacy referral tab |
| `[id]/referrals/[referralId]/confirmation.ts` | POST success, conflict, and re-render guard; GET guard |
| `[id]/referrals/[referralId]/close.ts` | GET guard; POST success and conflict |
| `[id]/referrals/[referralId]/withdraw.ts` | POST success and conflict |
| `[id]/referrals/new.ts` | POST success |
| `[id]/notes/new.ts`, `[id]/notes/[noteId]/edit.ts` | Create, cancel and save branches |
| `[id]/witnesses/new.ts`, `[id]/witnesses/[witnessId]/edit.ts` | Create, cancel and save branches |
| `[id]/documents/upload.ts` | Successful upload |
| `[id]/emails/[template]/send.ts` | Sent/already-sent markers and email ID query value |
| `new.ts` | API-returned `created.id` |
| `index.ts` | API-returned `results.referenceMatch` |

The confirmation finding's sink is **line 136**, inside `awaiting()`, reached from POST through `rerender()`
when the fresh referral no longer needs an answer. The success and conflict sinks are lines 113 and 107.
Do not test only the successful POST and claim the reported path is covered.

Optional local reproduction evidence lives outside this clone, under workspace `local-notes/`:
`fortify-1486633.test.ts`, `fortify-1486633-evidence.json`, `fortify-250FCCE.test.ts` and
`fortify-250FCCE-evidence.json` (each test has a matching `.config.mjs`). These exercised the actual handlers
and Express redirects in Chromium, with domain I/O mocked and authentication omitted. The first ran 36
navigations; the second ran 144, including 72 through confirmation line 136. No external requests occurred.
They are historical evidence, not portable test dependencies or full-application security verification.

## Development Approach

Implement these decisions; keep the change small:

1. Introduce one app-owned function, `casePath(caseId: string): string`, in `src/case-path.ts`. It returns
   `/deed-polls/` plus `encodeURIComponent(caseId)`. Use it wherever a case ID contributes to a redirect
   destination, directly or through a referral path helper. No generic redirect wrapper, URL framework or
   new dependency is needed.
2. Reject empty IDs and the exact values `.` and `..` with `NotFoundError` and a fixed message containing no
   submitted value. `encodeURIComponent` leaves dots unchanged, and browsers normalise dot-only segments;
   substituting `%2E` does not solve that. Do not introduce a UUID-only rule: existing fixtures use `case-1`,
   and API identity validation remains the API's responsibility.
3. For request-supplied IDs, construct the case path before any mutation, so rejecting these invalid IDs
   cannot follow a successful write. Keep passing the original, decoded ID to domain functions. For an
   API-returned ID, construct the path after the response; an invalid response must not trigger an automatic
   retry of creation or any other write.
4. Encode each ID once from its semantic value. Express has already decoded route parameters. Do not call
   `decodeURIComponent` again, encode the whole URL, or mutate `req.params`. A literal `%2F` in the decoded
   ID becomes `%252F` in the URL; that preserves the literal ID and is intentional.
5. Preserve existing encoding of referral IDs and query values, fixed fragments, tab allowlists, redirect
   status codes, API call counts, conflict handling, authentication and CSRF boundaries. Existing referral
   path helpers also supply form/back links: updating their shared base is appropriate and their consumers
   must remain coherent.
6. Scope ends at case-ID construction for redirects and those shared helper consumers. Do not sweep all
   templates, rewrite OAuth/login/logout redirects, change already-encoded Gazette/query/judicial paths,
   alter API contracts, or change the API repository. This is not a general audit of every identifier.
   **Exception, added 2026-10-19:** the judicial referral redirects in `direction.ts` and `claim.ts` are in
   scope as Task 5. They already encode once; what they lack is the empty/`.`/`..` refusal.
7. Use test-first changes. Complete and validate each task before the next. Use a feature branch or isolated
   worktree and preserve other agents' work. Record the starting commit as the review base so Ralphex reviews
   this change rather than an unrelated or empty diff. Local task commits are appropriate; publishing,
   merging, deployment and the later Fortify retest are outside this execution plan.

## Validation Commands

Run from the admin repository root after every task:

```bash
export REDIS_URL=redis://127.0.0.1:6379
yarn lint
yarn build
yarn turbo test test:app --concurrency=1 --force
```

Ensure local Redis is available (reuse the running instance; otherwise `docker compose up -d redis`). Confirm
`src/session-store.test.ts` actually ran, since it can skip when Redis is unavailable. Use the installed Yarn
dependencies, not an `npx` invocation that may fetch a different tool. Run commands in the foreground and
record actual failures/skips/counts. Establish the baseline before implementation; distinguish unrelated
baseline failures from regressions. Resolve new lint warnings as well as errors. Follow the repository's
formatting requirements and inspect any formatting diff for unrelated changes.

During each task, run its quoted literal test-file paths with `yarn vitest run` for the red/green cycle;
shell-quote paths containing `[id]`, `[tab]` or `[referralId]`. The full commands above are the completion gate.

## Implementation Steps

### Task 1: Case path contract and the two reported routes

**Files:** create `src/case-path.ts` and `src/case-path.test.ts`; modify
`src/pages/deed-polls/[id]/edit/[tab].ts`,
`src/pages/deed-polls/[id]/referrals/[referralId]/confirmation.ts`, and their colocated `.test.ts` files.
Read `src/errors.ts` and `src/express-doubles.ts` for existing conventions.

- [x] Recheck the initial redirect inventory using `rg -n 'redirect\(' src` and trace helper-produced destinations;
      record any additional case-ID redirect call sites in this plan's execution notes.
- [x] Write failing tests for the path contract, then implement `casePath` using decisions 1–4. Assert literal
      expected strings, not an expectation calculated using the same encoder as the implementation.
- [x] Cover ordinary/UUID IDs, slash, backslash, `?`, `#`, `%`, spaces, Unicode, CR/LF, absolute/protocol-relative
      URL text, traversal containing slashes, and literal `%2F`/`%2e%2e`. Reject empty/dot-only IDs. For accepted
      IDs assert the resulting URL has the expected origin, no query or fragment, and one encoded ID segment.
- [x] Adopt the helper in both routes, constructing the case base before request-driven mutations. Keep
      domain calls supplied with the original ID. Test the edit POST and legacy GET redirect, confirmation
      success/conflict, GET guard, invalid-body re-render guard, and API-validation-error re-render guard.
- [x] Assert an invalid case ID produces no write and no redirect. Preserve unknown-tab rejection and existing
      normal-ID expectations. Run focused tests and all Validation Commands; record results.

### Task 2: Remaining referral actions

**Files:** `src/pages/deed-polls/[id]/referrals/new.ts`,
`src/pages/deed-polls/[id]/referrals/[referralId]/close.ts`,
`src/pages/deed-polls/[id]/referrals/[referralId]/withdraw.ts`, and their colocated tests.
Read `src/case-path.ts` and Task 1's confirmation tests for the established contract.

- [x] Add failing assertions for encoded case IDs on each redirect branch, including close's GET guard and
      conflict paths. Verify referral IDs remain encoded exactly once.
- [x] Use `casePath` in the existing referral destination helpers and direct case redirects; keep their
      shared back/form links consistent. Construct request-derived paths before any write.
- [x] Assert domain calls still receive raw IDs and invalid dot-only IDs do not invoke mutations. Retain
      existing normal-ID behaviour and API call counts.
- [x] Run focused tests and all Validation Commands; record results before proceeding.

### Task 3: Notes, witnesses, documents and email redirects

**Files:** `src/pages/deed-polls/[id]/notes/new.ts`, `[id]/notes/[noteId]/edit.ts`,
`[id]/witnesses/new.ts`, `[id]/witnesses/[witnessId]/edit.ts`, `[id]/documents/upload.ts`,
`[id]/emails/[template]/send.ts` (all paths after the first are relative to `src/pages/deed-polls/`),
and each file's colocated tests. Read `src/case-path.ts`.

- [x] Add failing handler tests for IDs containing a slash, query delimiter and fragment delimiter on all
      affected redirect branches, including cancel branches. Reuse the helper's exhaustive payload tests
      rather than duplicating that entire matrix in every page test.
- [x] Replace raw case-ID interpolation with `casePath`, computed before writes. Keep notes/witnesses/documents
      fragments and email's sent/already-sent marker, encoded email ID and emails fragment unchanged.
- [x] Assert the original case ID reaches domain operations, writes are not duplicated, and invalid dot-only
      IDs reach neither uploads/sends nor other mutations. Preserve existing validation/error behaviour.
- [x] Run focused tests and all Validation Commands; record results before proceeding.

### Task 4: API-returned case destinations and sweep completion

**Files:** `src/pages/deed-polls/new.ts`, `src/pages/deed-polls/index.ts`, their colocated tests, and any
additional case-ID redirect sites documented by Task 1. Read `src/case-path.ts`.

- [x] Add failing tests for `created.id` and `results.referenceMatch` containing URL delimiters. Apply the same
      helper to both destinations; API-returned identifiers also require encoding at the browser boundary.
- [x] Cover invalid returned IDs and confirm no retry/second create occurs; normal create and reference-match
      redirects retain their exact destinations. Keep list-filter/query-string redirects unchanged.
- [x] Repeat the source inventory, including helper-produced paths. Account for each case-ID redirect as
      updated or already safe, recording concrete paths in execution notes rather than relying on a text
      search alone. Do not expand this into a template or authentication refactor.
- [x] Run focused tests and all Validation Commands; record results before proceeding.

### Task 5: Judicial referral redirects

Added 2026-10-19 at the plan author's request. Defensive hardening: Fortify instance
`2950F280FFBEA2323139B0FEC2DF034A` did not reproduce an external redirect (evidence in workspace
`local-notes/fortify-2950F28-evidence.json`, historical only; do not import it). `referralHref()` in `direction.ts`
and `referralPath()` in `claim.ts` already apply `encodeURIComponent` once, but that leaves `.` and `..` unchanged,
and a browser resolves those to a parent path inside this application.

**Files:** create `src/judicial-referral-path.ts` and `src/judicial-referral-path.test.ts` (outside `src/pages`, so
the router does not discover it); modify `src/pages/judicial/referrals/[referralId]/direction.ts`,
`src/pages/judicial/referrals/[referralId]/claim.ts`, and their colocated `direction.test.ts` and `claim.test.ts`.
Read `src/case-path.ts` and its test first, and mirror that contract rather than inventing a second one.

- [x] Write failing tests first for a `referralPath(referralId: string): string` helper returning
      `/judicial/referrals/` plus `encodeURIComponent(referralId)`: literal expected strings for ordinary/UUID IDs
      and delimiter payloads (slash, `?`, `#`, `%`, literal `%2F`), and `NotFoundError` with a fixed message for
      empty, `.` and `..`. Implement it, then replace both private helpers with it. Encode exactly once; do not
      decode again, encode the whole URL, or mutate `req.params`.
- [x] Refuse an unusable referral ID before any API read or write: build the referral path at the top of
      `claim.ts`'s POST and of `direction.ts`'s GET and POST (including the `held()` read), before `getReferral`,
      `claimReferral` or `recordDirection` is called. Keep passing the original, decoded ID to domain functions.
- [x] Test, in `direction.test.ts`: the GET guard redirect in `held()` (`?direction=notheld` when the referral is
      not directable, baseline line 236), the POST success (`?direction=recorded`) and conflict
      (`?direction=notheld`) branches, each with a delimiter-bearing ID asserting the literal encoded `Location`.
      In `claim.test.ts`: success and conflict (`?claim=held`); the not-found branch's pool redirect is unchanged.
      Keep the rendered `referralHref`/`directionHref` links coherent with the same helper.
- [x] Assert that `.`, `..` and empty IDs produce `NotFoundError` with no API call (read or write) and no redirect,
      and that normal-ID destinations, query markers and API call counts are unchanged.
- [x] Run focused tests and all Validation Commands; record results before proceeding.

### Task 6: HTTP regression evidence and handoff

**Files:** add `src/case-redirects.test.ts`; update `CLAUDE.md` with a short construction rule and this plan's
Execution notes. Read the two reported handlers and the existing page tests. The optional local reproduction
files in Context can inform the test but must not be imported or required by committed tests.

- [x] Add a portable Vitest/Express integration test using existing Supertest: exercise the actual edit and
      confirmation handlers with domain I/O mocked and no live API. Send percent-encoded request paths so
      Express's decoding and the real `Location` header are tested, not only response doubles.
- [x] Include confirmation's exact line-136 guard path and success/conflict paths. Assert literal encoded
      `Location` values, preserved deliberate query/fragment suffixes, no raw header controls, and no change
      of origin after URL resolution. Demonstrate that delimiter payloads fail the new expectations on the
      baseline; merely asserting same-origin would pass before the fix and would not prove the hardening.
- [x] Test dot-only rejection directly at the handler/helper boundary as well: HTTP clients can normalise
      dot segments before the handler sees them. State this limitation rather than claiming a request
      reached a route it never exercised. Cover literal percent sequences without a second decode.
- [x] Document the `casePath` rule and the judicial `referralPath` helper (Task 5), raw-ID domain calls, dot-only
      rejection and single encoding in `CLAUDE.md`.
      Record changed files, starting/final commits, red/green evidence, test counts, skips and limitations in
      Execution notes. Do not copy machine-specific evidence files into the repository.
- [x] Run all Validation Commands. Leave the implementation ready for the normal Ralphex review phases;
      record review outcomes and rerun validation if review fixes change code before declaring completion.
      (Review outcomes are deferred to Ralphex's review phases, which run after the task loop.)

## Acceptance Criteria

- Every case-ID redirect identified by the inventory uses the same encoding contract, whether the ID comes
  from request parameters or an API response.
- Supported IDs containing URL delimiters remain one path segment; empty and dot-only case IDs cannot
  produce a redirect. Original IDs, not URL-encoded strings, reach domain/API operations.
- Valid-ID behaviour, intentional queries/fragments, status codes and write counts remain unchanged.
- Both Fortify-reported paths have regression coverage proving the additional hardening.
- Judicial referral redirects in `direction.ts` and `claim.ts` share one helper outside `src/pages`, which refuses
  empty, `.` and `..` IDs before any API call and otherwise encodes once (Fortify `2950F280FFBEA2323139B0FEC2DF034A`).
- Tests and review evidence describe this as internal URL-construction hardening, not proof that all
  redirects are safe or that Fortify will suppress the findings.

## Execution notes

Planning only, 2026-10-19. No implementation, new test execution or Ralphex run has been performed for this plan.
The existing browser evidence described in Context predates the proposed change. The executing agent should
append baseline, per-task validation and final review results here.

Review base (starting commit): `0dd4b98b4e79a936e534eab671a118523db2d1dc` on branch `case-id-redirect-encoding`.

Baseline, before any change (Redis on 6379 reachable): `yarn lint` clean apart from Biome's pre-existing
"run biome migrate" info; `yarn build` passed; `yarn turbo test test:app --concurrency=1 --force` passed — app
100 files / 1897 tests, `src/session-store.test.ts` ran 7 tests; libraries deed-poll 1183, deed-poll-api-client
718, cloud-native-platform 157, express-govuk-starter 127, simple-router 41, express-session-postgres 23,
express-session-redis 7. No baseline failures or skips.

Task 1 inventory recheck (`rg -n 'redirect\(' src`, then helper tracing). The table in Context is complete for
redirects. Additional case-ID **link** constructions found, none of them redirect destinations:
- `[id]/referrals/new.ts` `openReferralHref` builds `/deed-polls/${id}#referrals` and
  `/deed-polls/${id}/referrals/${live.id}` (live referral id unencoded) for the 409 re-render's link — a shared
  helper consumer in a Task 2 file; adopt `casePath` there with the redirect.
- `[id]/referrals/[referralId].ts` `referralHref` builds the referral page's own links; it is not a redirect.
- `[id].ts` builds the email-banner link `/deed-polls/${id}/emails/…`; a rendered link, out of scope (decision 6).
Judicial, Gazette, saved-query, login/logout and session redirects use no case id or already encode theirs.

Task 1 result: added `src/case-path.ts` (`casePath`, refusing `""`, `.`, `..` with a fixed-message
`NotFoundError`) and adopted it in `[id]/edit/[tab].ts` (legacy GET, POST computed before `updateDeedPoll`) and
`[id]/referrals/[referralId]/confirmation.ts` (`referralHref` now built on `casePath`; POST computes it before
`recordConfirmation`, `awaiting` before its reads, so the line-136 guard reached through `rerender` uses it).
Red: the helper suite failed to load without the module; all 20 new route tests failed against the raw
interpolation. Green: focused run 3 files / 114 tests. Full validation: lint clean (same info), build passed,
app 101 files / 1948 tests, session-store 7 tests ran, libraries unchanged and passing, no skips.

Task 2 result: adopted `casePath` in `[id]/referrals/new.ts` (POST computes the case base before
`createReferral`; `openReferralHref` takes it, so the 409 re-render's link and its referrals-tab fallback share
it), `[referralId]/close.ts` (`referralHref` built on `casePath`; GET builds it before its reads so the
not-`Decided` guard uses it, POST before `closeReferral`) and `[referralId]/withdraw.ts` (case base before
`withdrawReferral`; its `referralPath` helper folded into the conflict redirect). One deliberate change beyond
the case id: `openReferralHref` now encodes the API-returned live referral id, which was interpolated raw, so
every referral id on these pages is encoded exactly once. `referral-form.njk`'s form action and cancel link
still build from `case.id` in the template; that is a template sweep, out of scope by decision 6.
Red: all 21 new tests failed against the raw interpolation. Green: focused run 3 files / 84 tests. Full
validation: lint clean (same Biome migrate info), build passed, app 101 files / 1969 tests, session-store
7 tests ran, libraries unchanged and passing, no skips.

Task 3 result: adopted `casePath` in `[id]/notes/new.ts`, `[id]/notes/[noteId]/edit.ts`, `[id]/witnesses/new.ts`,
`[id]/witnesses/[witnessId]/edit.ts`, `[id]/documents/upload.ts` and `[id]/emails/[template]/send.ts`. Each POST
handler (the upload's post-parser handler) computes the case base first, before validation and before any write:
the two edit pages' delete branch therefore uses it too, as does email's `loadEmailJourney` read. None of these
handlers has a server-side cancel branch — cancel is a rendered link, out of scope by decision 6 — so the
delete branches are the extra redirect branches covered. Fragments (`#notes`, `#witnesses`, `#documents`),
email's `sent`/`already-sent` marker, its `encodeURIComponent(sent.id)` value and `#emails` are unchanged.
Tests use `a/b?c#d` (slash, query and fragment delimiters) on every redirect branch, assert the raw id reaches
the domain exactly once, and assert `""`, `.` and `..` 404 with no write and no redirect.
Red: all 27 new tests failed against the raw interpolation, every one on an assertion. Green: focused run
6 files / 155 tests. Full validation: lint clean (same Biome migrate info), build passed, app 101 files /
1996 tests, session-store 7 tests ran, libraries unchanged and passing, no skips.

Task 4 result: adopted `casePath` for both API-returned destinations — `new.ts` builds it from `created.id`
after `createDeedPoll` answers, and `index.ts` from `results.referenceMatch` after `findDeedPolls` answers. An
unusable returned id (`""`, `.`, `..` for create; `.`, `..` for the match, since an empty match is falsy and
already renders the list) throws `NotFoundError` with exactly one create/read and no redirect or retry. The
list's builder/filter redirect (`caseListSearch`) is unchanged.
Final inventory (`rg -n 'redirect\(' src`, excluding tests, then tracing each `caseHref`/`href`): every case-ID
redirect now goes through `casePath` — directly in `new.ts`, `index.ts` and `[id]/edit/[tab].ts`; via
`caseHref = casePath(req.params.id)` in notes new/edit, witnesses new/edit, documents upload, emails send,
referrals new, withdraw and edit POST; via `referralHref` built on `casePath` in confirmation and close.
Already safe and unchanged: Gazette batch (encoded batch id), saved queries (encoded query id, fixed library
path, `caseListSearch`), Gazette settings (fixed path), login/logout/oauth/session/refresh (fixed paths,
`safeReturnTo`, encoded `returnTo`), switch-persona and `/` landing (fixed paths), judicial direction/claim
(encoded once; dot-segment refusal is Task 5). Remaining raw case-id interpolations are rendered links, not
redirects: `[id].ts` email-banner href and `[id]/referrals/[referralId].ts` `referralHref` (out of scope,
decision 6, as recorded in Task 1).
Red: all 7 new tests failed on assertions against the raw interpolation. Green: focused run 2 files / 155
tests. Full validation: lint clean (same Biome migrate info), build passed, app 101 files / 2003 tests,
session-store 7 tests ran, libraries unchanged and passing, no skips.

Task 5 result: added `src/judicial-referral-path.ts` (`referralPath`, `casePath`'s contract under
`/judicial/referrals`, refusing `""`, `.`, `..` with the fixed-message `NotFoundError` "Referral id is not a usable
path segment") and replaced both private helpers with it. `claim.ts` builds the path at the top of POST, before
`claimReferral`; `direction.ts` builds it at the top of POST, before validation, `held()` and `recordDirection`, and
`held()` builds it before `getReferral`, so GET (which starts with `held()`) refuses before its read. The rendered
`referralHref`/`directionHref` links use the same helper. The pool redirect for a claim 404 is unchanged.
Red: the helper suite failed to load without the module, and all 18 new dot-only page tests (3 in claim, 15 in
direction across form/invalid/change/check/confirm) failed. The new delimiter tests (`a/b?c#d`, literal `%2F`) passed
on the baseline as well, as expected: both files already encoded once, and those tests pin that they still do via
the helper. Green: focused run 3 files / 92 tests. Full validation: lint clean (same Biome migrate info), build
passed, app 102 files / 2050 tests, session-store 7 tests ran, libraries unchanged and passing, no skips.

Task 6 result: added `src/case-redirects.test.ts` (71 tests), a Supertest run of the real edit and confirmation
handlers on a minimal Express app — urlencoded body parsing, a session double carrying only the access token, and a
`NotFoundError`-to-404 handler; domain I/O mocked, no live api, no session store, authentication or CSRF gate.
Requests send percent-encoded paths, so Express's decoding and the `Location` Node writes are both exercised. Eight
payloads (slash/`?`/`#`, backslash, protocol-relative and absolute URL text, `../` traversal, CR/LF, literal `%2F`,
literal `%2e%2e`) run through edit's legacy GET and POST, and confirmation's GET guard, POST success, POST conflict,
the reported line-136 guard via the invalid-body re-render, and the same guard via api's-rejection re-render. Each
asserts the literal `Location`, no header control characters, and that it resolves on the origin to exactly the
expected path, query (`?confirmation=…`) and fragment (`#referrals`, `#<tab>`); each also asserts the raw decoded id
reached the domain exactly once. A further eight tests show each payload's raw interpolation resolves elsewhere, so
same-origin alone could not have proven the fix. Added the "Redirect paths" section to `CLAUDE.md`.
Red: with the two handlers restored from `0dd4b98` (then restored to HEAD), 59 of 71 failed — every delimiter case
on both routes and the three boundary tests. The 12 that passed are the 8 payload proofs, the 2 normal-id
destinations, and the 2 HTTP dot-only tests below.
Limitation found and recorded in the test: `%2E` and `%2E%2E` cannot reach a handler over HTTP. The WHATWG URL
parser Supertest uses resolves them as dot segments (`/deed-polls/%2E%2E/edit/notes` is sent as `/edit/notes`), so
no case route matches. Those two tests now pin "never reaches a handler", pass on the baseline too, and are not
claimed as evidence. The dot-only refusal is proven by the handler-boundary test (`""`, `.`, `..` against edit POST
and confirmation GET/POST: `NotFoundError`, no read, no write, no redirect) and by `src/case-path.test.ts`.
The local evidence files in `local-notes/` were neither imported nor copied.
Full validation: lint clean (same Biome migrate info), build passed, app 103 files / 2121 tests, session-store
7 tests ran, libraries deed-poll 1183, deed-poll-api-client 718, cloud-native-platform 157, express-govuk-starter
127, simple-router 41, express-session-postgres 23, express-session-redis 7; no failures or skips.
Commits: review base `0dd4b98b4e79a936e534eab671a118523db2d1dc`; Tasks 1–5 end at `6fe8e69`; Task 6 is the commit
after it. The branch changes 36 files plus this test: the two helpers and their tests, the thirteen
`src/pages/deed-polls` handlers in the inventory, the judicial claim and direction handlers, their colocated tests,
`CLAUDE.md` and this plan. Review outcomes: not run in this iteration. Ralphex's review phases follow
the task loop, and their findings and any revalidation are recorded by that phase.

## Post-Completion

Hand the reviewed branch and evidence to Steve. Publishing/merging and a new Fortify ZIP/retest are separate
follow-up actions. Move the plan to `docs/plans/completed/` only when implementation and review are complete.
The runner should use the recorded starting commit as its explicit review base; do not accept a clean review
of an empty diff. Do not start Ralphex as part of authoring this plan.
