# Plan: referrals to the judiciary (admin follow-up 5) — lifecycle-note mock parity

## Overview

The API lifecycle-note plan,
`deed-poll-api/docs/plans/referrals-api-5-lifecycle-case-notes.md`, makes successful referral transitions
append entries to the application's existing Notes grid. No production admin page or wire contract changes:

- caseworkers already read case notes on the case detail page;
- judges already read the narrowed `caseNotes` projection on a judicial referral;
- the note DTOs are unchanged.

This companion plan keeps `libs/deed-poll-api-client`'s in-memory API behaviourally aligned with the deployed
API and proves the notes are visible through the existing caseworker and judicial pages. Without it, local
development and E2E tests would show a different referral timeline from deployed environments.

## Dependencies and reconciliation gate

Implement after:

1. `deed-poll-api` follow-up 4, which prevents withdrawal after direction;
2. `deed-poll-admin` follow-up 4, which adds the caseworker actioned/closure journey;
3. `deed-poll-api` follow-up 5, whose final note wording is the authority this mock reproduces.

Before coding, verify the refreshed OpenAPI document has no delta and that the existing note schemas and page
view models still render all stored notes without filtering by origin.

## Decisions — implement these, do not revisit

### 1. No production page or domain change

Do not add a lifecycle-note component, a new service call or a generated-note type. The case detail response
already carries notes, and judicial referral detail already carries `caseNotes`.

The only production-adjacent code change is the mock behaviour used by development and tests.

### 2. The mock reproduces API side effects at transition sites

Add one mock helper that appends a `MockNote` with:

- a generated note id;
- the exact API-approved prose;
- `createdBy` and `modifiedBy` set to the transition actor;
- matching `createdOn` and `modifiedOn`.

Use it for successful referral raise, claim, claim lapse, direction, withdrawal and closure. Do not append
for `touch`, reads or refused transitions. The existing transition helper may coordinate the state and note,
but it must not make every transition write the same note because each event has different prose and
authorship.

The mock currently stores notes in insertion order and passes that order directly to both detail responses,
while the API repository returns notes newest first. Sort a copy at the read projections; do not reverse the
stored array in place. Both caseworker `notes` and judicial `caseNotes` must expose the same newest-first
timeline.

The claim-lapse note remains service-account authored, matching API. If the mock does not currently execute
automatic lapse reclamation, do not invent a timer solely for this plan; cover the events the mock can
produce and keep the limitation explicit.

### 3. Prose parity is deliberate duplication

The note text is observable behaviour not described by OpenAPI. Reproduce the final strings from the API
plan exactly, with a comment linking to `ReferralNotes`.

Do not copy the 4,000-character `directionsText`; the direction note includes decision, Gazette answer and a
pointer to the referral. This keeps every mock note within the 2,000-character contract.

### 4. Existing note edit/delete behaviour remains

Lifecycle entries are ordinary case notes. The current caseworker UI may amend them and administrators may
delete them, exactly as deployed API permits. Do not add mock-only immutability or hide controls in admin.

This plan records operational history, not a tamper-proof audit log. A future immutability requirement must
change API data and authorization before admin can represent it.

## Validation Commands

**Added 2026-09-21, before the plan was run — it had none, and `ralphex` runs this section after every task.**
Without it there is no per-task gate at all: a task can leave the suite red and the next one starts anyway.

```bash
yarn lint
npx turbo test test:app --concurrency=1
```

**Verified green on this branch before Task 1** — `yarn lint` exits 0, and `8 successful, 8 total` across
**164 test files, 2,981 tests**. That is the baseline Task 0 was asked to record and Task 3 measures against.

**Two commands in Task 3's list are deliberately NOT here, and putting them here would break every task:**

- **`yarn welsh:check` exits 1 on `master`** — 446 strings, 421 still identical in `cy` (414 prose), the
  repo-wide `cy = { ...en }` state pending the translation request. Measured on a clean tree, not assumed. A
  gate that starts red fails every task from the first one, which is the single rule this section has.
  **It is not one of the six Jenkins-owned scripts**, so it does not fail the build either. Task 3 runs it to
  confirm this plan has not *added* to that debt — compare the count, do not expect a zero exit.
- **`yarn test:e2e` needs a running app and mock**, costs minutes, and **cannot start its own `webServer` from
  inside a git worktree**: `dev:nowatch:web` runs `yarn dev:up`, and docker compose names its project after the
  directory, so it collides with the `deed-poll-redis`/`deed-poll-idam` containers the main checkout owns. Start
  the mock and the app by hand without `dev:up` and let `reuseExistingServer` find them. Task 3's business.

`yarn turbo test test:app --concurrency=1` and `npx turbo …` are equivalent here; both were run and both exit 0.
**Use the `--concurrency=1` form either way** — a bare `yarn test` reports failure with `0 successful, 8 total`
and "no tests" while running nothing at all, which reads as a red suite and is not one.

## Tasks

### Task 0: Reconcile API wording and current note surfaces

> **DONE 2026-09-21, by hand in a Claude Code session rather than as a ralphex task**, because it decides whether
> the plan runs at all and it reads another repo. Every gate passes; nothing was changed but this plan.
>
> **api follow-up 5 is merged** — `referrals-api-5` as PR **#35**, `origin/master` at
> `7226fc92c05421434e79520eec00b9b6e1e45cf5`, its plan moved to `completed/`, the clone clean and idle.
>
> **The contract is unchanged, and that is measured rather than taken from api's commit message.** api's own
> `2dd416e` claims "the contract unchanged"; regenerating the document per `SPEC-PROVENANCE.md` and comparing it
> to `libs/deed-poll-api-client/openapi.json` shows **the whole document is byte-identical** — 38 operations and
> 37 schemas both sides, nothing added, removed or altered in any property, and no parameter description moved.
> **So `openapi.json` needs no refresh, and this plan carries none of the atomic-refresh risk notify-2 did.**
>
> **The note surfaces are as the plan assumed:**
>
> - `record.notes` is what the case detail response carries, unfiltered;
> - the judicial projection is `server.ts:2057` — `caseNotes: record.notes.map(…)`, the **same** notes, with no
>   filter by origin, author or anything else, so a generated note is visible to a judge by construction;
> - follow-up 4's transitions are both already in the mock — `withdrawal` at `server.ts:671` and `closure` at
>   `server.ts:679`;
> - **neither read sorts**, which confirms decision 2's premise: the mock passes insertion order straight through
>   where api's repository returns newest first. That is the difference Task 1 exists to close.
>
> **The six events and where their prose actually lives.** api composes each in
> `ReferralNotes.java` at the pinned commit above — `raised`, `claimed`, `directionRecorded`,
> `directionActioned`, `withdrawn`, `claimLapsed`, plus the shared `identifies()` fragment
> (`"raised on {d MMMM yyyy}, reasons: {…}"`). **Read that file directly rather than a transcription of it.** This
> task was asked to "copy its final event matrix and exact strings" into the plan and deliberately has not: the
> mock is already a second copy of prose that lives in Java, and a third copy in a plan is one more place to rot
> while looking authoritative. Decision 3 stands — the mock reproduces the strings exactly, with a comment
> pointing at `ReferralNotes` — and the plan points at the source instead of restating it.
>
> **One thing api's own docblock settles that Task 1 must not "tidy".** `claimLapsed` **names the judge who held
> the referral**, and that is deliberate and Steve's decision of 2026-09-18: the note reaches other judges
> through `JudicialReferralDetail`, so the judge picking a lapsed referral out of the pool learns who had it and
> can go and ask them. Do not drop the name to narrow judicial visibility.
>
> **Baselines recorded** — see "Validation Commands" above: 164 test files, 2,981 tests, `yarn lint` exit 0.
>
> **And the plan had no `## Validation Commands` section at all**, which is a defect in the plan rather than a
> finding about the code; one has been added, with the two commands that must stay out of it.

Confirm API follow-up 5 is merged, copy its final event matrix and exact strings, and verify:

- case detail maps `record.notes`;
- judicial detail maps the same notes into `caseNotes`;
- no response schema or page filtering change is required;
- follow-up 4's withdrawal and closure behaviour is present in the mock.

Record focused adapter/app/E2E baselines. Stop on contract drift.

- [x] API wording, mock transitions and existing note views reconciled; baselines recorded; no files changed

      **Done 2026-09-21** — see the block above. One departure, stated rather than hidden: the exact strings are
      **not** copied into this plan. `ReferralNotes.java` at api `7226fc9` is the authority and Task 1 reads it
      directly; a copy here would be a third home for prose that already has two. Nothing changed but this file.

### Task 1: Add mock lifecycle-note side effects

**Read the prose from api's own source, at the commit Task 0 pinned.** Do not transcribe it from this plan or
from api's plan document — neither is the authority:

```bash
cd ../../../deed-poll-api && git show 7226fc92c05421434e79520eec00b9b6e1e45cf5:src/main/java/uk/gov/hmcts/reform/deedpoll/domain/referrals/ReferralNotes.java
```

**`git show <sha>:<path>`, not a checkout.** That reads out of the object database and touches neither that
clone's working tree nor its `HEAD` — another agent works in it, and switching its branch under them is how a
commit landed on the wrong branch on 17 September.

Six events: `raised`, `claimed`, `directionRecorded`, `directionActioned`, `withdrawn`, `claimLapsed`, sharing an
`identifies()` fragment. **Keep the judge's name in the lapse note** — Task 0 records why.

Implement the note helper and call it from each successful mock referral transition the API records. Extend
`server.test.ts` to prove:

- one note per successful transition with the correct actor and timestamp;
- raised → claimed → directed → actioned creation sequence, exposed newest first by the note reads;
- withdrawal history on the pre-direction branch;
- no note for a refused withdrawal, claim, direction or closure;
- full direction text is absent from the direction note;
- case detail and judicial detail expose the same generated events newest first through their existing
  projections, without mutating insertion order.

No `WIRE_SCHEMAS`, operation registry or OpenAPI changes.

- [ ] Mock lifecycle side effects match API and are covered through both existing read projections; contract
      tests green

### Task 2: Extend the end-to-end referral journey

Extend the caseworker completion journey from admin follow-up 4 rather than adding one test per note. After
raise → claim → direction → actioned:

- open the case Notes tab;
- verify each lifecycle event and actor is visible in the grid's established newest-first order;
- verify the direction's full text remains on the referral detail rather than being copied into the note;
- switch to the judicial persona before closure and verify the allowed lifecycle notes are visible in the
  existing read-only notes section;
- include accessibility and Welsh assertions within the journey.

Keep the existing withdrawal journey and assert its raised/withdrawn notes there.

- [ ] Caseworker and judicial E2E journeys show the deployed lifecycle history without additional page code

### Task 3: Documentation and full validation

Update mock comments and completed referral-plan cross-links that say judges write no notes or that the mock
does not model transition notes.

Run:

```bash
yarn turbo test test:app --concurrency=1
yarn lint
yarn welsh:check
yarn test:e2e
```

**Two of those four do not exit 0, and neither is this plan's fault — read "Validation Commands" before treating
either as a failure.**

- **`yarn welsh:check` exits 1 on `master`**: 446 strings, **421** still identical in `cy` (414 prose). Run it to
  confirm this plan has not *added* to that count, and record the number you get beside 421. A zero exit is not
  available and is not the goal.
- **`yarn test:e2e` cannot start its own `webServer` from a worktree.** Start the mock and app by hand, without
  `yarn dev:up`, and let `reuseExistingServer` find them on 3200 and 3000. If port 3200 is already held, it
  belongs to another agent's worktree — **do not kill it**; wait, or report and stop.

Record final totals against Task 0's **164 test files / 2,981 tests** and verify the six Jenkins-owned package
scripts remain.

- [ ] Documentation current; full app, lint, Welsh and E2E validation green; final totals recorded

## Out of scope

- New production admin pages or service calls.
- A generated-note badge or immutable-note controls.
- A new note/referral API contract.
- A judicial “My referrals” list, planned in `referrals-admin-6-judicial-my-referrals.md`.
- Claim-lapse scheduling that the mock does not already implement.
