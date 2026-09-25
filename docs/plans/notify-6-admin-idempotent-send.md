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
- [x] Mark completed

**Measured 2026-09-25 on `notify-6-admin-idempotent-send` at `0c4f038`.** `yarn lint` exit **0**, `yarn build`
exit **0**, `yarn turbo test test:app --concurrency=1 --force` exit **0** with **3,321 tests across 169 files,
0 skipped** — so the notify-3b figure the Validation section quotes does still hold on this branch, but it is now
re-measured rather than quoted. `skipped` is 0 because Redis was up (`docker compose up -d redis`, container
`deed-poll-redis` on `0.0.0.0:6379`) with `REDIS_URL=redis://127.0.0.1:6379` exported, so
`src/session-store.test.ts` ran rather than self-skipping. Per package: `//:test:app` 1,406/78,
`@hmcts/deed-poll` 1,111/58, `@hmcts/deed-poll-api-client` 466/4, `express-govuk-starter` 127/12,
`cloud-native-platform` 140/10, `simple-router` 41/4, `express-session-postgres` 23/2,
`express-session-redis` 7/1.

**The break is confirmed, not assumed.** Both halves:

- **This app sends nothing.** `grep -rn 'Idempotency' libs src` returns exactly **one** line, and it is a comment
  asserting the opposite of what api now requires: `src/pages/deed-polls/[id]/emails/[template]/send.test.ts:61`
  — *"Decision 16 as corrected: there is no `Idempotency-Key` in api's contract, and `SendEmailRequest` is one
  of…"*. No header is set anywhere; the many case-insensitive `idempoten` hits are prose about idempotent
  *writes* generally (saved queries, the mock, `send.ts`'s docblock), not this header. That comment is a second
  thing Task 2 must correct alongside the docblock decision 2 names — it is a test file asserting a contract fact
  that stopped being true.
- **api requires it.** At master `b01f8f40f3184af268e20aa2a4fe4ad6b49518a6` ("Merge pull request #50 from
  hmcts/notify-6-chase-missing-documents"), `CaseworkerEmailController.java:73` declares
  `public static final String IDEMPOTENCY_KEY = "Idempotency-Key";` and line 168 binds
  `@RequestHeader(IDEMPOTENCY_KEY) UUID requestId,` — **no `required = false`, no `defaultValue`**, so Spring
  answers 400 when it is absent. Its javadoc states the intent outright: *"A missing or unparseable key is a 400
  naming the header, not a guess: a generated substitute would make every retry a new send, which is the
  behaviour this replaced."* Note the body is `@RequestBody(required = false)` while the header is not — the
  header is the stricter of the two.

**`openapi.json` does not carry the header, so Task 1 is the import.** `grep -n 'Idempotency'
libs/deed-poll-api-client/openapi.json` exits 1. `SPEC-PROVENANCE.md`'s current entry is api **`83ec959`** taken
2026-09-24 (notify-3 and notify-3b), which predates `b01f8f4` — so the document is two api merges stale and the
refresh will carry notify-6 *and* email-case-notes, exactly as Task 1 warns.

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
- [x] Mark completed

**Done 2026-09-25.** `openapi.json` replaced from api `b01f8f4`, regenerated by
`./gradlew integration --tests "*OpenAPIPublisherTest*"` with `TESTCONTAINERS_RYUK_DISABLED=true`. The full
account is in `SPEC-PROVENANCE.md`; the four things worth having here:

- **The refresh added no operation and no schema — a first for this file — so the three registries needed no new
  entry.** Counts are unchanged at 40 operations across 27 paths and 39 schemas, and api's own
  `OpenAPIPublisherTest` still asserts `isEqualTo(34)`/`isEqualTo(5)` at this commit. That is a finding rather
  than a shortcut: **a breaking contract change arrived with every count intact**, which is exactly what a
  reviewer checking counts would wave through. The delta is 2 changed operations and 2 changed schemas, measured
  property-by-property; the file diff is 26 insertions and 6 deletions, and each deletion is a `description`
  replaced by its longer self, checked line by line.
- **The header is present and required, and it is now pinned.** `{"in":"header","name":"Idempotency-Key",
  "required":true,"schema":{"type":"string","format":"uuid"}}` on `POST …/emails/{template}` and on nothing else.
  `contract.test.ts` asserts the required-header set over the **whole document** rather than only on the send, so
  the inverse failure — a header api adds to a second operation that this adapter then does not send — fails here
  too. The preview has none, consistently: it writes nothing, so there is nothing to make idempotent.
- **The plan's prediction that this would also carry `email-case-notes` was wrong**: the only merges between
  `83ec959` and `b01f8f4` are PR #49 (`notify-6-validation-gate`) and PR #50 (`notify-6-chase-missing-documents`),
  measured with `git log --merges`. No `email-case-notes` change has merged into api. Nothing followed from the
  wrong prediction, because the delta was accounted for by measurement rather than from the plan.
- **⑤'s slot arrived and needed one line.** Both email write bodies gain `documents_required` (`maxLength: 4000`,
  capped with the *direction* rather than the notes), so `emailSlotsWriteSchema` gains one optional field. Nothing
  above the wire changed: the slot keys are data-driven from `GET …/emails` everywhere, which is the first half of
  decision 10's test that ⑤ needs no chase-aware code. `SendEmailRequest.required` is still undefined and that is
  not laxity — `documents_required` is required of ⑤ and of neither other template, and conditional mandatoriness
  is not expressible in one `required` list serving three.

Three stale assertions corrected as part of adopting the contract, all of which said the opposite of what api now
requires and would have been cited against Task 2: `emailSlotsWriteSchema`'s docblock (the UUID "is sent to api in
neither the body nor a header"), the `additionalProperties` test's comment ("the UUID stays admin-local"), and
`sentEmailSchema`'s account of `enqueued: false`, which described only the per-referral index and now names both
it and `("deedPollId", "requestId")` plus the 409 a reused key with different content gets. The two Task 2 names
for the same treatment — `send.ts`'s docblock and `send.test.ts:61` — are still outstanding and are its work.

Validation: `yarn lint` exit **0**, `yarn build` exit **0**,
`yarn turbo test test:app --concurrency=1 --force` exit **0** with **3,322 tests across 169 files, 0 skipped**
(Redis up, `REDIS_URL=redis://127.0.0.1:6379`) — baseline **+1**, which is the one new header test.

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
- [x] Mark completed

**Done 2026-09-25.** The key now travels the whole journey: minted in `preview.ts`'s `render`, carried by a hidden
`idempotencyKey` control in **both** of the check page's forms, read back by `loadEmailJourney`, and sent by
`sendEmail` as the `idempotency-key` header. Five things a reader should not have to rediscover:

- **`loadEmailJourney` *reads* the key and mints nothing, which is what makes decision 6 hold in one place.**
  `EmailJourney` gains `key: string | null`, so every render path has it without a signature growing a fifth
  positional argument, and the only `randomUUID()` in the journey is in `preview.ts`. A key that is not a UUID is
  read as `null` rather than carried: api binds the header as a `UUID`, so an unparseable one is the same 400 as an
  absent one and must not reach the wire. The check page then mints a usable one; `send.ts` treats it as a fault.
- **The way *back* to the wording carries the key too, and that is not symmetry for its own sake.** Without it a
  caseworker who pressed "Change the wording" would arrive at a check page that minted a second key, so their
  corrected resubmit would be a second send rather than the same one arriving again. `email-compose.njk` renders
  the control only when there is a key, because an empty one would post a value api cannot parse.
- **`send.ts` refuses a missing key before validating the wording.** Re-rendering the form would hand back a check
  page that mints a fresh key and the fault would look like a typo the caseworker had fixed. It is a plain `Error`
  and therefore the 500 page — `src/errors.ts` maps `InvalidInputError` to a form and nothing to a header.
- **Four docblocks and four tests said the opposite of what api now requires.** `send.ts`'s (decision 2) and
  `send.test.ts:61`'s (Task 0) are the two the plan named; `compose.ts`'s "there is no idempotency token here, and
  its removal is the point" and the compose/preview template tests asserting the control's *absence* said it just as
  loudly and would have been cited the same way. All corrected to name the difference — api gives the key meaning
  now — rather than deleted, so the old objection is still legible and still answered.
- **`request`/`send` in the adapter grew an optional `headers`**, which is the first header this client sets per
  operation rather than per request. The header is asserted **off the wire** in `client.test.ts` against a recording
  server, not through the mock: the mock does not enforce it until Task 3, so a mock-only assertion would have
  passed with the header absent.

Validation: `yarn lint` exit **0**, `yarn build` exit **0**,
`yarn turbo test test:app --concurrency=1 --force` exit **0** with **3,340 tests across 169 files, 0 skipped**
(Redis up, `REDIS_URL=redis://127.0.0.1:6379`) — Task 1's 3,322 **+18**. E2E unchanged: `emails.spec.ts` drives the
real forms, so the hidden control travels with the click.

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
