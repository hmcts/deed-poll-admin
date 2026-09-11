# Plan 04: hide the note delete control from caseworkers

## Overview

`deed-poll-api` is restricting note deletion to Administrators — see
`../../deed-poll-api/docs/plans/gate-note-deletion.md`. The business document is explicit: Basic Users
"cannot delete notes"; Administrators can.

This app currently shows **Delete note** to everybody. `src/pages/deed-polls/[id]/notes/[noteId]/edit.ts`
never reads the user at all — `userFromRequest` appears zero times in it — so once api starts refusing, a
caseworker who presses that button gets an `ApiResult` failure classified `forbidden`, which becomes
`ForbiddenError`, which this app renders as **403 on the 404 template**. So the caseworker's experience of a
correctly-enforced rule is a page that looks like the note went missing.

**This is cosmetic and must not delay the api change.** Server-side enforcement is the real control and
belongs first; a hidden button is not a security measure. This is the same shape as the privacy field, whose
lock was UI-only until 2026-08-10 and had to be enforced server-side too — except here the server is right
and the UI needs to catch up.

### Sequencing

Can be written and reviewed **before** api's gate merges, but the caseworker e2e assertion (task 4) only
becomes meaningful once it has. Safe to land first either way: hiding the button from a caseworker while api
still permits the call removes an affordance nobody is supposed to have.

## Decisions taken — implement these, do not revisit

1. **Hide the button, do not disable it.** The privacy field is *disabled* rather than hidden because its
   value still has to be readable — a locked select still tells you the case is Private. A button has nothing
   to read. A permanently disabled destructive control is noise on every note a caseworker ever opens, and it
   invites "why can't I press this" rather than answering it.
2. **Amending stays available to both roles.** The business splits edit from delete. Do **not** touch the
   "amend this note" link (`src/pages/deed-polls/[id].ts:39`), the textarea, or the **Save note** button. The
   tidy-minded mistake here is to gate the whole form.
3. **Derive from the session, not from api.** `userFromRequest(req).isAdmin` — the roles are already in the
   session from IDAM's `/o/userinfo`, so this costs no round trip. This is **not** a breach of "never
   re-check what api has already answered", which is about scoping pre-reads that cost a call; it is the
   documented convention that "the local rule matrices stay… a rule applied at both ends is pinned at both
   ends".
4. **Name the rule in `libs/deed-poll`, do not inline `if (isAdmin)` in the page.** One exported function
   with a test, mirroring api's, exactly as `privacyEditable` is a named rule rather than a branch in a
   handler. It is the seam that moves if the rule changes, and a one-line function with a name is what makes
   the next change a one-line change.
5. **No local guard on the POST.** With the button gone, reaching the `action === "delete"` branch takes a
   hand-crafted request, and api refuses it. Duplicating the refusal here would put the authority in two
   places. See the open question below — a reviewer may reasonably disagree.
6. **Follow the `[id].ts` threading precedent** — `const { isAdmin } = userFromRequest(req);` then pass a
   named flag into the view. Do not invent a different route for the same information.

## Open question for review

**Should a `forbidden` on note deletion render something other than the 404 template?**

Today all `ForbiddenError`s render 403 on the 404 template, deliberately: "a caseworker learns no more from it
than that the case is not theirs." That reasoning is sound for *case* access — it avoids confirming a case
exists. It is wrong for a refused note deletion, where the caseworker demonstrably has the case open and the
honest message is "you cannot delete notes".

Changing it means distinguishing two kinds of forbidden, which is more than this plan needs. **Recommendation:
leave it.** After this change the only way to see it is a deliberately forged request. Recorded so the next
person does not read the mapping as an oversight.

## Constraints

- **Baseline: 1,273 tests — 1,270 passed, 3 skipped, across 8 workspace tasks.** Verified 2026-09-11.
- **Do not use bare `yarn test` as the validation command in this devcontainer. It reports a false failure.**
  `yarn test` runs `turbo watch dev dev:app`'s sibling — `turbo test test:app` at default concurrency — which
  fans 8 packages out in parallel, each spawning vitest fork workers across 14 CPUs. That exhausts the box:
  workers never respond, and the run reports

  ```
  Error: [vitest-pool]: Failed to start forks worker for test files …/route-discovery.test.ts
  Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
   Test Files  no tests
        Tests  no tests
       Errors  4 errors
  Tasks:    0 successful, 8 total
  ```

  **"no tests" and "0 successful" are the tell** — nothing ran, so nothing failed. The same
  `@hmcts-cft/simple-router` package passes 41 tests in 4.4s on its own. Use:

  ```bash
  yarn turbo test test:app --concurrency=1
  ```

  which gives 8 successful of 8. It takes several minutes; that is the price of a result you can trust.
  **A red bare `yarn test` is not a reason to stop** — re-run serially before believing it.
- Record the count in the PR. A plan whose validation starts red cannot tell a break from a pre-existing
  failure, and this particular command starts red for reasons that have nothing to do with the code.
- **`yarn lint` must stay clean.** Biome, and the pipeline fails the stage on it.
- **Do not delete any of the six pipeline scripts.** `lint`, `test`, `test:coverage`, `test:a11y`,
  `test:smoke`, `test:functional` are all invoked by `Jenkinsfile_CNP` and `src/pipeline.test.ts` fails if one
  goes.
- **Welsh parity.** If any user-visible string is added, `cy` must mirror `en` in the same shape. Hiding a
  button adds no copy, which is one more reason to prefer hiding over an explanatory disabled state.
- **E2E needs Docker and a running app.** `yarn dev:up` brings up Redis and the IDAM simulator; note that
  `REDIS_URL` must point at `127.0.0.1` rather than `localhost` in this devcontainer, because `localhost`
  resolves to `::1` and Docker publishes IPv4 only. Do **not** override `IDAM_ISSUER_URL` — the simulator's
  discovery document advertises `localhost` and openid-client rejects a mismatch.
- **`yarn idam:users` seeds both fixtures**, `admin@example.com` (holding `caseworker-deedpoll-admin`) and
  `caseworker@example.com` (**no roles at all**). The second is what task 4 needs and it already exists.

## The thing that will quietly become untrue

The e2e test at `e2e-tests/tests/deed-polls.spec.ts:97` is named
**`"caseworker adds, amends and deletes a note"`** — and it signs in as `admin@example.com`, because
`idam-session.ts` only offers `signInAsAdmin` and `ADMIN_EMAIL`.

So after api's gate lands, that test **keeps passing and its name is a false claim**: it asserts a caseworker
can delete a note, when a caseworker cannot. Nothing fails, so nothing draws attention to it. Same class as
the stale `package-info.java` and the three infra documentation corrections — a claim that describes the wrong
subject.

Renaming it is task 4 and is not optional tidying; it is the difference between a suite that documents the
rule and one that contradicts it.

## Tasks

### Task 1: Name the rule

- [ ] Add an exported rule to `libs/deed-poll/src/notes/` — e.g. `canDeleteNote({ isAdmin })` — colocated with the notes domain, with a comment naming api's `gate-note-deletion.md` as the enforcing side and this as the presentation mirror
- [ ] Colocated test: an admin may, a non-admin may not
- [ ] Validate: `yarn turbo test test:app --concurrency=1` — 8 of 8 successful, count above 1,273. **Not bare `yarn test`**, which reports a false failure here
- [ ] Mark completed

### Task 2: Thread it into the note edit page and hide the button

- [ ] `src/pages/deed-polls/[id]/notes/[noteId]/edit.ts`: read `userFromRequest(req)` in `GET` **and** in `rerender`, and pass the flag to `res.render`
- [ ] **Both call sites, or the button reappears whenever a validation error re-renders the form** — which is exactly the path a caseworker hits by submitting an over-long note
- [ ] `note-edit.njk`: wrap the second `govukButton` (`name: "action", value: "delete"`) in the condition. Leave the save button and the form action alone
- [ ] Update the docblock at the top of `edit.ts`, which explains the two-button design and says nothing about who may use the second one
- [ ] Validate: `yarn turbo test test:app --concurrency=1 && yarn lint`
- [ ] Mark completed

### Task 3: Unit tests, including the re-render path

- [ ] An admin's `GET` renders the delete button
- [ ] A caseworker's `GET` does not
- [ ] **A caseworker's failed save re-render does not** — the `rerender` path, the one easily missed
- [ ] An admin's `POST action=delete` still deletes and still redirects to `#notes`
- [ ] A caseworker's `POST action=delete` is left to api: assert this page does not itself refuse, so the test documents decision 5 rather than leaving it implied
- [ ] Validate: `yarn turbo test test:app --concurrency=1` — 8 of 8 successful
- [ ] Mark completed

### Task 4: Fix the lying e2e test, and cover the caseworker

**Write these; do not run the Playwright suite.** `yarn test:e2e` needs Docker, a built app, seeded IDAM
users and roughly two minutes of boot, and it is invoked by no pipeline stage — the six scripts
`Jenkinsfile_CNP` calls are `lint`, `test`, `test:coverage`, `test:a11y`, `test:smoke` and
`test:functional`. Running it is a separate manual step after this plan, so validate by lint and
typecheck only and do not spend iterations trying to boot the app.

- [ ] **Rename** `"caseworker adds, amends and deletes a note"` (`e2e-tests/tests/deed-polls.spec.ts:97`) to say administrator, since `admin@example.com` is who it signs in as. It will keep passing after api's gate either way, so the name is the only thing that makes it a false claim
- [ ] Add a caseworker session to `e2e-tests/tests/idam-session.ts`: `CASEWORKER_EMAIL`, `signInAsCaseworker`, and a storage state alongside `ADMIN_STORAGE_STATE`. Follow the admin helper exactly; the simulator accepts any password. `caseworker@example.com` is already seeded by `yarn idam:users` and holds no roles at all
- [ ] Add one test: as a caseworker, open a note's amend page and assert **Delete note** is absent while **Save note** is present. The second assertion is what stops a future change hiding the whole form
- [ ] Keep it out of `@smoke`. Smoke runs against deployed environments where no caseworker fixture exists — use the existing `RUNS_AGAINST_DEPLOYED_STACK` and `DEPLOYED_STACK_SKIP_REASON` rather than inventing a mechanism
- [ ] Validate: `yarn lint` clean, and the spec typechecks. Do **not** run `yarn test:e2e`
- [ ] Mark completed

### Task 5: Full validation

- [ ] `yarn lint` — 8 of 8 successful
- [ ] `yarn turbo test test:app --concurrency=1` — 8 of 8 successful, count above the 1,273 baseline
- [ ] `grep -rn "caseworker adds, amends and deletes" e2e-tests/` returns nothing, so no stale claim survives
- [ ] `git grep -n "isAdmin" -- 'src/pages/deed-polls/\[id\]/notes'` shows the flag reaching both `GET` and `rerender`
- [ ] Mark completed

## Deliberately not in this plan

- **Any change to how `ForbiddenError` renders.** See the open question.
- **Gating anything else in the UI.** Create, amend, upload, download and the reads are all available to both
  roles per the business document, and are already correct.
- **The role/capability refactor.** `../../deed-poll-api/docs/plans/role-model-generalisation.md`, on hold,
  and this app's own mirror of it is a separate piece again. This plan uses the `isAdmin` that exists today;
  when the refactor lands, the named rule from task 1 is the single place that changes.
- **The other four Administrator capabilities** — delete a document, delete a witness, manage Supporting
  Document Types, deactivate a record. None exists in api, so there is no UI to gate.
  See `../../deed-poll-api/docs/plans/scope-gap-questions.md`.
