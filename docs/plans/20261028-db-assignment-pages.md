# Plan Db: assigning referrals, and the Master's pages without a pool

## Overview

Master Sullivan's feedback, item D (Steve, 2026-10-27/28). Plan Da refreshed the contract, taught the mock item D and
built the settings. This plan is the pages caseworkers and Masters use. **Read the api plans D1, D2 and D3
(`../deed-poll-api-juniper-d/docs/plans/completed/20261028-d*.md`) and plan Da first**; D1's decision table is the
specification. In short:

1. **Raising a referral assigns it.** The raise form asks which Master, with each Master's room in the current
   window, and api refuses past the cap.
2. **Any caseworker can reassign** a referral waiting for a direction, or assign one that is waiting for assignment
   (raised without a Master before this release, or unassigned after 7 days without a direction).
3. **Caseworkers can see what is waiting for assignment**: a count on the case list, like the returned-for-action
   count, and the referral and case pages say so and offer the assign form.
4. **The Master has no pool and no claim.** Their home is My referrals, laid out as Steve chose on 2026-10-28.

## Context

Read before changing anything:

- `CLAUDE.md`: "Personas and role gating" (the judicial gate, `/` deciding each persona's home, "Judicial page copy
  must never name or imply a holder", `isMyListState`, "The pool is `Open` only…" which this plan makes historical),
  the worklist rules ("A worklist is either a published `filter` key or a `where` condition"; the returned-for-action
  count is a `where` on `currentReferralState`, with `worklistCount` degrading to its own state), redirect paths,
  the Welsh rules, and the session and CSRF rules for new POST routes.
- `src/pages/deed-polls/[id]/referrals/new.ts` and `referral-form.njk` (the raise form, its `FIELD_ORDER`, how api 400s
  and 409s are placed), `[referralId].ts` and `referral-detail.njk` (the caseworker referral page), the case page's
  referrals panel, `src/pages/deed-polls/index.ts` (the counts), `src/pages/index.ts` (the landing),
  `src/pages/judicial/referrals/index.ts`, `mine.ts`, `[referralId].ts`, `list-navigation.njk`, and
  `libs/deed-poll/src/judicial/view.ts` and `libs/deed-poll/src/referrals/referrals-view.ts`.

## Development Approach

1. **The raise form** gains "Which Master should this go to?" as radios, required and placed **last**, after
   urgency, because the caseworker decides who after deciding what. Each option is
   the Master's name with a hint: "3 of 10 referrals for this morning" (from `GET /caseworker/masters`' `window`, `cap`
   and `assignedInWindow`; "this afternoon", or "the morning of 29-10-26" when the current window is a later one, in
   dd-mm-yy). A full Master is still listed but its hint says "Full for this morning" and its radio is disabled.
   Unavailable Masters are not offered. No Masters at all: the form says "There are no Masters to assign to. Ask a
   Delivery Manager to add one." and offers no submit. Read the Masters list alongside the case, degrading as
   `[id].ts` does if it fails (the form then says the list could not be loaded and offers no submit). api's 409 at the
   cap redraws the form with api's sentence beside the radios (`masterId` in `FIELD_ORDER`), keeping everything typed.
   An unavailable or unknown Master (400 on `masterId`) is placed the same way.
2. **Assign and reassign.** A new page `deed-polls/[id]/referrals/[referralId]/assign` (GET and POST): the same radios,
   pre-selecting the current Master, saying who has it now and since when, and that reassigning starts the Master's 7
   days again (read the processing window from the referral's `directionDueBy`, never restate the number). POST calls
   `PUT …/assignment`; success redirects to the referral with `?assigned=1` and a banner "Referral assigned to {name}";
   a 409 for a referral no longer waiting for a direction redirects to the referral with a state sentence from the
   fresh read (the withdraw/close pattern); the cap 409 redraws the page. Linked from the caseworker referral page and
   the case page's referrals panel whenever the referral is `Open` or `Claimed`: "Assign to a Master" when `Open`,
   "Assign to another Master" when `Claimed`. Build every href and redirect with the path helpers.
3. **The caseworker's words for the states.** `REFERRAL_STATE_LABEL` and `REFERRAL_STATE_MEANING` in
   `referrals-view.ts`: `Open` is now "Waiting for assignment" ("No Master has this referral. Assign it to a Master."),
   `Claimed` is "With {Master}" or "With a Master" ("Waiting for a direction from {name}, due by dd-mm-yy"). The
   referral page shows the assigned Master, when, and the due date from `directionDueBy`. Keep every other state's
   wording. Grep every test and e2e spec for the old words ("Awaiting a Master", "claimed by a Master") and update
   them deliberately.
4. **The waiting-for-assignment count.** On the case list, beside the returned-for-action count and built the same
   way: a `where` on `currentReferralState = Open`, a separate `worklistCount` read that degrades to its own "could not
   be loaded" state, and a link to that worklist. Sentence: "N referrals are waiting to be assigned to a Master." /
   one. Function entries for the singular and plural, as the existing counts do.
5. **The Master's side.**
   - `/judicial/referrals` (the pool page) now **redirects 302 to `/judicial/referrals/mine`**. Delete the pool's
     template and its view model, and the claim route and button; api keeps the deprecated operations for one
     release, but nothing here calls them. Remove the pool from `list-navigation.njk`. `/` sends a Master to
     `/judicial/referrals/mine`, and `isMyListState`'s "back to" link always goes to My referrals.
   - **My referrals, as Steve chose (2026-10-28)**, from api's `MINE_ORDER` (D2): an **"Urgent"** section first, the
     urgent referrals still waiting for a direction, oldest first, each showing "referred dd-mm-yy"; then **"Awaiting
     your direction"**, the rest of the undirected referrals grouped under one heading per day referred, **"dd-mm-yy
     referrals"**, oldest day first; then **"Directed, awaiting the office"**, the directed referrals grouped by day
     the same way. Each referral appears once. The day is the referral's `createdOn` in `Europe/London`. Each row shows
     the reference, the reasons through `referralReasonLabels`, and "Direction due by dd-mm-yy" for undirected ones.
     An empty section is not drawn; all three empty is the existing empty state. Raise the page size to api's maximum
     (check `JudicialPoolQuery`'s published bound) so a day's group is rarely split; where a page boundary does split a
     day, the next page repeats that day's heading. Grouping is presentation only: do not re-sort what api sent, read
     the sections off its order (api's order already puts urgent undirected first, then undirected by date, then
     directed by date).
   - The Master's referral page shows "Direction due by dd-mm-yy" and no longer offers a claim. Copy must still never
     name or imply another holder.
6. **The mock's seed and the e2e journeys.** `e2e-tests/tests/judicial.spec.ts` is built around the pool and claiming
   ("judge works the pool…", "is beaten to one"); rewrite its journeys around assignment: a caseworker raises a
   referral assigned to the judge persona's Master entry; the Master finds it under the right day on My referrals,
   directs it, changes and withdraws as today; an urgent one sits in the Urgent section; a referral assigned to
   another Master is a 404 for this one; the pool URL redirects to My referrals. In `deed-polls.spec.ts`, the referral
   journeys raise with a Master, reassign once, hit the cap with the mock's cap set low (via the settings page or the
   mock's API), and see the waiting-for-assignment count after using the mock's clock hook from plan Da to push a
   referral past 7 days. Keep accessibility checks on every new page and the Welsh check where the journeys already
   do one. Run the changed specs on a **temporary, untracked private-port Playwright config** (copy the shape below)
   and delete it afterwards; never run them against the shared developer mock on 3200.
7. **Tests first**: view-model tests for the grouping (a fixture covering urgent undirected, undirected on three days,
   directed on two days, and a page boundary inside a day), handler tests for every new route and every refusal,
   template tests (content first, model over it), the `href` and Welsh sweeps, and `app.test.ts`' gate test covering
   any new page under `src/pages/judicial/`.
8. **Docs.** Rewrite `CLAUDE.md`'s "Personas and role gating" bullets that describe the pool and claiming, add one for
   assignment and the Master's grouped page, and update the case-list counts text. Regenerate the Welsh CSV.
9. **Out of scope:** the settings page (plan Da); api; Notify.
10. **Publishing:** local task commits only, no push and no PR.

A private-port config for the changed journeys (Redis on 6316 via `docker run -d --rm --name d-redis -p 6316:6379
redis:8-alpine`, local IDAM on 5556 already running, `yarn idam:users` once):

```ts
// e2e-tests/playwright.d.config.ts — temporary, untracked
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base, fullyParallel: false, testIgnore: [], workers: 1, retries: 0,
  use: { ...base.use, baseURL: "http://localhost:3326" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "changed", testMatch: /(judicial|deed-polls|confirmation|emails|persona-switcher)\.spec\.ts/,
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

Run it with `cd e2e-tests && DEED_POLL_API_URL=http://localhost:3226 yarn playwright test --config playwright.d.config.ts`.

## Validation Commands

Run from the repository root before implementation and after each task:

```bash
yarn biome format --write .
yarn lint
yarn build --force
REDIS_URL=redis://127.0.0.1:6379 yarn turbo test test:app --concurrency=1 --force
```

Never quote bare `yarn test`. `yarn welsh:check` exits 1 by design and is not a gate. Record each package's test
count, and distinguish baseline failures from regressions. The temporary Playwright config is untracked and must not
be committed (Biome will flag its formatting; delete it before the final lint).

**Baseline:** whatever plan Da finished on, recorded at execution time.

Run every build and test command in the **foreground** and wait for it to finish. A backgrounded build ends the
session, and the next one builds over it, wiping the results. Never move `dist` aside; use `--force`.

## Implementation Steps

### Task 1: Raising with a Master
- [ ] Record the execution baseline in the execution notes.
- [ ] Add failing handler, schema and template tests for the Master radios, their hints, full and unavailable Masters, no Masters, a failed Masters read, and the cap 409.
- [ ] Implement, run all Validation Commands, and record the results.

### Task 2: Assign and reassign, and the caseworker's words
- [ ] Add failing tests for the assign page (GET, POST success, the three refusals), the links, the state labels and meanings, and the waiting-for-assignment count.
- [ ] Implement, run all Validation Commands, and record the results.

### Task 3: The Master's side
- [ ] Add failing tests for the redirect, the landing, the removed claim, and the grouped My referrals (including the page-boundary case).
- [ ] Implement, delete the pool page and the claim route, run all Validation Commands, and record the results.

### Task 4: e2e journeys
- [ ] Rewrite the judicial journeys and update the deed-polls journeys as the Development Approach says; run them on the temporary private-port config; record the result; delete the config.

### Task 5: Documentation and final verification
- [ ] Update `CLAUDE.md` and regenerate the Welsh CSV with `yarn welsh:extract`.
- [ ] Run all Validation Commands once more with `--force`, record the counts against the baseline, and confirm `git status` is clean apart from the task commits.

## Execution notes
