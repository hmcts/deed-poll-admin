# notify-6-admin — send the idempotency key api now requires

## Overview

`deed-poll-api`'s notify-6 made **`Idempotency-Key` a required header on the send operation** — for *every*
template, not only the chase. This app does not send it. So once api's master reaches an environment, **every
email send from the Email tab answers 400**, including ③ `application-rejected`, which worked before.

This is a **regression to repair, not a feature**. It is small: generate one UUID per compose journey, carry it
to the final POST, and send the header. It is also urgent in the sense that it is the only thing standing between
the Email tab and a 400 — though **nobody is using the tab yet** (confirmed by Steve 2026-09-25), so it is a
correctness fix rather than an incident.

api's notify-6 **decision 10** assigned this work here and no plan was written for it, which is how it reached
master unowned:

> *"Its compose journey generates and preserves the idempotency UUID, and its adapter sends the header for every
> template."*

**What this plan is not.** It adds no chase-specific route, form or wire type. ⑤ needs no page of its own: the
Email tab is data-driven, so a template and its slots come from `GET /caseworker/cases/{id}/emails` and ⑤ should
appear without a line of chase-aware code. If it does not, that is a second finding and a separate plan — do not
fix it by branching on `chase-missing-documents`.

---

## Decisions taken — implement these, do not revisit

1. **The key is a UUID generated once per compose journey, carried in a hidden control on the check page.**
   One journey, one key, reused by every retry of that final POST; a later journey gets a new one. That is api's
   decision 6 verbatim and this app's half of it.

2. **`send.ts`'s docblock argues against a hidden control, and it is superseded rather than wrong.** Read it
   before implementing, because it will otherwise be cited against this design — including by a review agent. It
   says a removed token *"had no effect on anything"* and that real idempotency *"needs server-side state — a
   token in a hidden control cannot do it… Build it in api, where the outbox is."*

   **That was correct, and notify-6 did exactly what it asked.** api now persists `requestId` with a unique index
   on `("deedPollId", "requestId")` and resolves a conflict itself. So the hidden control is no longer a
   client-only guarantee pretending to be one: it is the transport for a key the server gives meaning to. The
   objection applied to a token nothing checked; it does not apply to one api enforces. **Update that docblock as
   part of this work** so the next reader is not misled the way this plan nearly was.

3. **A hidden control rather than session state, deliberately.** Session state keyed on case and template would
   make two tabs open on the *same* case and template share one key, so the second journey would be refused as a
   reuse-with-different-content 409 — a caseworker doing something legitimate. A hidden control gives every
   rendered form its own key, which is what "one compose journey" means.

   **The tamper analysis, so it is not raised as an objection later.** The field is user input and a caseworker
   can change it. Neither outcome is a hole: a *reused* key with different content is api's 409, and a *fresh*
   key is indistinguishable from starting a new compose journey, which is allowed. The unique index is on
   `("deedPollId", "requestId")`, so a chosen UUID cannot collide across cases either. What a hidden control
   cannot do is protect a caseworker who reloads the check page — that re-renders and mints a new key, which is a
   new journey and correct.

4. **The adapter sends the header for every template, not for the chase.** `sendEmail` in
   `libs/deed-poll-api-client/src/api/client.ts` takes the key and sets `Idempotency-Key`. There is no per-template
   branch anywhere: api requires it of the operation, so the client requires it of itself.

5. **The mock must require it too, or the tests prove nothing.** `libs/deed-poll-api-client/src/mock/server.ts`
   answers 400 when the header is absent or unparseable, and implements the idempotent answer: the same key for
   the same case returns the original receipt with `enqueued: false`; a different key is a new send. Without this
   the suite would pass against a mock more forgiving than api — the divergence the mock exists to prevent.

6. **The key is generated where the journey starts, not where it ends.** If `send.ts` minted it, a retry of that
   POST would mint a new one and defeat the point. It is created when the check page is rendered and travels with
   the form.

7. **A missing key reaching api is a bug here, not a caseworker's problem.** If the header is somehow absent,
   api's 400 is an `InvalidInputError` naming the header — which is not a field on any form, so it must not be
   rendered against one. Let it reach the 500 page: it means this app is broken, and a caseworker cannot fix it
   by retyping.

---

## Validation Commands

Run after every task:

```bash
yarn lint
yarn build
yarn turbo test test:app --concurrency=1
```

**Green before any task runs — measure the baseline on this branch and record it in Task 0.** As at the
notify-3b merge on 2026-09-24 it was **3,321 tests across 169 files**, `lint` exit 0 and `build` exit 0, but
**re-measure rather than quoting that**: it predates this branch.

Notes so no task rediscovers them:

- **`yarn build` is in the list and must stay.** `vitest` transpiles without type-checking, so `yarn test` passes
  on code `tsc` rejects. The app's project settings are in `tsconfig.app.json`, not `tsconfig.json`.
- **Measure, do not read the exit code.** Turbo caches, so add `--force` when a count is the point, and count
  **files as well as tests** — a suite that stopped being discovered still exits 0.
- **Count skipped, not only passed.** `src/session-store.test.ts` opens a *real* Redis behind
  `describe.skipIf(!redisReachable)`, so with no Redis three tests self-skip and the total silently drops. Bring
  Redis up (`docker compose up -d redis`) and export `REDIS_URL=redis://127.0.0.1:6379` — IPv4, because
  `config/default.json`'s `localhost` resolves to `::1` here and fails. `REDIS_URL` is in `turbo.json`'s
  `globalPassThroughEnv`, so it does reach the tests.
- **`yarn test:a11y` is an `echo`**, present only because the Jenkins stage fails on a missing script. A green one
  proves nothing.
- **The Playwright browser download is proxy-blocked** (HTTP 400, which reads as slowness). Symlink a cached
  chromium build, or treat `test:e2e` as Steve's to run.
- A Biome **"nested root configuration"** error means a stale `.claude/worktrees/`, not a fault in the change.

---

## Tasks

### Task 0: Measure the baseline and confirm the break

- Record `lint`, `build` and the test count with `--force`, with Redis up so nothing self-skips. Note files as
  well as tests.
- **Confirm the break is real rather than assumed**: `grep -rn 'Idempotency' libs src` returns nothing today, and
  api's `CaseworkerEmailController.send` takes `@RequestHeader(IDEMPOTENCY_KEY) UUID requestId` with no
  `required = false` and no default. Record both.
- Record whether `openapi.json` already carries the header — if admin's provenance predates api's notify-6 (it
  does, at the time of writing: api master is `b01f8f4`), the header is absent from the document and Task 1 is
  the import.
- [ ] Mark completed

### Task 1: Adopt the OpenAPI contract atomically

> **Where the authoritative document is.** api master is **`b01f8f4`**. A local api serves the generated document
> at `http://127.0.0.1:4550/v3/api-docs` — start it with
> `cd ../deed-poll-api && set -a && . ../local-notes/deed-poll-api/notify-nonprod.env && set +a && SPRING_PROFILES_ACTIVE=development ./gradlew bootRun`
> (it needs `docker compose up -d deed-poll-db` first, and the `development` profile because api refuses a
> cleartext IDAM issuer outside it). `/tmp/openapi-specs.json` is a stale fallback, not a source.

- Replace `libs/deed-poll-api-client/openapi.json` from that document and add a `SPEC-PROVENANCE.md` entry naming
  the api commit.
- **Expect the refresh to carry more than this feature.** `contract.test.ts` is set-equality in **both**
  directions, so the import brings every operation api has added since the last entry — notify-6 *and*
  email-case-notes. Account for the changes property-by-property, not only by operation count.
- Register every new schema in `WIRE_SCHEMAS`, every operation in `IMPLEMENTED_OPERATIONS`, every response in
  `STRICT_RESPONSE_PROPERTIES`, and confirm the required `Idempotency-Key` header is present on the send
  operation.
- [ ] Mark completed

### Task 2: Carry a key through the journey and send it

- `libs/deed-poll-api-client/src/api/client.ts`: `sendEmail` takes the key and sets the `Idempotency-Key` header.
  No per-template branch.
- `libs/deed-poll/src/emails/`: the domain `sendCaseEmail` passes it through. It generates nothing — a service
  that minted its own key would hide the journey's identity from the thing that defines it.
- `src/pages/deed-polls/[id]/emails/[template]/preview.ts`: mint the UUID when the check page renders and put it
  in a hidden control. `send.ts`: read it, validate it is a UUID, pass it on, and **re-render with the same key**
  on a validation error or a 409 so a corrected resubmit is still the same journey.
- Update `send.ts`'s docblock per decision 2 — the passage arguing a hidden control cannot work is now
  superseded, and leaving it would mislead.
- Tests: one key across a retry answers `enqueued: false`; a re-render preserves it; a fresh journey differs; a
  missing key reaches the 500 page rather than a form field.
- [ ] Mark completed

### Task 3: Make the mock enforce it, and validate the whole journey

- `libs/deed-poll-api-client/src/mock/server.ts`: 400 when the header is absent or unparseable; the same key for
  the same case returns the original receipt with `enqueued: false`; a different key is a new send. Add it to the
  mock's list of restated api rules, which is how that list stays honest.
- Confirm **⑤ appears in the Email tab with no chase-aware code** once the mock serves it — decision 10's real
  test. If it does not, record what is missing and stop rather than branching on the template.
- Full validation commands, plus `yarn test:e2e` if browsers are available. Record final counts against Task 0's
  baseline and confirm `skipped` is 0.
- [ ] Mark completed

---

## Deliberately not in this plan

- **Any chase-specific page, route or wire type.** Decision 10, and the point of a data-driven tab.
- **Adding ⑤'s template to the mock's `MOCK_EMAIL_TEMPLATES`** unless Task 3 shows the tab needs it. That entry
  is what `notify-3b-admin`'s Task 2 was told to own for ④; if ⑤ needs the same, note it rather than doing both
  jobs here.
- **The Notify key in AAT.** ③ and ⑤ are configured in api's chart but every send fails at the drain with
  `Empty key` until the vault holds a key, which is blocked on `azure-access#8111`. Nothing in this repo changes
  that, and fixing the 400 does not make a send arrive.

## Flags for Steve

1. **This existed because api made a breaking contract change and the client half was specified but unowned.**
   api's notify-6 decision 10 named the work; no plan carried it. Worth deciding whether a cross-repo contract
   change should require the consuming plan to exist before the api one merges — the alternative is catching it by
   luck, which is what happened here.
2. **Nobody is using the Email tab yet**, which is the only reason this was not an incident.
