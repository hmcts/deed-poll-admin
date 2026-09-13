# Plan 06: offer witness deletion to Administrators only

## Overview

Adds a delete control to the witness amend page, **shown only to Administrators**.

The business document puts "Delete witnesses" at **✗ for Basic User, ✓ for Administrator** — the same split as
notes. This repo has already solved that exact problem once, so this plan is mostly "do what plan 04 did":
`docs/plans/completed/04-hide-note-delete-from-caseworkers.md`.

### Sequencing — both gates are released

1. **`deed-poll-api#9` merged 2026-09-13** (`051f3b4`). `DELETE /caseworker/cases/{id}/witnesses/{witnessId}` now
   exists, returns `204 No Content`, and **refuses a non-Administrator in the domain** — `WitnessService.removeWitness`
   calls `requireAnyRole(DEEDPOLL_ADMIN)` before it resolves the witness, so a forged request gets a 403 whether or
   not the witness exists.
2. **`docs/plans/completed/05-witness-create-and-edit.md` merged** as `deed-poll-admin#95`
   (`8034540`). It created `src/pages/deed-polls/[id]/witnesses/[witnessId]/edit.ts` and `witness-edit.njk`, which
   this plan adds a control to, and the service writes this plan adds `removeWitness` beside.

**This is the last of the four witness plans.** Nothing follows it.

### The order that matters

**Server-side enforcement is already in place, so this plan is not a security change.** Plan 04 recorded that
hiding a control is a courtesy and api's refusal is the rule. That refusal exists: `#9` gates
`WitnessService.removeWitness` in the *domain* rather than on the route, so a Basic User who forges the request
gets a 403 regardless of what this page renders — and would still get one from a future caller that is not this
app at all.

**This plan is therefore about not offering an action that would be refused.** If it is skipped, nothing is
insecure; a caseworker is just shown a button that 403s. That is the whole of the risk, and it is worth being
clear about so the work is not justified on grounds it does not have.

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

**Never bare `yarn test`** — it reports success having run nothing. **Baseline verified green on master
(`8034540`) immediately before hand-over, 2026-09-13: lint exit 0, `1,339` tests across 8 of 8 packages, build 8
of 8.** That already includes the 58 plan 05 added, so 1,339 is the number to beat.

**The skip count moves with the environment and is not a signal.** The three Redis session tests skip when no
cache is reachable and pass when one is, so "1,336 passed / 3 skipped" and "1,339 passed / 0 skipped" are both
healthy. **Compare totals, not passed counts.**

Deliberately **not** here: `yarn test:e2e` and the `git grep` assertions. e2e needs Docker, a seeded IDAM
simulator and a browser install; the greps are only true once task 1 and 3 are done. Both live in the final task —
and per the constraint above, **e2e must actually be run there**, not merely written.

## Tasks

### Task 1: Name the rule

`libs/deed-poll/src/witnesses/delete-policy.ts` with `canDeleteWitness` and its permission interface, copying
`notes/delete-policy.ts`. Two unit tests: an Administrator may, a roleless caseworker may not.

- [x] `canDeleteWitness` named in its own module, with its two unit tests

### Task 2: Client and service

**The vendored `openapi.json` does not yet carry the `DELETE`** — as of `8034540` the witness item path has only
`get` and `patch`, because api#9 landed after plan 05 refreshed it. **Get it from api rather than hand-editing:**

```bash
cd ../deed-poll-api && TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration
cp /tmp/openapi-specs.json libs/deed-poll-api-client/openapi.json   # from this repo's root
```

`contract.test.ts` pins `client.ts` against that file, so a hand-written path that drifts from what api serves
gives a green contract test against a fiction. Check the copied file contains `delete` on
`/caseworker/cases/{id}/witnesses/{witnessId}` before going further, and update `SPEC-PROVENANCE.md` as plan 05
did.

**The refreshed spec will declare 19 operations, 18 of them `/caseworker/**`** — the nineteenth is `GET /`. api's
`OpenAPIPublisherTest` asserts the caseworker count, so both numbers are right and neither is a bug.

Then add `removeWitness` to `src/api/client.ts` and the mock, and a one-line `removeWitness` to
`libs/deed-poll/src/witnesses/service.ts` mirroring `notes/service.ts:66`.

- [x] Spec refreshed **from api**, `delete` present on the witness item path, `removeWitness` in `client.ts`, the
      mock and the service, `contract.test.ts` green

      Done at api `051f3b4` via `./gradlew integration --rerun-tasks`; 19 operations, 18 of them `/caseworker/**`,
      as the plan predicted. The adapter function is `deleteWitness`, not `removeWitness`: `client.ts` names
      adapter functions after the HTTP verb (`deleteNote`) and the service names the domain operation
      (`removeNote`), so `removeWitness` is the service's name and mirrors `notes/service.ts` exactly. The
      refresh also renamed the note delete's `operationId` to `delete_1` — springdoc names operations after
      handler methods and the suffix moves as controllers are added, which is why nothing keys off one;
      `SPEC-PROVENANCE.md` records it. The mock's `405`-on-DELETE test became a `204` test, and its Administrator
      gate is deliberately not modelled — the mock reads no roles from a token, so a 403 is api's test, not one
      that can be written here.

### Task 3: Thread it into the amend page and hide the button

In `witnesses/[witnessId]/edit.ts`, pass `canDelete: canDeleteWitness(userFromRequest(req))` from **both** `GET`
and `rerender`. Handle the `action=delete` POST. In `witness-edit.njk`, wrap only the delete button.

- [x] Flag passed from `GET` **and** rerender; template guards only the delete control

      `edit.ts:95` and `edit.ts:174` are the two render sites, and `witness-edit.njk:79` the one guard —
      around the `action=delete` button alone, with the form, the four controls and Save outside it. The
      `action === "delete"` branch is first in `POST`, before `safeParse`, so an over-long field cannot block a
      deletion, and it is deliberately ungated: api refuses a forged POST and a second refusal here would put
      the authority in two places. Two incidental changes the note page had already made: the Save button
      gained `name="action" value="save"` so the branch has something to read, and the button plus cancel link
      moved into a `govuk-button-group` — a bare link beside two buttons does not space correctly. No
      confirmation step, following the note delete rather than giving the same act a second voice.

### Task 4: Tests

- The two policy tests from task 1
- Page: the button renders for an Administrator and not for a roleless caseworker — asserted on `GET` **and** on
  the re-render after a validation error, per decision 3
- Page: `action=delete` as an Administrator calls the service and redirects; as a caseworker, assert whatever the
  handler does with an action it did not offer
- Service: `removeWitness` forwards ids and `Caller` unchanged
- e2e: extend the plan 05 journey — an Administrator deletes a witness and it leaves the detail page; a
  caseworker on the same page **is not offered the button**

- [x] Policy, page (both render paths), service and e2e cases present

      The policy pair landed in task 1 and the four `removeWitness` service cases in task 2, so this task
      added the page's thirteen and the e2e pair. Both re-render assertions are there — `canDelete` false for
      a caseworker and **true** for an administrator after a rejected save, because a `rerender` that
      hard-coded `false` would pass the first on its own. The forged `action=delete` from a roleless session
      asserts the service **is** called and no `403` is set: the handler is deliberately ungated and api owns
      the refusal, so a test demanding a local refusal would pin the opposite of decision 5.

      Two e2e changes, not one. The plan 05 journey asserted `Delete` was **absent** for an administrator —
      correct while api published no `DELETE`, and a false claim now — so it now asserts the button is
      visible, deletes through it, and finds the tab back at "None recorded.", which is also the open
      question's answer in passing: the case's only witness may go. That made the test's name wrong too
      (`caseworker adds a witness…` under the admin fixture, the exact mistake the notes journey's docblock
      records), so it is now `administrator adds a witness, amends it, and deletes it`, and the file docblock
      no longer calls the witness journey role-agnostic. The new roleless test is the 22nd, as predicted.

      Totals after this task: lint exit 0 with the two known warnings, **1,361** tests across 8 of 8
      (baseline 1,339), build 8 of 8.

### Task 5: Full validation

- [ ] `yarn lint` — exits 0, still only the two pre-existing warnings and the schema notice
- [ ] `yarn turbo test test:app --concurrency=1` — 8 of 8, total above **1,339** (master at `8034540`, verified
      2026-09-13). Compare totals, not passed counts — see the note above about skips
- [ ] `yarn build` — 8 of 8
- [ ] **e2e actually run, not just written.** From cold, and steps 4 and 5 are what make the difference between a
      real result and an afternoon spent chasing a phantom:
      1. `docker compose up -d` (redis 6379, IDAM simulator 5556 — a JVM; `curl 127.0.0.1:5556/health` → 200)
      2. **`yarn idam:users`** — a fresh simulator has an empty user store. Miss this and the journey parks on the
         login page and Playwright reports `toHaveURL` timing out, which reads as a broken login. It seeds
         `admin@example.com` (`caseworker-deedpoll-admin`) and `caseworker@example.com` (no roles) — **both roles
         this plan needs**
      3. `yarn playwright install chromium` if needed — 1.63.0 wants `chromium_headless_shell-1243`
      4. **Pre-warm the app**, because Playwright's 120s `webServer` budget is not enough here:
         `REDIS_URL=redis://127.0.0.1:6379 yarn dev:nowatch:web &`, wait for `:3000` to answer, then run the suite
         — `reuseExistingServer` adopts it. **The app takes 40–75s just to bind**, nearly all of it the Azure Key
         Vault DNS lookup timing out, and a blown budget presents as a **dead** webServer rather than a slow one
      5. **`--workers=1`.** At the default 7 workers this suite is unreliable on this container: `page.goto`
         timeouts scattered across specs you never touched, plain page loads taking 13–20s. Serially they pass and
         loads drop to 2–8s. **This is the same starvation that makes bare `yarn test` false-red**, one layer up,
         so a parallel red run is not evidence of a regression
      6. `REDIS_URL=redis://127.0.0.1:6379 yarn test:e2e --workers=1` — `127.0.0.1`, never `localhost` (`::1` vs
         Docker's IPv4)
      **Baseline 21 passed** at `8034540`. This plan should make it 22.
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
