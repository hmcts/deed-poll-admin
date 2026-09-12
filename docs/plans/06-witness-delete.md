# Plan 06: offer witness deletion to Administrators only

## Overview

Adds a delete control to the witness amend page, **shown only to Administrators**.

The business document puts "Delete witnesses" at **✗ for Basic User, ✓ for Administrator** — the same split as
notes. This repo has already solved that exact problem once, so this plan is mostly "do what plan 04 did":
[`completed/04-hide-note-delete-from-caseworkers.md`](completed/04-hide-note-delete-from-caseworkers.md).

### Sequencing — two hard dependencies

1. **`deed-poll-api/docs/plans/witness-delete.md` merged.** That plan adds the route *and* the role gate. Until
   then there is nothing to call.
2. **[`05-witness-create-and-edit.md`](05-witness-create-and-edit.md) merged.** This plan adds a button to the
   amend page that plan creates, and a service function beside the writes it adds.

Running this in parallel with plan 05 means both editing the same new files.

### The order that matters

**Server-side enforcement goes first, and it already will have.** Plan 04 recorded that hiding a control is a
courtesy and the api's refusal is the rule; api's `witness-delete.md` gates
`WitnessService.removeWitness` in the domain, so by the time this plan runs, a Basic User who forges the request
gets a 403 regardless of what the page renders. **This plan is therefore about not offering an action that would
be refused** — not about security.

## Decisions taken — implement these, do not revisit

1. **Name the rule; do not inline `if (isAdmin)`.** Add `canDeleteWitness` in
   `libs/deed-poll/src/witnesses/delete-policy.ts`, mirroring `libs/deed-poll/src/notes/delete-policy.ts:18` and
   its `NoteDeletePermission` interface. Plan 04 decision 4 took this same call, and it is why
   `git grep isAdmin` over the notes pages returns nothing — the flag is read inside the rule.
2. **Hide, do not disable.** Plan 04's choice. A disabled button advertises a capability the user does not have.
3. **Read the flag in `GET` *and* in `rerender`.** This is the specific defect plan 04 task 3 had to close: a
   re-render after a validation error dropped the flag and the button reappeared. `edit.ts:70` and `edit.ts:130`
   in the notes page are the two sites; the witness page will have the same two.
4. **Wrap only the delete control.** In `note-edit.njk:64` the guard wraps just the `action=delete` button, not
   the form. Do the same — amending stays open to both roles.
5. **`removeWitness` in the service is one line through `callApi`**, mirroring `notes/service.ts:66`. It does not
   re-check the role: api derives that from the token and re-checking here would assert an identity this app
   never verified.
6. **Deletion is hard, and the confirmation text should say so plainly.** api removes the row — there is no
   recovery. Follow whatever wording the note delete uses rather than inventing a second voice.

## Open question — flagged, NOT answered here

- **May an Administrator delete a case's last witness?** api's plan enforces **no minimum**, because no artefact
  states one — checked `DeedPollValidation.java`, `reference/ts/deed-poll/deed-poll-validation.ts` and
  `reference/dataverse_tables/deedpoll/business_rules.md`, which mentions witnesses zero times. So this page will
  offer deletion of the only witness on a case. **If the business says a deed poll must retain a witness, the fix
  belongs in api** (a service rule, enforced for every caller) and this page then renders api's error. Do not
  implement a minimum here — a rule enforced only in the UI is not a rule.

## Constraints

- **No permission logic in a template beyond rendering the flag.** The rule lives in `delete-policy.ts`.
- **`Caller` is `{ accessToken }` and nothing else.**
- **An operation must be in `openapi.json` before `client.ts`** — `contract.test.ts` fails otherwise. Order:
  refresh spec → `client.ts` → mock → service → policy → page → template.
- **Never run bare `yarn test`.** It reports `0 successful, 8 total` / `Tests no tests` — nothing ran, so nothing
  failed. Use `yarn turbo test test:app --concurrency=1`.
- **The e2e suite is the only place the hide/show is exercised end to end**, and it runs in **no pipeline**. Plan
  04 left its new caseworker assertion written but never executed; **do not repeat that.** Run e2e by hand here —
  the cold-start recipe is in task 5.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn lint
yarn turbo test test:app --concurrency=1
yarn build
```

**Never bare `yarn test`** — it reports success having run nothing. Baseline verified green 2026-09-12 at
`c0c4c1c` (1,281 total: 1,278 passed, 3 skipped); take a fresh count from master before starting, since plan 05
lands first and will have raised it.

Deliberately **not** here: `yarn test:e2e` and the `git grep` assertions. e2e needs Docker, a seeded IDAM
simulator and a browser install; the greps are only true once task 1 and 3 are done. Both live in the final task —
and per the constraint above, **e2e must actually be run there**, not merely written.

## Tasks

### Task 1: Name the rule

`libs/deed-poll/src/witnesses/delete-policy.ts` with `canDeleteWitness` and its permission interface, copying
`notes/delete-policy.ts`. Two unit tests: an Administrator may, a roleless caseworker may not.

- [ ] `canDeleteWitness` named in its own module, with its two unit tests

### Task 2: Client and service

Add `removeWitness` to `openapi.json`, `client.ts`, the mock, then a one-line `removeWitness` in
`libs/deed-poll/src/witnesses/service.ts`.

- [ ] `removeWitness` through `openapi.json`, `client.ts`, the mock and the service

### Task 3: Thread it into the amend page and hide the button

In `witnesses/[witnessId]/edit.ts`, pass `canDelete: canDeleteWitness(userFromRequest(req))` from **both** `GET`
and `rerender`. Handle the `action=delete` POST. In `witness-edit.njk`, wrap only the delete button.

- [ ] Flag passed from `GET` **and** rerender; template guards only the delete control

### Task 4: Tests

- The two policy tests from task 1
- Page: the button renders for an Administrator and not for a roleless caseworker — asserted on `GET` **and** on
  the re-render after a validation error, per decision 3
- Page: `action=delete` as an Administrator calls the service and redirects; as a caseworker, assert whatever the
  handler does with an action it did not offer
- Service: `removeWitness` forwards ids and `Caller` unchanged
- e2e: extend the plan 05 journey — an Administrator deletes a witness and it leaves the detail page; a
  caseworker on the same page **is not offered the button**

- [ ] Policy, page (both render paths), service and e2e cases present

### Task 5: Full validation

- [ ] `yarn lint` — exits 0, still only the two pre-existing warnings and the schema notice
- [ ] `yarn turbo test test:app --concurrency=1` — 8 of 8, count above whatever plan 05 left (plan 05 started from
      **1,281**: 1,278 passed + 3 skipped, verified 2026-09-12 at `c0c4c1c`). **Take the baseline from master
      immediately before starting**, not from this line
- [ ] `yarn build` — 8 of 8
- [ ] **e2e actually run, not just written.** From cold:
      1. `docker compose up -d` (redis 6379, IDAM simulator 5556 — a JVM; `curl 127.0.0.1:5556/health` → 200)
      2. **`yarn idam:users`** — a fresh simulator has an empty user store. Miss this and the journey parks on the
         login page and Playwright reports `toHaveURL` timing out, which reads as a broken login. It seeds
         `admin@example.com` (`caseworker-deedpoll-admin`) and `caseworker@example.com` (no roles) — **both roles
         this plan needs**
      3. `yarn playwright install chromium` if needed — 1.63.0 wants `chromium_headless_shell-1243`
      4. `REDIS_URL=redis://127.0.0.1:6379 yarn test:e2e` — `127.0.0.1`, never `localhost` (`::1` vs Docker's IPv4)
- [ ] `git grep -n 'isAdmin' -- 'src/pages/deed-polls/\[id\]/witnesses'` returns **nothing** — decision 1 working.
      The check that should find something is `git grep -n 'canDelete' -- src/pages/`, which must show the two
      render sites plus the template guard. **Use the `canDelete` form**; plan 04's task 5 wrote the `isAdmin`
      form before the rule had a name, and it now reads as a regression when it is the opposite
- [ ] Mark completed

## Deliberately not in this plan

- **The api route or its role gate.** `deed-poll-api/docs/plans/witness-delete.md`.
- **Re-checking the role in this repo.** Decision 5.
- **A minimum-witness rule.** See the open question — if it is wanted it belongs in api.
- **Gating amend or add.** Both roles have them; plan 05 owns those and must stay ungated.
- **Soft deletion.** api deletes the row. If that is ever reversed, this page changes too.
