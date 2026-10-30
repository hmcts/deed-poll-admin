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
- [x] Record the execution baseline in the execution notes.
- [x] Copy the chain's F1 spec and record its provenance; add failing `client.test.ts`, `contract.test.ts` and mock tests for every queue, send and reassignment rule, the settings rename and the capability.
- [x] Implement the adapter, the capability, the mock and the seed, run the seeder on a private-port mock, run the per-task checks, and record the results.

### Task 1: Raising without a Master, and the caseworker's side
- [x] Add failing handler, schema and template tests for the raise form without Masters, the removed assign page and links, the new state wording and the reworded count with its two link targets.
- [x] Implement, delete the assign page and the Master radios, run the per-task checks, and record the results.

### Task 2: The Referrals screen: queue, check view and gate
- [x] Add failing tests for the gate, the case-list link, `index` (both tabs, the window panel inside and outside a window, the rows, the selection form) and the check view.
- [x] Implement, run the per-task checks, and record the results.

### Task 3: Review, send and reassign
- [x] Add failing tests for `review` (shape refusals, totals, Send only inside a window, over the room left), `send` (success banner and every refusal) and `reassign` (GET, POST, the 409s, the no-op).
- [x] Implement, run the per-task checks, and record the results.

### Task 4: The Master's side and the settings cap
- [x] Add failing tests for My referrals grouped by the day sent and the settings page's window cap.
- [x] Implement, run the per-task checks, and record the results.

### Task 5: e2e journeys
- [x] Rewrite the journeys as step 6 says; run them on the temporary private-port config; record the result; delete the config.

### Task 6: Documentation and final verification
- [ ] Update `CLAUDE.md` and regenerate the Welsh CSV with `yarn welsh:extract`.
- [ ] Run all Validation Commands once more with `--force`, and `yarn test:gazette`; record the counts against the baseline, and confirm `git status` is clean apart from the task commits.

## Execution notes

**Baseline:** admin `822d128` (the plan's commit on master `e3331bb`). `yarn biome format --write .` no fixes; `yarn lint`
one warning (the known unused import in `mock/server.ts`); `yarn build --force` 8 of 8; `REDIS_URL=redis://127.0.0.1:6379
yarn turbo test test:app --concurrency=1 --force`: simple-router 45, deed-poll-api-client 1,393, express-govuk-starter
132, deed-poll 1,723, express-session-postgres 85, express-session-redis 7, cloud-native-platform 156, app 3,275; all
passing, none skipped.

**Task 0.** `openapi.json` is api F1's `/tmp/quill-f/spec-f1.json` (unmerged `feat/f-referral-queue` at `cc1deef`, SHA-256
matching `spec-f1.meta`), 2-space JSON then Biome, parsed equal; `SPEC-PROVENANCE.md` has its row and delta (68
operations, 49 paths, 78 schemas). Adapter: `getReferralQueue` (`ReferralQueueQuery`: `state`, `page`, `size`) and
`sendReferrals`, `REFERRAL_SEND_LIMITS`, the queue's eight schemas with their strictness pinned, `windowCap`
(`minWindowCap`/`maxWindowCap`), the Masters list as `{masters}` of `MasterResponse` rows, no `masterId` on the create,
and `ALLOCATE_REFERRALS` last in `CAPABILITY`. `libs/deed-poll` exports `ALLOCATE_REFERRALS`; the mock's Team leader set
holds it (so legacy admin and Delivery Manager do). The mock (`referral-windows.ts` now api's `openAt`, `nextToOpen`,
`opensAt`, `closesAt`; `windowFor` went, as in api) answers the queue in both orders with the window envelope, the send
in api's order and words (shape, window with today/tomorrow/weekday, not waiting or replay, Master, cap with A-2), and
reassignment `ALLOCATE_REFERRALS` only (403 before the case is read), `Claimed` only, no cap, window kept. Every raise is
`Open` with api's note; My referrals orders by `coalesce(assignedAt, claimedAt, createdOn)`; unassignment's note says
"returned to the queue". **`/__mock/clock` also takes `{ window: "open" | "closed" }`**, five minutes after the next morning
window opens or closes, so tests and journeys need not hard-code dates. `mock/assignment.test.ts` became
`mock/referral-queue.test.ts` (61 tests); the other mock, client and preview tests that raised with a `masterId` now
raise and then send inside an opened window. The real-api seeder (`src/seed/run.ts`) sends its five referrals from the
queue as the Team leader under the same `/assign` step names, so old journals resume; **it now has to run inside a
referral window** (its usage line says so). `scripts/seed-local-cases.mjs` raises five queued referrals (two urgent)
on two earlier days and sends the rest in the last two past morning windows, reading the queue back (5 waiting, urgent
first, 2 sent, 0 sent this window); run against a private mock on 3236 it exited 0. `CLAUDE.md`'s `mock:seed` line
says so.

Bridges until later tasks, so the build stays green: `buildMasterChoices` answers no window and nobody full (the
Masters list has no counts now), and the 15 page and template tests pinning the per-Master room and full hints were
deleted with the counts they read (Task 1 deletes the radios); the settings form keeps its `masterWindowCap` control
and maps it to api's `windowCap` (Task 4 relabels it). The e2e specs still raise with a `masterId`, which the mock now
ignores, until Task 5 rewrites them. Checks: format fixed 6 files; `yarn lint` clean (the baseline warning is fixed);
`yarn build --force` 8 of 8; tests: deed-poll-api-client 1,448, deed-poll 1,719, app 3,260 (3,275 less the 15 deleted),
the other five packages unchanged; all passing.

**Task 1.** The raise form asks no Master and reads no Masters list: `masterId`, the radios, their three degraded
states and the cap-409 branch are gone, and `createReferralSchema` strips a posted `masterId`. Deleted: `assign.ts` and
its test, `referral-assign.njk` and its test, `src/master-radios.ts`, and `master-choices.ts` with its test and export
(the queue envelope carries the Masters the screen needs; settings keeps its own `listMasters`). `assignReferralSchema`
went with the page; the `assignReferral` service stays for Task 3's reassign. `assignAction` and both assign links (the
referral page and the case page's panel), with the `?assigned`/`?assign=conflict` banners, are gone. `Open` reads
"Waiting to be sent" / "A Team leader or Delivery Manager will check this referral and send it to a Master."; the case
panel's live-referral sentence for `Open`, which is what a caseworker sees after raising (the POST still redirects to
`#referrals`), says "This case has a referral waiting to be sent to a Master. Withdraw it before raising another." The
case-list count reads "N referrals are waiting to be sent to a Master." (singular and plural) for everyone; holders of
`ALLOCATE_REFERRALS` get "Check and send referrals" to `/deed-polls/referrals` (a 404 until Task 2), everyone else
"View referrals waiting to be sent" to the `Open` worklist. `src/express-doubles.ts`' Team leader set gained
`ALLOCATE_REFERRALS`, as the mock's did in Task 0. The e2e specs still drive the assign page and the old wording; Task 5
rewrites them. Checks: format fixed 1 file; `yarn lint` clean; `yarn build --force` 8 of 8; tests: deed-poll 1,704
(1,719 less the deleted master-choices and assign-schema tests), app 3,225 (3,260 less the assign page, its template
and the Master-radio tests, plus the new ones); all passing.

**Task 2.** `libs/deed-poll/src/referrals/queue.ts`: `findReferralQueue` (state and page only), `buildQueueWindowView`
(open or not, slot, `HH:mm` closing and opening times in London, the next window as today/tomorrow/a long date from
the app's clock, cap, sent, room never negative, the available Masters with their counts; `null` without a window) and
`buildQueueRows` (api's order, reasons through `referralReasonLabels`, `dd-mm-yy` dates, urgent flag, Master, sent on,
due by). `src/referral-queue/paths.ts` holds `REFERRAL_QUEUE_PATH`, `queueReferralPath` and `queueReassignPath`
(`/deed-polls/referrals/<pathSegment>?case=<encoded>`: the queue names the referral and carries its case, which api
addresses it under); the case list now imports the constant. `app.ts` mounts `requireCapability(ALLOCATE_REFERRALS)` on
`/deed-polls/referrals` beside the other two gates, and `app.test.ts` reads `src/pages/deed-polls/referrals/` off the
filesystem (a case's own `/deed-polls/<id>/referrals/**` stays outside it). The case list draws a "Referrals" link for
holders from the session's capability (`showReferrals`). `referrals/index` reads To send (load-bearing, carries the
window) and With a Master (degrades to a warning and a `forLog` line) concurrently, each paged independently
(`?page=…#to-send`, `?sentPage=…#with-a-master`); two GOV.UK tabs below the window panel ("This morning’s window closes
at 10:30." / "Referrals can be sent from 14:00 today.", "4 of 10 referrals sent.", the per-Master table only inside a
window, a warning when api sent no window). To send is one form posting to `/deed-polls/referrals/review` (Task 3):
checkboxes `name="referrals"` valued with the referral id, and per row a select `name="master-<referralId>"` whose first
option is "Choose a Master" (value empty); no Continue when no Master is available. With a Master links each row to
`…/reassign?case=` (Task 3). The check view `referrals/[referralId]` (template `referrals/check.njk`) needs `?case=`
(missing or repeated is a 404 before any read), reads the referral, the case and its rules, and shows the referral, the
case page's Application/General rows (`buildDetailTabs`) and the documents linking to the case-scoped viewer, with the
privacy banner and no form. The copy's `cy` mirrors `en`, pending translation as the settings page's is; the extractor's
`src/pages/deed-polls` entry already covers the area. Checks: format no fixes; `yarn lint` clean; `yarn build --force`
8 of 8; tests: deed-poll 1,717 (+13), app 3,279 (+54); all passing.

**Task 3.** Domain: `sendSelectionSchema` (`referrals/schemas.ts`) reads the queue form's own shape (`referrals`, one or
many, and `master-<referralId>` per ticked row) into api's `allocations` in the order ticked: nothing ticked, a value
that is not a UUID, a referral ticked twice or more than api's 100 is an error on `referrals`; a ticked row with no
Master is an error on its `master-<id>`; a Master on an unticked row is dropped. `queue.ts` gained `sendReferrals`,
`summariseSend` (the referrals api answered with and the distinct Masters holding them) and `buildSendReview` (each
pair with its row and Master's name, `missing` and `unavailable` against a fresh page, `sentAfter`, `isOverRoom` and
`canSend`, which needs an open window, room and both lists empty; with no window api lists no Masters, so nothing is
called unavailable). The queue page moved to `src/referral-queue/queue-page.ts` (now on the Welsh extractor's
`INCLUDE`) so the review and the send can redraw it with the posted selection ticked and chosen, the errors beside their
rows and an error summary, on the page it was made on (a hidden `page`); `index.ts` is one line. The queue reads its
banners from the redirects: `?sent=N&masters=M` ("3 referrals sent to 2 Masters."), `?reassigned=1` and
`?reassign=conflict`. `review` (POST; GET 302s to the queue) re-reads that page of the queue and lists each pair
(reference, reasons, urgent, Master) with the totals ("This sends 2 referrals." / "6 of 10 will have been sent this
morning."), or, outside a window, when sending opens, or, over the room, "Only 1 more referral can be sent this
morning." (no room: "No more …"); Send is drawn only when `canSend`, its pairs in hidden inputs in the queue form's shape.
`send` (POST; GET 302s) parses the same schema and 303s to the queue with api's counts. **Deliberate deviation from step
3:** a refusal about a row goes back to the *queue*, not the review, because only the queue has a control to change it:
a referral no longer waiting (api's 409 on `allocations[i].referralId`, or found missing by the review's re-read) is the
queue with "A referral you selected is no longer waiting to be sent. Check the list and select again."; an unavailable
Master (api's 400 on `allocations[i].masterId`, or found by the re-read) is api's sentence beside that row's select. A
409 naming no field (window or cap) redraws the review with api's sentence from a fresh read, so its totals and Send
follow; any other 400 redraws it with its own sentence and a `forLog` line. `[referralId]/reassign` (GET, POST; template
`referrals/[referralId]/reassign.njk`) needs `?case=` like the check view, reads the referral and the queue envelope's
available Masters, says who has it and since when, that the chosen Master's days start again (from `processingDays`),
that they will be emailed and that it uses no place in a window, and pre-selects the current Master. A referral not
`Claimed` on GET, and every 409 on POST, goes to the queue with `?reassign=conflict#with-a-master`; the same Master is a
success; api's 400 on `masterId` redraws beside the radios. `assignReferral`'s docblock now describes F1. Checks: format
no fixes; `yarn lint` clean after `lint:fix` sorted two import lists; `yarn build --force` 8 of 8; tests: deed-poll
1,735 (+18), app 3,339 (+60); the gate, href, layout, `forLog` and Welsh sweeps pass; all passing.

**Task 4.** `buildMyReferralSections` groups by `sentOn`, the day of `assignedAt` in London (the row's `referredOn`
became `sentOn`), falling back to `createdOn` for a referral claimed before assignment existed, because the summary
carries no `claimedAt` (api orders by `coalesce(assignedAt, claimedAt, createdOn)`); still never re-sorted. My
referrals' Urgent rows say "Sent dd-mm-yy" and each link's hidden text "the referral sent on …"; the test fixtures now
drive `assignedAt`. Settings: the control is `windowCap` end to end (the form, the schema, which no longer renames it,
api's field-error mapping and the stored value), labelled "Referrals in each window" with the hint "The most referrals
that can be sent to Masters in one referral window, across all Masters. Enter 1 to 100." and the error "Enter the
referrals in each window as a whole number from 1 to 100"; `e2e-tests/tests/service-settings.spec.ts` uses the new label
(it runs under `yarn test:gazette` in Task 6). The mock already took `windowCap` from Task 0. Checks: format no fixes;
`yarn lint` clean; `yarn build --force` 8 of 8; tests: deed-poll 1,737 (+2), app 3,340 (+1); all passing.

**Task 5.** **Deliberate deviation from step 6:** the Team leader's queue journeys are a new
`e2e-tests/tests/referral-queue.spec.ts` on a mock of their own (`playwright.referrals.config.ts`, mock 3217, app 3317,
Redis database 5, `yarn test:referrals`, excluded from `yarn test:e2e` like the document viewer), not in
`deed-polls.spec.ts`. The referral clock and the window's cap are the whole service's, and moving the clock out of a
window or lowering the cap on the shared mock would refuse every send a parallel worker makes. It signs itself in
(no setup project, so the shared `.auth/` sessions are not rewritten for another port) and holds two journeys: queue
outside a window (the next one at 14:00, no per-Master table), the check view, a ticked row with no Master refused
beside it, a review with no Send outside a window, then inside it the review's totals, Send, the banner "2 referrals
sent to 2 Masters." and the counts moved, With a Master, a reassignment outside a window and the caseworker's case
page naming the new Master; and the cap lowered through api's settings to leave room for one, so two selected show
"Only 1 more referral can be sent this morning." and no Send, and one that loses the last place to a send made
meanwhile gets api's "No more referrals can be sent this morning." on the review. Every page is axe-checked; its
copy's `cy` mirrors `en`, so no Welsh check. `masters.ts` gained `sendToMaster` and `openWindowWithRoom`, which only
ever move the clock *into* an open window with room (a week on, the same morning, when this one is full or a bank
holiday) and retry a send that lost its place; `assignReferral` and `referralCap` went. `confirmation`, `emails`,
`persona-switcher`, `document-viewer`, `judicial` and `deed-polls` raise without a `masterId` and send. In
`deed-polls.spec.ts` the raise journey asks no Master and reads "Waiting to be sent" (reassignment and the full Master
went with the assign page), and the waiting journey now sends a Team leader through "Check and send referrals" to the
screen and a caseworker through "View referrals waiting to be sent" to the worklist, with no Referrals link and a 403
on the 404 view at `/deed-polls/referrals`; the computed disabled-radio waiver went with the full Master. In
`judicial.spec.ts` My referrals is read by the day sent (`assignedAt`), urgent on top, with "Sent dd-mm-yy". Runs:
`yarn test:referrals` 2 passed; the plan's temporary config (mock 3226, app 3326, Redis 6316/2) 36 passed (setup
and the six changed specs), then deleted; `yarn test:document-viewer` 2 passed. Checks: format no fixes; `yarn lint`
clean; `yarn build --force` 8 of 8; app 3,340, all passing.
