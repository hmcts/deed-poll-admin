# Plan 07: tell a caseworker a case needs two witnesses before they try to enrol it

## Overview

A deed poll needs **two witnesses**, and api refuses the enrolment transition without them —
`deed-poll-api/docs/plans/witness-count-gate-on-enrolment.md`. This plan is about the caseworker's side of that:
**knowing before saving, not after.**

### Most of the reactive half already works — verify it, do not rebuild it

api throws `InvalidInputError` with a `FieldError` addressed to `signatureReceivedDate` or `dateEnroled`, and this
app already handles that shape:

| | Where |
| --- | --- |
| Catches `InvalidInputError` | `src/pages/deed-polls/[id]/edit/[tab].ts:88` |
| Re-renders the form with api's field errors | `:100`, via `rerenderWithErrors` |
| Builds the error summary, mapping field → control | `:140`, `buildErrorSummary(errors, tab)` |

Both fields live on tabs that exist — `signatureReceivedDate` on the `signature` tab
(`libs/deed-poll/src/deed-poll/form-fields.ts:240`), `dateEnroled` on `enrolment` (`:259`) — so the message should
render in place with a working summary link and **no new plumbing at all**. Task 1 is to prove that, not to build
it. If it turns out not to work, that is a finding worth more than this plan.

### The actual work is the proactive half

Discovering at save time that a case cannot be enrolled is a poor experience, and the caseworker may have set
several dates before finding out. Witnesses already arrive with the case — `findDeedPoll` includes the children in
one query — so **the count is available everywhere it is needed, with no extra call.**

## Decisions taken — implement these, do not revisit

1. **No permission check anywhere in this plan.** The two-witness rule applies to every caseworker; it is nothing
   to do with the Administrator split that governs witness *deletion*.
2. **Do not re-implement the rule in this repo.** The count threshold lives in api. This app may *read* the count
   to decide what to show, but the refusal is api's and this app must not decide independently that a case is
   enrollable — that is the "a rule enforced only in the UI is not a rule" principle from plan 06, in reverse. If
   the two ever disagree, api wins and the UI is the bug.
3. **Follow the existing banner pattern.** `detail.njk:34` already renders a `govukNotificationBanner` driven by
   `presentation.privacy.bannerText`. Use the same component and the same shape rather than inventing a second
   way to say something case-level.
4. **Two placements, because they answer different questions:**
   - **The witnesses subgrid** — how many are recorded against how many are needed. Answers *"is this case
     complete?"* while the caseworker is looking at witnesses.
   - **The signature and enrolment tabs** — that enrolment is blocked until two are recorded. Answers *"why can I
     not save this?"* at the moment they are about to try.
5. **Wording states the shortfall, not the rule.** "1 of 2 witnesses recorded" tells a caseworker what to do;
   "a deed poll requires two witnesses" makes them work it out. Match api's message so the proactive and reactive
   text do not contradict each other — **read api's actual constant, do not paraphrase it.**
6. **Labels go inline in the page handler**, beside `addNote` / `witnessAddress` in `src/pages/deed-polls/[id].ts`,
   which is this page's existing pattern. English-only, like every other label there — see the open question.

## Open questions — flagged, NOT answered here

- **Welsh.** The detail page's labels are inline English strings, not keys in `src/locales/cy.ts`. New labels here
  are English-only **like every other label on that page**. This plan neither introduces nor fixes that; if Welsh
  is wanted it is a page-wide piece of work. Flagged so decision 6 is not read as a shortcut.
- **At least two, or exactly two?** api implements *fewer than two* as the refusal. If the business means exactly
  two, api changes and this plan's wording follows it. **Read api's constant rather than hardcoding "2"** so this
  does not need a second edit.

## Constraints

- **No `prisma.*`, no migration, no JSON route.** There is no database in this repo — Prisma was removed in
  `#80`. Every read goes through `libs/deed-poll-api-client`.
- **`Caller` is `{ accessToken }` and nothing else.**
- **Do not add a witnesses field to the case form.** `form-fields.ts:320` keeps the witnesses tab a subgrid.
  A banner and a count are presentation, not fields.
- **Never run bare `yarn test`.** It reports `0 successful, 8 total` / `Tests no tests` — nothing ran, so nothing
  failed. Use `yarn turbo test test:app --concurrency=1`.
- **`yarn lint` is a single `biome check .`** It exits 0 today with two pre-existing `noUndeclaredEnvVars`
  warnings and a stale `biome.json` schema notice. Leave those; do not let the count grow.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

**Baseline verified green on master (`f62fed7`), 2026-09-13: lint exit 0, `1,361` tests across 8 of 8 packages,
build 8 of 8.** **The skip count moves with the environment and is not a signal** — the three Redis session tests
skip when no cache is reachable and pass when one is. **Compare totals, not passed counts.**

Deliberately **not** here: `yarn test:e2e` and count comparisons. e2e needs Docker, a seeded IDAM simulator and a
browser; the rest are only true once the plan is finished. Both live in the final task.

## Tasks

### Task 1: Prove the reactive path already works, and stop if it does not

Before building anything: with api's gate in place, set `signatureReceivedDate` on a case with one witness and
confirm the message renders **against the field** with a **working error-summary link**. Same for `dateEnroled`.

If it works, record that in the plan and move on — **no code changes in this task.** If it does not, the reason is
the finding: most likely the field name api sends does not map to a control on that tab, which would also affect
every other cross-field error and is worth more than this plan.

- [ ] Both fields verified end to end, or the mapping failure reported with the field name api actually sends

### Task 2: The witness count on the subgrid

In `detail.njk`'s witnesses subgrid, show how many witnesses are recorded against how many are needed, reading
the threshold from api's own value rather than a literal `2`. Show it whether the count is short **or** met — a
caseworker checking a complete case should see that it is complete, and a count that only appears when something
is wrong reads as an error rather than a status.

- [ ] Count rendered from api's threshold, present whether the requirement is met or not

### Task 3: The warning on the signature and enrolment tabs

A `govukNotificationBanner` on those two tabs when the case has fewer than two witnesses, saying enrolment is
blocked until two are recorded and linking to the witnesses tab so the caseworker can act on it. Follow
`detail.njk:34`'s pattern.

Do not show it on the other tabs: it is not true there, and a banner that appears everywhere is ignored everywhere.

- [ ] Banner on `signature` and `enrolment` only, shown only when short, with a link to the witnesses tab

### Task 4: Tests

- Unit: the count/threshold presentation, including the boundary at one and at two, and at three
- Page: the banner renders on `signature` and `enrolment` when short, and **not** when the requirement is met
- Page: the banner does **not** render on the other tabs
- Page: api's field error still renders after this plan's changes — a regression guard for task 1's finding
- e2e: one journey — a case with one witness, a caseworker attempts to set the enrolment date, sees the refusal,
  adds a second witness, and the date then saves

- [ ] All five, including the "not on other tabs" case and the e2e journey

### Task 5: Full validation

- [ ] `yarn lint` — exits 0, still only the two pre-existing warnings and the schema notice
- [ ] `yarn turbo test test:app --concurrency=1` — 8 of 8, total above **1,361** (master at `f62fed7`). Compare
      totals, not passed counts
- [ ] `yarn build` — 8 of 8
- [ ] **e2e actually run, not just written.** From cold, and steps 4–6 are what separate a real result from an
      afternoon chasing a phantom:
      1. `docker compose up -d` (redis 6379, IDAM simulator 5556 — a JVM; `curl 127.0.0.1:5556/health` → 200)
      2. **`yarn idam:users`** — a fresh simulator has an empty user store, and the failure looks like a broken
         login: the journey parks on the IDAM page and Playwright reports `toHaveURL` timing out
      3. `yarn playwright install chromium` if the version has moved — 1.63.0 wants `chromium_headless_shell-1243`
      4. **Pre-warm the app *and* the mock api.** `REDIS_URL=redis://127.0.0.1:6379 yarn mock:api &` and
         `REDIS_URL=redis://127.0.0.1:6379 yarn dev:nowatch:web &`, then wait for `:3000`. **The app takes 40–75s
         to bind**, nearly all of it the Azure Key Vault DNS lookup timing out, which blows Playwright's 120s
         `webServer` budget and presents as a **dead** server. **Pre-warming the app alone leaves readiness at 503
         until the mock on 3200 is up** — check `curl 127.0.0.1:3000/health` reports both `redis` and
         `deedPollApi` UP before starting
      5. **`--workers=1`.** At the default 7 this suite is unreliable here — `page.goto` timeouts scattered across
         specs you never touched. **The same starvation that makes bare `yarn test` false-red**, one layer up, so
         a parallel red run is not evidence of a regression
      6. `REDIS_URL=redis://127.0.0.1:6379 yarn test:e2e --workers=1`
      **Baseline 22 passed** at `f62fed7`. This plan should make it 23.
- [ ] `git grep -n "'2'\|\"2\"\| 2 " -- src/pages/deed-polls/detail.njk` shows no hardcoded threshold —
      decision 5 and the second open question
- [ ] Mark completed

## Deliberately not in this plan

- **The rule itself.** `deed-poll-api/docs/plans/witness-count-gate-on-enrolment.md`. This plan must not decide
  independently whether a case is enrollable — decision 2.
- **Blocking the form client-side.** api refuses; this app explains. A UI that refuses to submit would diverge
  the moment api's rule changes.
- **A maximum witness count.** api's open question. If it arrives, this plan's wording follows api's constant.
- **Welsh.** See the open questions — pre-existing and page-wide.
- **Any permission check.** Decision 1.
