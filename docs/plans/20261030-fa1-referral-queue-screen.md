# Plan Fa1: the referral queue's contract and mock, the Team leader and Delivery Manager referrals screen, and raising without a Master

## Overview

User feedback after item D (Steve, 2026-10-29/30). **This plan runs once api plan F1 is finished.** Read F1
(`../deed-poll-api-quill-f/docs/plans/20261030-f1-referral-queue-and-batch-send.md`) first: its decision table (F-1 to
F-12) is the specification, and its assumptions A-1 and A-2 are this plan's too. It lands **before the 2026-11-02
go-live** with no expand-then-contract step, deployed straight after api F1. In short:

1. **Raising takes no Master.** The raise form loses "Which Master should this go to?". The referral waits in a queue,
   and the caseworker sees that on the case and the referral.
2. **Caseworkers no longer assign or reassign.** The assign page and its links go.
3. **A new Referrals screen for Team leaders and Delivery Managers** (`ALLOCATE_REFERRALS`), like the Gazette screen:
   the queue, a check view of each referral's application, choosing a Master for each selected referral, a check
   page, and **Send**, which is active only during a referral window and never takes the window past its cap (the
   window's total across all Masters). The screen shows how many have been sent in the window, in total and per
   Master.
4. **Reassigning is on the same screen**, at any time, using no place in the window.
5. **The Master's My referrals groups by the day sent**, urgent still on top.
6. **The settings page's cap** becomes the window's total.

## Context

Read before changing anything:

- `CLAUDE.md`: "Personas and role gating" (especially "Referrals are assigned, never claimed", "A Master has no pool",
  the capability table and `requireCapability`), "Delivery Manager settings", the Gazette area's paragraph (its gate
  in `app.ts`, its batch page's review, signed session-bound hidden state, check pages), the worklist rules (the
  waiting-for-assignment count, `worklistCount`), "Redirect paths", the Welsh rules and the session and CSRF rules for
  new POST routes.
- `src/app.ts` (the `/deed-polls/gazette` and `/deed-polls/settings` gates) and `src/app.test.ts` (the gate tests that
  read a page directory off the filesystem).
- `libs/deed-poll/src/auth/capabilities.ts` and the mock's table (`libs/deed-poll-api-client/src/mock/caller-access.ts`).
- `src/pages/deed-polls/[id]/referrals/new.ts` and its form (the Master radios from Db1), `src/master-radios.ts`,
  `libs/deed-poll/src/referrals/master-choices.ts`, `[referralId]/assign.ts`, `[referralId].ts` and its template, the
  case page's referrals panel, `src/pages/deed-polls/index.ts` (the counts and the "Service settings" link),
  `libs/deed-poll/src/referrals/referrals-view.ts` (`REFERRAL_STATE_LABEL`/`_MEANING`,
  `referrals/waiting-for-assignment.ts`), `libs/deed-poll/src/judicial/view.ts` (`buildMyReferralSections`).
- `src/pages/deed-polls/gazette/` (`index`, `batch`, their templates and tests): the screen to copy in shape.
- `src/pages/deed-polls/settings/index.njk` and `libs/deed-poll/src/settings/schemas.ts` (`masterWindowCap`).
- The mock: `libs/deed-poll-api-client/src/mock/` (`assignment.ts` and its tests, `/__mock/clock`, `masters.ts`,
  `process-settings.ts`, `caller-access.ts`) and `scripts/seed-local-cases.mjs`.

## Development Approach

0. **Contract and mock.**
   - **Spec refresh.** The chain generates api F1's document in a throwaway worktree: copy `/tmp/quill-f/spec-f1.json`
     into `openapi.json` as 2-space JSON, run Biome, check it parses equal, and record a `SPEC-PROVENANCE.md` row from
     `/tmp/quill-f/spec-f1.meta` (unmerged branch, commit, SHA-256, measured delta against the current copy). Do not
     touch `../deed-poll-api-quill-f`. Missing files: stop and say so.
   - **Adapter.** `client.ts`/`wire.ts`: create without `masterId`; `GET /caseworker/referral-queue` and its envelope;
     `POST /caseworker/referral-queue/sends`; the reassignment's unchanged path; the settings' `windowCap`; the Masters
     list without `window`/`cap`/`assignedInWindow`; `ALLOCATE_REFERRALS` in the `CallerAccessResponse` enum.
     `contract.test.ts` set-equal both ways. Add `ALLOCATE_REFERRALS` to `capabilities.ts` and the mock's table
     (Team leader, Delivery Manager, legacy admin).
   - **The mock mirrors F1 in api's words:** the window-state function (inside which window, the next one; pure, with
     the same boundary tests as api's), the queue read and its orders, the send's rules in api's order (shape, window,
     each referral `Open` with the replay no-op, each Master available, the cap counting every referral sent in the
     window), reassignment's rules (`Claimed` only, any time, no cap, window kept, clock restarted), the settings
     rename, `MINE_ORDER` by `assignedAt`, and unassignment returning to the queue. Use `/__mock/clock` to place a
     journey inside or outside a window.
   - **Seed data:** queued (`Open`) referrals, urgent and not, across several days; some already sent to the seeded
     Masters in a past window; keep the seeder's read-back checks true and update its numbers and its `CLAUDE.md` line.
     Run it against a private-port mock.
1. **Raising without a Master.** Remove the Master radios, `src/master-radios.ts` and `master-choices.ts` if nothing
   else uses them, the Masters read on the raise form and its degraded states, and `masterId` from the form and its
   schema. The confirmation after raising says the referral is waiting to be sent to a Master.
2. **The caseworker's side.** Delete `[referralId]/assign.ts` and its tests and template, and its links on the
   referral page and the case page's referrals panel. `REFERRAL_STATE_LABEL`/`_MEANING`: `Open` is "Waiting to be
   sent" ("A Team leader or Delivery Manager will check this referral and send it to a Master."); `Claimed` stays
   "With {Master}" with the due date. The waiting-for-assignment count on the case list stays for everyone, reworded
   "N referrals are waiting to be sent to a Master." (function entries, singular and plural); for a caller holding
   `ALLOCATE_REFERRALS` it links to the new screen, for anyone else to the existing worklist. Grep every test and e2e
   spec for "Waiting for assignment" and "Assign to" and update them deliberately.
3. **The Referrals screen.** A new area `src/pages/deed-polls/referrals/`, gated once in `app.ts` with
   `requireCapability(ALLOCATE_REFERRALS)` beside the Gazette and settings gates, and covered by `app.test.ts`' gate
   test. The case list shows a "Referrals" link for holders only, drawn from the session's capability as "Service
   settings" is. Pages (every href and redirect through the path helpers):
   - **`index`, the queue.** Two GOV.UK tabs, as the case page and the settings page do: **To send** (`Open`) and
     **With a Master** (`Claimed`). Above them, the window panel from the queue envelope:
     - inside a window: "This morning's window closes at 10:30. 4 of 10 referrals sent." and a table of available
       Masters with each one's "sent this window";
     - outside: "Referrals can be sent from 14:00 today." (the next window in words) and no counts beyond "0 of 10".
     **To send** lists the queue in api's order (urgent first, tagged "Urgent"; never re-sorted here): the reference
     (linking to the check view), the applicant's new name, the reasons through `referralReasonLabels`, raised by and
     on (dd-mm-yy). Each row has a checkbox and a Master select (the available Masters, "Choose a Master" first). One
     form, **Continue**, posts the selection to `review`. Paging as api pages; a selection is per page.
     **With a Master** lists `Claimed` referrals: reference, Master, sent on, direction due by, and "Reassign".
   - **`[referralId]`, the check view.** Read-only: the referral (reasons, urgency and its reason, raised by/on) and
     the application's details from the existing caseworker case read (the same summary rows the case page's General
     section shows, and the supporting documents linking to the shared viewer). A link back to the queue. No form.
   - **`review`, the check page.** From the posted selection (`referralId` → `masterId` pairs; validate the shape here
     with a Zod schema: at least one ticked, each ticked one with a Master, nothing unticked carried): re-read the queue
     envelope and list each pair (reference, reasons, urgent, the Master), the totals after sending ("This sends 3
     referrals. 7 of 10 will have been sent this morning."), and **Send referrals**. The Send button is drawn **only
     inside a window** (otherwise the page says when sending opens, and offers "Back to referrals"); the server never
     relies on that, api refuses. A selection over the room left is shown with the room left and no Send. Carry the
     pairs in hidden inputs, not the session; api re-checks every one.
   - **`send` (POST).** Calls the send. Success: 303 to `index` with `?sent=N` and a banner "3 referrals sent to 2
     Masters." (from api's answer). Refusals redraw `review` with api's sentence: outside a window, over the cap, a
     referral no longer waiting (placed beside that row), an unavailable Master (beside that row). A lost response is
     recoverable by pressing Send again, because api's replay is a no-op; say nothing about it beyond api's own answer.
   - **`[referralId]/reassign` (GET, POST).** Radios of the available Masters, pre-selecting the current one, saying who
     has it and since when, that reassigning starts the Master's 7 days again (from `directionDueBy`, never restating
     the number) and that the new Master will be emailed. POST calls `PUT …/assignment` (it needs the case id: take it
     from the queue row, carried in the link). Success: 303 to `index#with-a-master` with a banner; an `Open` or closed
     referral's 409 redirects to `index` with a state sentence; the same Master is api's no-op and reads as success.
4. **The Master's side.** `buildMyReferralSections` groups by the day **sent** (`assignedAt` in `Europe/London`),
   headings "dd-mm-yy referrals" as today; each row says "Sent dd-mm-yy" where it said "Referred". Urgent stays its own
   top section. Do not re-sort; api orders by `assignedAt` (F1 step 9).
5. **Settings.** The referral process section's cap: label "Referrals in each window", hint "The most referrals that
   can be sent to Masters in one referral window, across all Masters. Enter 1 to 100.", posting `windowCap`. Update
   the schema, the mock and the settings tests, and the error message's wording.
6. **e2e journeys.** In `deed-polls.spec.ts`, replace the assignment journeys: a caseworker raises a referral with no
   Master question and sees "Waiting to be sent"; a Team leader (persona switcher) opens Referrals, checks one,
   selects two with Masters, reviews and sends inside a window (`/__mock/clock`), sees the banner and the counts move,
   finds them on With a Master, reassigns one **outside** a window; Send is absent outside a window; the cap with the
   mock's cap set low refuses an over-full selection; a caseworker is refused `/deed-polls/referrals` (403 on the 404
   view) and sees no Referrals link. In `judicial.spec.ts`, the Master finds sent referrals under the day sent with the
   urgent one on top. Keep the accessibility checks on every new page and a Welsh check where the journeys already do
   one. Run the changed specs on a **temporary, untracked private-port Playwright config** (shape below), with
   `DEED_POLL_API_URL` set to the private mock in the environment too, because the specs seed the mock through it.
   Delete the config afterwards; never run against the shared developer mock on 3200.
7. **Tests first**: view-model tests (the queue rows, the window panel inside/outside/at the cap, the review's totals,
   My referrals by day sent), handler tests for every new route and every refusal, template tests (content first,
   model over it), the `href` and Welsh sweeps, and the gate test.
8. **Docs.** `CLAUDE.md`: rewrite "Referrals are assigned, never claimed" around the queue and the screen, add the
   Referrals area beside the Gazette paragraph, update the capability table (new column) and the case-list counts
   text, and the settings paragraph's cap. Add `src/pages/deed-polls/referrals` to the Welsh extractor's `INCLUDE` if
   `deed-polls` does not already cover it recursively (check), and regenerate the Welsh CSV.
9. **Out of scope:** api; Notify; clearing AAT's referrals.
10. **Publishing:** local task commits only, no push and no PR.

A private-port config for the changed journeys (Redis on 6316 via `docker run -d --rm --name f-redis -p 6316:6379
redis:8-alpine`, local IDAM on 5556 already running, `yarn idam:users` once):

```ts
// e2e-tests/playwright.f.config.ts — temporary, untracked
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base, fullyParallel: false, testIgnore: [], workers: 1, retries: 0,
  use: { ...base.use, baseURL: "http://localhost:3326" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "changed", testMatch: /(judicial|deed-polls|confirmation|emails|persona-switcher|staff-roles)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] }
  ],
  webServer: [
    { command: "yarn mock:api --port 3226", url: "http://localhost:3226/health", reuseExistingServer: false, cwd: "..", timeout: 60_000 },
    { command: "yarn dev:app", url: "http://localhost:3326", reuseExistingServer: false, cwd: "..", timeout: 120_000,
      env: { PORT: "3326", DEED_POLL_API_URL: "http://localhost:3226", REDIS_URL: "redis://127.0.0.1:6316/2",
             IDAM_REDIRECT_URI: "http://localhost:3326/oauth2/callback", PERSONA_SWITCHER_ENABLED: "true" } }
  ]
});
```

Run it with `cd e2e-tests && DEED_POLL_API_URL=http://localhost:3226 yarn playwright test --config playwright.f.config.ts`.
Also run `yarn test:gazette` once in the final task, because it holds the settings journeys.

## Validation Commands

Run the full set from the repository root **twice only**: before implementation (the baseline) and in the final
task. **After each other task**, run `yarn biome format --write .`, `yarn lint`, `yarn build --force` and only the
touched packages' tests, with `REDIS_URL=redis://127.0.0.1:6379`. If one of those shows a failure outside the task,
run the full suite then. The full set:

```bash
yarn biome format --write .
yarn lint
yarn build --force
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
```

Never quote bare `yarn test`. `yarn welsh:check` exits 1 by design and is not a gate. Record each package's test
count, and distinguish baseline failures from regressions. `yarn lint` currently reports one warning on master (an
unused import in `libs/deed-poll-api-client/src/mock/server.ts`); it is the baseline, not a regression, though this
plan may fix it if it touches that file. The temporary Playwright config is untracked and must not be committed
(Biome will flag its formatting; delete it before the final lint).

**Baseline:** admin master `e3331bb`, recorded at execution time.

Run every build and test command in the **foreground** and wait for it to finish. A backgrounded build ends the
session, and the next one builds over it, wiping the results. Never move `dist` aside; use `--force`.

## Implementation Steps

### Task 0: Contract and mock for the queue
- [ ] Record the execution baseline in the execution notes.
- [ ] Copy the chain's F1 spec and record its provenance; add failing `client.test.ts`, `contract.test.ts` and mock tests for every queue, send and reassignment rule, the settings rename and the capability.
- [ ] Implement the adapter, the capability, the mock and the seed, run the seeder on a private-port mock, run the per-task checks, and record the results.

### Task 1: Raising without a Master, and the caseworker's side
- [ ] Add failing handler, schema and template tests for the raise form without Masters, the removed assign page and links, the new state wording and the reworded count with its two link targets.
- [ ] Implement, delete the assign page and the Master radios, run the per-task checks, and record the results.

### Task 2: The Referrals screen: queue, check view and gate
- [ ] Add failing tests for the gate, the case-list link, `index` (both tabs, the window panel inside and outside a window, the rows, the selection form) and the check view.
- [ ] Implement, run the per-task checks, and record the results.

### Task 3: Review, send and reassign
- [ ] Add failing tests for `review` (shape refusals, totals, Send only inside a window, over the room left), `send` (success banner and every refusal) and `reassign` (GET, POST, the 409s, the no-op).
- [ ] Implement, run the per-task checks, and record the results.

### Task 4: The Master's side and the settings cap
- [ ] Add failing tests for My referrals grouped by the day sent and the settings page's window cap.
- [ ] Implement, run the per-task checks, and record the results.

### Task 5: e2e journeys
- [ ] Rewrite the journeys as step 6 says; run them on the temporary private-port config; record the result; delete the config.

### Task 6: Documentation and final verification
- [ ] Update `CLAUDE.md` and regenerate the Welsh CSV with `yarn welsh:extract`.
- [ ] Run all Validation Commands once more with `--force`, and `yarn test:gazette`; record the counts against the baseline, and confirm `git status` is clean apart from the task commits.

## Execution notes
