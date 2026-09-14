# Plan 07: tell a caseworker a case needs two witnesses before they try to enrol it

## Overview

A deed poll needs **two witnesses**, and api refuses the enrolment transition without them —
`deed-poll-api/docs/plans/witness-count-gate-on-enrolment.md`. This plan is about the caseworker's side of that:
**knowing before saving, not after.**

### The refusal reaches further than "setting an enrolment date" — do not assume otherwise

**Confirmed against the merged api implementation (`deed-poll-api#12`, `62c76f4`).** The rule is checked against
the **merged** record, as every rule on that path is, so **a patch touching *any* field of a case that already
carries an enrolment date is refused** while that case has fewer than two witnesses — not only a patch that sets
the date. Editing a surname on an already-enrolled case will do it.

That is consistent rather than a defect, and the escape is the same shape as escaping a contradictory date pair:
clear the date, or add the missing witnesses. But it means **a caseworker can meet this refusal without trying to
enrol anything**, so:

- **Wording must not say "you cannot enrol this"** as though the caseworker had just attempted an enrolment. Say
  what is true — the case has fewer than two witnesses recorded, and the enrolment date it carries needs them.
- **The banner is driven by the case's state, not by what the caseworker is currently editing.** A case that
  carries an enrolment date and one witness is in that condition on arrival, not at save time.

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
   - **The signature and enrolment tabs** — that the case has fewer than two witnesses and its enrolment dates
     need them. Answers *"why can I not save this?"* — which, per the section above, a caseworker may be asking
     about an edit that had nothing to do with enrolment.
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

**Baseline verified green on master, 2026-09-14: lint exit 0, `1,361` tests across 8 of 8 packages, build 8 of 8.** **The skip count moves with the environment and is not a signal** — the three Redis session tests
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

**Verified 2026-09-14, both fields, and it works — no plumbing needed.** Read from api at `62c76f4`,
`DeedPollService.requireWitnessesForEnrolment`: the refusal is an `InvalidInputError("Case cannot be sent for
enrolment")` carrying **one** `FieldError`, addressed by `enrolmentDateToAddress` to `dateEnroled` when the patch
sets it, otherwise `signatureReceivedDate`, otherwise whichever date the merged record carries. The message is
`ENROLMENT_WITNESSES_MESSAGE` plus a shortfall clause — *"A Deed Poll cannot be sent for enrolment until two
witnesses have been recorded. This case has one; please add one more witness."* (`…has none; please add two
witnesses.` at zero). `WITNESSES_REQUIRED_FOR_ENROLMENT = 2`.

Driven through the real `POST` handler and the real `deed-polls/edit.njk`, once per field, with a throwaway probe
(since deleted). For both `signature`/`signatureReceivedDate` and `enrolment`/`dateEnroled`:

- status 400, `errors` carrying api's field error unchanged
- `errorSummary` is `[{ text: <api's message>, href: "#<field>" }]` — `editableFieldNames` has both fields, so
  neither loses its link
- the rendered HTML contains `id="<field>"` — `govukDateInput`'s wrapper takes the field name as its id, so the
  summary link resolves to a real element, exactly as `edit.njk`'s comment claims
- one `govuk-error-message` block, on the date group, and the **submitted** parts are still in the boxes

**One gap, and it belongs to task 4's e2e journey, not here: the in-memory mock does not implement the gate.**
`libs/deed-poll-api-client/src/mock/server.ts` applies no witness check on the case PATCH, so nothing running
against the mock can provoke this refusal — the probe supplied api's `FieldError` directly. The e2e journey in
task 4 needs the mock to refuse first, or it will assert against a save that succeeds.

- [x] Both fields verified end to end, or the mapping failure reported with the field name api actually sends

### Task 2: The witness count on the subgrid

In `detail.njk`'s witnesses subgrid, show how many witnesses are recorded against how many are needed, reading
the threshold from api's own value rather than a literal `2`. Show it whether the count is short **or** met — a
caseworker checking a complete case should see that it is complete, and a count that only appears when something
is wrong reads as an error rather than a status.

**Done 2026-09-14.** `libs/deed-poll/src/witnesses/enrolment-requirement.ts` names the threshold once —
`WITNESSES_REQUIRED_FOR_ENROLMENT`, mirroring api's constant with the citation, following
`witnesses/delete-policy.ts`'s "api enforces this; this is the presentation mirror" shape. `witnessCountText`
builds the sentence; `[id].ts` passes it as `witnessCount` and `detail.njk` renders it as a `govuk-caption-m`
above the subgrid, outside the `case.witnesses.length` check so a case with none states its count too.

Two forms, because api sets no maximum: `"1 of 2 witnesses recorded"` at or below the requirement, and
`"3 witnesses recorded, 2 required"` above it — `"3 of 2"` reads as a defect rather than a count.

The sentence is view-model data rather than an `en` label: it interpolates the case's count, as `notes` and
`header` already do, and `en` on this page holds only static labels. Decision 6's placement still holds for
the static labels task 3 adds.

- [x] Count rendered from api's threshold, present whether the requirement is met or not

### Task 3: The warning on the signature and enrolment tabs

A `govukNotificationBanner` on those two tabs when the case has fewer than two witnesses, linking to the witnesses
tab so the caseworker can act on it. Follow `detail.njk:34`'s pattern.

**Wording:** state the shortfall and what it affects, not an action the caseworker may not have attempted — see
the section above. Read api's `ENROLMENT_WITNESSES_MESSAGE` and `WITNESSES_REQUIRED_FOR_ENROLMENT` so the
proactive and reactive text cannot drift apart.

Do not show it on the other tabs: it is not true there, and a banner that appears everywhere is ignored everywhere.

**Done 2026-09-14.** `enrolmentWitnessWarning(tab, recorded)` joins `witnessCountText` in
`libs/deed-poll/src/witnesses/enrolment-requirement.ts`, returning `null` when there is nothing to say.
`[tab].ts`'s `render` passes it as `witnessWarning` — so it is on the GET **and** on the 400 re-render, where
it explains the refusal the caseworker has just met — and `edit.njk` renders it as a `govukNotificationBanner`
with `type: "important"`, above the h1 and below the error summary, matching `detail.njk:34`.

**Which tabs is derived, not listed.** The banner shows on a tab because that tab carries
`signatureReceivedDate` or `dateEnroled` — the two fields api addresses the refusal to — so if a date moves
tab the warning moves with it. That is `signature` and `enrolment` today; `application`, `referral`, `return`
and `refund` are pinned as silent.

**Wording**, at one witness: *"1 of 2 witnesses recorded. A Deed Poll cannot be sent for enrolment until 2
witnesses have been recorded, so a case carrying an enrolment date cannot be saved while it is short. Add 1
more witness."* The middle clause is api's `ENROLMENT_WITNESSES_MESSAGE` verbatim except for writing the
threshold as the constant rather than as the word api spells out. It says *a case carrying an enrolment date*
rather than *you cannot enrol this*, because the refusal reaches any edit to such a case — the merged-record
behaviour. `html` rather than `text` so the banner carries the way out: a link to `#witnesses` on the detail
page, labelled by `en.witnessWarningLink`.

- [x] Banner on `signature` and `enrolment` only, shown only when short, with a link to the witnesses tab

### Task 4: Tests

- Unit: the count/threshold presentation, including the boundary at one and at two, and at three
- Page: the banner renders on `signature` and `enrolment` when short, and **not** when the requirement is met
- Page: the banner does **not** render on the other tabs
- Page: api's field error still renders after this plan's changes — a regression guard for task 1's finding
- Page: **a case carrying an enrolment date and one witness is refused an edit to an unrelated field**, and the
  banner explains why. This is the merged-record behaviour from the section above; without a test it is the case
  everyone forgets, because it does not look like an enrolment at all
- e2e: one journey — a case with one witness, a caseworker attempts to set the enrolment date, sees the refusal,
  adds a second witness, and the date then saves

**Partly covered already**, since tasks 2 and 3 landed with their own tests: the count/threshold boundaries
(0, 1, 2, 3) in `enrolment-requirement.test.ts`, and the banner's presence on `signature`/`enrolment`, its
absence once met and on the four silent tabs, in `[tab].test.ts`. Still outstanding here: **api's field error
still rendering** as a regression guard for task 1, **the edit to an unrelated field on a case carrying a date
and one witness**, and the **e2e journey** — which needs the mock to implement the gate first, per task 1's gap.

**Done 2026-09-14**, and the three outstanding items brought two changes with them rather than tests alone.

**The mock now implements the gate** — task 1's recorded gap. `enrolmentWitnessError` in
`libs/deed-poll-api-client/src/mock/server.ts` restates `requireWitnessesForEnrolment` including
`enrolmentDateToAddress`'s precedence, runs after the date rules as api orders them, and is on update only
because api does not gate a create. It is the sixth rule in that file's list, and the list says so. Its own
tests are in `server.test.ts`. Two `client.test.ts` tests were passing only because the mock was permissive
and now arrange the two witnesses first (`enrollableCaseId`); the existing e2e create journey does the same,
since Signature Received is one of the two gated dates.

**The banner now also follows a refusal onto whatever tab was submitted.** `enrolmentWitnessWarning` takes
the refused fields as a third argument, and warns when the tab carries an enrolment date **or** the refusal
is addressed to one. Without it the merged-record case — a surname edited on a case already carrying a date —
renders api's count with a **dead** summary link, because `dateEnroled` has no control on the Application
tab, and offers no route to the witnesses at all. Derived from the field names api addresses, not matched on
its message text. Task 3's decision is untouched: on a GET the four other tabs are still silent, and their
test pins that.

- [x] Unit: the count/threshold boundaries, plus the refused-field trigger and its two negative cases
- [x] Page: api's refusal rendered against `signatureReceivedDate` and `dateEnroled` with a resolving
      summary link — task 1's regression guard, one case per field
- [x] Page: the unrelated edit refused on a case carrying a date and one witness — dead summary link, banner
      present, typed surname kept
- [x] e2e: the journey written — count on the subgrid, banner before typing, api's refusal, the banner's link
      taken to the witnesses, second witness added, the same date then saving. **Written, not yet run:**
      running it from cold is task 5

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
