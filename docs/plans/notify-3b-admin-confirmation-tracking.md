# notify-3b-admin — track an applicant's confirmation

## Overview

Adds the caseworker UI for the process introduced by
[`deed-poll-api` notify-3b](../../../deed-poll-api/docs/plans/notify-3b-confirmation-tracking.md).
After *Request confirmation to proceed* asks an applicant whether they still want their deed enrolled, this
plan makes waiting cases visible and lets a caseworker record the reply as **Confirmed** or **Withdrawn**.

This is deliberately a separate plan rather than an addendum to
[`notify-2`](notify-2-caseworker-email-tab.md). notify-2 composes, previews and sends correspondence;
this plan manages the work created by one particular email after it has been sent. Combining them would put a
case-list work queue and a referral outcome journey inside a plan whose unit is the Email tab.

**No longer provisional — reconciled against the published document by Task 0 on 2026-09-24.** Every name
below is the one api publishes, read from api's generated document at `master` = `83ec959`, not from the api
plan's prose. `libs/deed-poll-api-client/openapi.json` remains the wire authority and Task 1 is the import.

**Dependencies — all three resolved:**

1. api notify-3 is merged — PR #38, `7914406`. It introduces the email that starts the wait, and its only
   contract-visible delta is the `template` path parameter's description on both email operations, which now
   names `request-confirmation-to-proceed` alongside `application-rejected`. Description-only: no schema, no
   operation, nothing to register.
2. api notify-3b is merged — PR #42, `1e322e1`. It owns the wait, the outcome, the filter and the write, and it
   is the whole of the rest of the delta.
3. **This plan owns the atomic import, and there is nothing to coordinate.** notify-2 is *complete* —
   `docs/plans/completed/notify-2-caseworker-email-tab.md` — and its contract gate was satisfied by its own
   import of api `09d70e3` (#33), which is two provenance entries back. So no email schema is outstanding, and
   the refresh this plan performs carries notify-3 and notify-3b and nothing else. The sentence under
   "Constraints" about registering email schemas notify-2 will later consume is therefore moot rather than
   pending.

---

## Decisions taken — implement these, do not revisit

1. **The applicant's reply is recorded against the referral, not the case or the email.** api owns that model:
   the non-publication request, judicial decision and confirmation all concern one referral. The UI therefore
   starts from `/deed-polls/{id}/referrals/{referralId}` and calls api's nested, case-scoped confirmation
   operation. It does not write a case field and it never sends an author name; api derives the recorder from
   the access token.

2. **Waiting is shown beside the case state, never as a new state.** `Returned` remains the case's derived
   state. api publishes `awaitingConfirmationSince` on `CaseDetailResponse` — and on `SavedCaseResponse`, which
   this feature does not read but Task 1 must register — and added **no** ninth case state, so the case page says
   that the case is awaiting the applicant's confirmation and gives that date. Do not add an option-set value,
   relabel `Returned`, or infer waiting from correspondence history.

3. **The service has a visible waiting worklist and a count that links to the same query.** Add api's published
   `awaitingConfirmation` filter — label "Awaiting confirmation" — to the case-list navigation, appended after
   `returned` as api appends it, so a caseworker's existing tab bar keeps its shape. As with
   `returnedForActionConditions()`/`countReturnedForAction()`, write the selection once and use it for both
   the count and the link, except this feature sends api's filter key rather than recreating the predicate as
   client-side conditions. The count is global, starts in parallel with the list read, and degrades
   independently: failure must not lose the case list, and it must not look like zero.

4. **The waiting list is server-filtered, server-sorted and server-paged.** Admin does not fetch ordinary
   cases and narrow them. api gives the `awaitingConfirmation` tab its own default order,
   `awaitingConfirmationSince:asc` — longest wait first, and **only a default**, so a `sort` this app sent would
   override it: send none. Each row carries `daysAwaitingConfirmation`, an integer api computed; the view model
   renders it and does no arithmetic. When the `awaitingConfirmation` filter is active, the table adds a
   **Waiting** column. Other filters keep the existing table unchanged, so a workflow-specific column does not
   occupy space on every case list — a choice about space, not about availability, since api publishes the value
   on every row and leaves it `null` for a case waiting for nothing.

5. **Recording the reply is one GOV.UK question page.** Route:
   `GET,POST /deed-polls/{id}/referrals/{referralId}/confirmation`. It asks one question with radios:
   **The applicant wants to proceed** (`Confirmed`) or **The applicant does not want to proceed**
   (`Withdrawn`), followed by the note field in the same form because the note is evidence for that answer,
   not a second workflow decision. The submit label is **Record response**, with warning text that it cannot
   be replaced through this service.

   The note is **optional and capped at 1,000 characters** — api's `maxLength`, so validate it here rather than
   letting a 1,001st character become a 400 a caseworker cannot act on. api trims it and treats whitespace-only
   as none, so this app need not, but it must not *require* it: `outcome` is the only required property.

   There is no separate check-answers page. This operation records a fact from a monitored inbox and does not
   itself alter the case-state dates, issue a refund or enrol the deed. A second page would require holding or
   retransmitting the same free text solely to repeat one answer; the clearly labelled irreversible submit is
   the smaller and existing caseworker pattern.

6. **The action appears only for a referral awaiting an answer, but api remains the authority.** The referral
   detail page shows when confirmation was requested and, once recorded, the outcome, date and recorder. It
   shows **Record applicant response** only while api says a request exists and no outcome exists. This is
   presentation, not enforcement: the POST does no pre-read and api still refuses an unasked or duplicate
   outcome with 409.

7. **A concurrent 409 returns to fresh referral data and explains what happened.** If another caseworker
   records the response first, redirect back to the referral with a conflict marker. The GET re-reads api,
   shows the recorded outcome and says it was already recorded. Do not replay the submitted note, offer an
   overwrite, or turn an ordinary race into a 500.

8. **Recording an outcome does not tell the caseworker what dates to change.** api notify-3b deliberately does
   not mutate `dateReturned`, `dateEnroled`, `signatureRequestedDate` or the state cascade. This UI records the
   answer and confirms that it was recorded; it must not invent guidance such as “the case is now ready for
   enrolment” or “the refund has been issued”. The business question in api notify-3b flag 1 remains open.

9. **No inbox integration and no chasing email.** The caseworker reads a monitored mailbox and transcribes the
   answer. This plan neither parses inbound email nor invents correspondence the business has not supplied.

10. **The in-memory mock must model the process, not just return fixtures.** A seeded waiting referral appears
    in the filter and count; recording an outcome removes its case from that worklist, persists the outcome on
    the referral, and a second recording returns 409. Without those transitions the journey can pass locally
    while the list never changes, which is the feature's central behavior.

---

## The published contract — measured, not expected

Read from api's generated document on 2026-09-24 at `master` = `83ec959`, via
`curl -s http://127.0.0.1:4550/v3/api-docs` against a local api built from that commit. The provisional guesses
were close, and the four corrections are called out below rather than quietly overwritten, because two of them
change what a task has to do.

**The whole delta from admin's checked-in document (`227b714`, #36) is one operation and one schema**, plus
properties on four existing schemas and two parameter descriptions. Nothing was removed and nothing was
renamed: 39 → 40 operations, 38 → 39 schemas.

| Surface | What api publishes |
|---|---|
| `POST /caseworker/cases/{id}/referrals/{referralId}/confirmation` | `operationId` `recordConfirmation`, tag `caseworker-referral-controller`. Path params `id` and `referralId`, both required strings. Request body **required**, `$ref` `RecordConfirmationRequest`. The only documented response is **`200` → `ReferralResponse`** — the saved referral, so the page has the recorded outcome without a re-read |
| `RecordConfirmationRequest` | `{ outcome, note }`, `required: ["outcome"]`, `additionalProperties: true`. `outcome` is an **inline** `string` enum `["Confirmed", "Withdrawn"]`. `note` is `string`, `maxLength: 1000`, optional, trimmed by api, and whitespace-only counts as none |
| `ReferralResponse` | Gains `confirmationRequestedAt` and `confirmationReceivedAt` (`date-time`), `confirmationRecordedBy` (`string`), and `confirmationOutcome` — again an **inline** `string` enum `["Confirmed", "Withdrawn"]`, not a named schema, so there is no `ConfirmationOutcome` to register |
| `CaseDetailResponse` | Gains `awaitingConfirmationSince` (`date-time`), alongside the existing `state` |
| `SavedCaseResponse` | **Also** gains `awaitingConfirmationSince` (`date-time`) — not in the provisional table |
| `CaseSummaryResponse` | Gains `daysAwaitingConfirmation` (`integer`, `int32`) — on **every** row, not only the filter's |
| `GET /caseworker/cases` | `filter` gains the key **`awaitingConfirmation`** (label "Awaiting confirmation") and its first-ever description; `sort` gains `awaitingConfirmationSince` as a sortable field and documents the tab's own default, `awaitingConfirmationSince:asc` |
| `CreateSavedQueryRequest`, `UpdateSavedQueryRequest` | `filter` enum gains `awaitingConfirmation`, so the new tab is savable like any other |

Enum values are confirmed as exactly `Confirmed` and `Withdrawn` — api matches them exactly, "as the stored
form is the wire form".

### The four corrections

1. **`daysAwaitingConfirmation` is on every case-list row, not only on rows the filter returned.** It is `null`
   for a case waiting for nothing, which is nearly all of them, and `0` on the day the email was sent — api's
   own words, "never 1". Decision 4's **Waiting** column is therefore still a choice about which tab shows the
   column, but not a consequence of where the value exists. The reason to keep it filter-only is unchanged:
   a workflow column should not occupy space on every list.
2. **`SavedCaseResponse` carries `awaitingConfirmationSince` too.** Task 1 must register it there as well as on
   `CaseDetailResponse`, or the set-equality response check fails on a schema this feature never reads.
3. **The write's response is the referral**, so the post-success GET is a *freshness* decision, not a necessity.
   Decision 7's redirect-and-re-read stands on its own merits — a 409 has no body to trust — and Task 4 must not
   quietly switch to rendering the POST's response instead, because that would bypass the re-read the conflict
   path depends on.
4. **Neither new enum is a named schema.** Both are inline, so `WIRE_SCHEMAS` gains exactly one entry
   (`RecordConfirmationRequest`) and the outcome values are encoded where the referral schema is.

### The two 409s, verbatim from api

`ReferralService.recordConfirmation` checks **already-recorded first**, then never-asked — so a referral that
somehow holds an outcome without a request still answers the first message:

- **Already recorded:** `Referral <id> already has a confirmation outcome of <Outcome>, recorded on
  <d MMMM yyyy>. Recording a second answer would overwrite it, so it is refused`. It deliberately does **not**
  name who recorded it: "naming a colleague in a refusal turns a correction into an accusation". `Locale.UK`,
  day precision. Where the date is somehow absent it says "a date that was not recorded" rather than throwing.
- **Never asked:** `Referral <id> has not been asked to confirm whether the applicant wants to proceed, so
  there is no answer to record`.

So the two are distinguishable, but **only by their prose**, which is exactly why this UI must not parse them —
Task 4 renders its own sentence per case, as decision 7 already says.

### Three api-side facts the document cannot carry

- **Scoping is a 404, through `findReferralForUpdate(deedPollId, id)`** — `findByIdAndDeedPollIdForUpdate`, so a
  referral belonging to another case is `Referral <id> not found` and discloses nothing. No new work for this
  plan; it is the same behaviour every other nested referral operation already has.
- **`confirmationRecordedBy` comes from `caller.name()`** and `confirmationReceivedAt` from `AuditClock.now()`,
  which is *when the caseworker recorded it* and never when the applicant replied. A body that sends either is
  **ignored, not refused** (`additionalProperties: true`), so nothing fails if this app wrongly sends one —
  Task 2's "absence of a client-supplied recorder" test is the only thing that would catch it.
- **Recording writes a case note and recomputes `awaitingConfirmationSince`,** in the write's own transaction,
  and moves no case state or date. That is how a case leaves the worklist, and it confirms decision 8: there is
  no date consequence for this UI to announce. api also added no ninth case state, so decision 2 holds.

---

## Constraints

The repository rules apply: strict TypeScript with no `any`, ES modules, Biome, colocated tests,
feature-grouped folders, wire types generated from the OpenAPI contract, no database, and no page speaking
HTTP except through `libs/deed-poll-api-client`.

Additional constraints:

- **Do not start before api notify-3b is merged.** Satisfied: PR #42, `1e322e1`, on api `master`.
- **Do not hand-edit a guessed wire shape.** Refresh `openapi.json`, update `SPEC-PROVENANCE.md`, and satisfy
  the set-equality contract tests atomically.
- **Resolved — this plan performs the one refresh, and it is not verification-only.** notify-2 is complete and
  imported api `09d70e3` (#33); its email schemas are already registered. Nothing else is outstanding, so the
  import Task 1 performs is exactly notify-3 + notify-3b: one operation, one schema, properties on four
  schemas, two parameter descriptions. There is no second plan to coordinate with and no email schema to adopt.
- **Do not add client-side filtering, sorting or days arithmetic.** api owns all three.
- **Do not send `confirmationRecordedBy`.** The token is the identity.
- **Do not change case dates or state.** The outcome endpoint does not authorize this app to decide the
  unresolved business process.
- **A second API call must not lose its host page.** The worklist count and referral panel are additive and
  degrade visibly; the case/list read remains load-bearing.
- **Every caseworker-facing string needs the `en`/`cy` shape and Welsh extraction coverage.** English
  placeholders in `cy` are acceptable only under the repository's existing translation-workflow convention,
  and the new page path must remain inside the extractor's included `src/pages/deed-polls/**` area.

---

## Validation Commands

Run after every implementation task:

```bash
yarn lint
yarn build
yarn turbo test test:app --concurrency=1
```

**Green before any task runs — measured 2026-09-24 on `master` at `f5d427e`:** `yarn lint` exits **0** (one
pre-existing warning, `noUnusedVariables` in `emails/[template]/compose.test.ts`, plus two `biome.json` schema
notices — none of them errors, so the gate starts green); `yarn build` exits **0**, 8 of 8 turbo tasks;
`yarn turbo test test:app --concurrency=1` exits **0** with **3,120 tests across 166 files**.

**The count was 3,125 here until Task 0 re-measured it, and 3,120 is the right number.** Measured with `--force`
on the branch tip (`75ee155`) and again with the working tree stashed, which produced the same eight per-package
figures both times: `deed-poll` 1,056, app 1,304, `deed-poll-api-client` 422, `cloud-native-platform` 140,
`express-govuk-starter` 127, `simple-router` 41, `express-session-postgres` 23, `express-session-redis` 7. The
file count of 166 was right. Nothing on this branch removed a test — every commit since `f5d427e` is
documentation — so 3,125 was a mis-transcription rather than a regression. **Task 5 must compare against 3,120.**

**Running count as each task lands, so Task 5 compares against a figure rather than reconstructing one:** Task 1
took it to **3,125 across 166 files** (five contract-test cases, no new file).

Notes so no task rediscovers them:

- **`yarn build` is in the list and must stay.** `vitest` transpiles without type-checking, so `yarn test`
  passes on code `tsc` rejects — this repo's `CLAUDE.md` names it, and it is why the gate is three commands and
  not two. The app's project settings are in `tsconfig.app.json`, not `tsconfig.json`.
- **Measure, do not read the exit code**, when the count is the point: turbo caches, so add `--force` to make a
  count comparable. Count test files as well as tests — a suite that silently stopped being discovered still
  exits 0.
- **`yarn test:a11y` is an `echo`, not a suite.** It exists because the Jenkins stage invokes it and fails on a
  missing script; the real axe-core checks run inside the Playwright suite. So it always passes and proves
  nothing — do not read a green `test:a11y` as accessibility coverage.
- **`yarn test:e2e` needs Playwright browsers, and the download is proxy-blocked here** (HTTP 400
  `GatewayExceptionResponse`, which reads as slowness rather than a refusal). Symlink a cached chromium build to
  the wanted version, or treat e2e as Steve's to run. A dead `webServer` also presents as a Playwright timeout.
- A Biome **"nested root configuration"** error means a stale `.claude/worktrees/` directory, not a fault in the
  change.

Task 5 additionally runs `yarn test:coverage`, `yarn test:e2e` and `yarn test:a11y`, with the caveats above.

---

## Tasks

### Task 0: Reconcile the plan against the published contract

- Confirm api notify-3 and notify-3b are merged.
- Generate api's OpenAPI document from the exact merged commit and compare it with the checked-in document.
- Record the actual operation, request/response schema names, confirmation properties, enum values, filter key,
  days-waiting property and sort behavior in this plan.
- Inspect every other OpenAPI addition since the current provenance commit. Decide whether notify-2 or this
  plan owns the one atomic import, and record that decision in both plans if necessary.
- Confirm whether the confirmation note is required, optional, nullable and length-capped.
- Confirm which response is returned by the write and whether 409 distinguishes “never requested” from
  “already recorded” in its message.

**Done, 2026-09-24. The findings are "The published contract — measured, not expected" above; this is the
method, so the next task does not repeat the work.** api `master` is `83ec959`; notify-3 is `7914406` (#38) and
notify-3b is `1e322e1` (#42). The document was read live from the local api on `:4550` and diffed against
`libs/deed-poll-api-client/openapi.json` programmatically — operations, schema names, then every shared schema
and operation serialised and compared one at a time, which is `SPEC-PROVENANCE.md`'s standard and not a count.

Four things worth not rediscovering:

- **The live document and `/tmp/openapi-specs.json` differ in exactly one byte-range: `servers[0].url`.** Live
  says `http://127.0.0.1:4550`, the test artefact and the checked-in file both say `http://localhost`. So Task 1
  must either take the artefact or normalise that one value — a refresh straight from `curl` would otherwise
  commit the local port as the published server URL, which no test in this repo looks at.
- **PRs #44, #45 and #48 have zero contract delta**, measured rather than assumed: no file under
  `api/caseworker/dto/` changed between `1e322e1` and `83ec959`, and the one controller that did
  (`CaseworkerEmailController`) changed javadoc only. So importing at `83ec959` and importing at `1e322e1` would
  produce the same document, and `83ec959` is the honest provenance commit because it is what was generated.
- **notify-2 is complete and is not a coordination problem** — see the dependencies note at the top.
- **notify-3's `request-confirmation-to-proceed` is invisible to the contract test but not to this app.** api
  publishes template keys as bare strings inside `EmailTypeResponse`, never as an enum, so the key arrives as
  *data* and `contract.test.ts` cannot pin the set — which is deliberate, and it is why notify-3's whole delta is
  two descriptions. Two consequences Task 2 owns, neither of which the import will surface:
  - **The mock does not know the template exists.** `MOCK_EMAIL_TEMPLATES` in
    `libs/deed-poll-api-client/src/mock/fixtures.ts` has `application-rejected` and nothing else, so nothing can
    currently *send* the email that sets `confirmationRequestedAt`. Decision 10 needs the mock to model the wait,
    so the seeded waiting referral either comes from a second mock template or is seeded already-waiting; either
    way it is a mock gap, not a contract gap.
  - **`emailTemplateLabel` degrades correctly and needs no change.** `EMAIL_TEMPLATE_LABEL` in
    `libs/deed-poll/src/emails/emails-view.ts` lists only `application-rejected`, and an unlisted key falls
    through to `humaniseKey`, which turns `request-confirmation-to-proceed` into "Request confirmation to
    proceed" — the same string api's `displayName` carries. So do not add a map entry to "fix" a label that is
    already right; that fallback is the documented intent.

- [x] api notify-3b is merged, every provisional contract name is replaced by the published one, the atomic
      refresh has one named owner, and the validation commands are green without behavior changes

### Task 1: Adopt the OpenAPI contract atomically

> **Where the authoritative document is, as at 2026-09-24 — do not hand-write the shape.** api's notify-3b is
> **merged on `master`** (PR #42, and `email-case-notes` has landed since as PR #48, so `master` is at
> `83ec959`). A **local `deed-poll-api` is running on `http://127.0.0.1:4550` from that commit**, so
> `curl -s http://127.0.0.1:4550/v3/api-docs` is the generated document, live. If it is not running, api's
> `OpenAPIPublisherTest` writes the same thing to `/tmp/openapi-specs.json` when its `integration` source set
> runs — note that source set is **excluded in CI** (`INTEGRATION_TESTS_ENABLED=false`), so the file is a local
> artefact only. **Prefer the artefact, or normalise `servers[0].url`:** it is the one field in which the live
> document and the artefact disagree, because springdoc reports the port it is actually listening on.
>
> **The refresh is atomic but Task 0 measured it, and it is small.** `contract.test.ts` is set-equality in
> **both** directions, so importing the document pulls in everything api has added since the provenance entry —
> which here is notify-3 and notify-3b and nothing else, because notify-2 already imported the email surface and
> PRs #44/#45/#48 changed no DTO. The full list is in "The published contract" above: **one** operation
> (`POST …/referrals/{referralId}/confirmation`), **one** schema (`RecordConfirmationRequest`), properties on
> `ReferralResponse`, `CaseDetailResponse`, `SavedCaseResponse` and `CaseSummaryResponse`, the
> `awaitingConfirmation` filter key on three schemas' enums, and description-only changes to `filter`, `sort` and
> both `template` parameters. Do not go looking for a larger delta; do still account property-by-property, since
> that is what found `SavedCaseResponse`. The one green seam to split on, if it has to be split, is an
> unregistered schema plus an unlisted function: both are invisible to the contract test until registered.

If the exact api commit is already the provenance entry, verify this task and make no duplicate change.
Otherwise:

- Replace `libs/deed-poll-api-client/openapi.json` from api's generated document and add a complete
  `SPEC-PROVENANCE.md` entry.
- Account property-by-property for changes to existing case and referral schemas, not only new operation
  counts.
- Register every new schema in `WIRE_SCHEMAS`, every operation in `IMPLEMENTED_OPERATIONS`, and every response
  in `STRICT_RESPONSE_PROPERTIES`; update request-schema completeness checks.
- Verify the confirmation request is not published as `{}` and the filter/sort vocabulary is present in the
  case-list parameter descriptions. Task 0 confirmed both — `RecordConfirmationRequest` carries `outcome` and
  `note` (api registers it in `OpenAPIWriteBodies`), and `awaitingConfirmation` /
  `awaitingConfirmationSince:asc` are both in the descriptions — so this is a regression check on the import,
  not a discovery.
- **No notify-2 status update is needed**: it is complete and its contract gate was satisfied by its own import.

**Done, 2026-09-24, and the delta was exactly what Task 0 measured.** The document came from
`/tmp/openapi-specs.json` rather than `curl`, so `servers[0].url` stayed `http://localhost`; the file diff is **96
insertions, 3 deletions**, and all three deletions are a line replaced by its longer self (the `sort` description
and the two `filter` enums). 39 → 40 operations, 38 → 39 schemas, which are the numbers api's own
`OpenAPIPublisherTest` fails on — `isEqualTo(34)` caseworker and `isEqualTo(5)` judicial at `83ec959`, read from
the api clone rather than inferred. No `operationId` shifted and no pre-existing operation changed structurally.

Registered: `RecordConfirmationRequest` in `WIRE_SCHEMAS` (and in the contract test's request list, so it is
excluded from the response-strictness sweep rather than inheriting a blank one), the operation in
`IMPLEMENTED_OPERATIONS`, `awaitingConfirmationSince` on `savedCaseSchema` — which `caseDetailSchema` extends, so
**one** edit registers it on both schemas api added it to — `daysAwaitingConfirmation` on `caseSummarySchema`, the
four `confirmation*` properties on `referralSchema`, and `awaitingConfirmation` appended to `LIST_FILTER`.
`CONFIRMATION_OUTCOME` is a new exported member array beside `REFERRAL_STATE`, re-exported from `client.ts`
because a radio per member is Task 4's, and it is pinned by the drift test's enum comparison on **both** inline
properties rather than by a schema registration.

Three things worth not rediscovering:

- **`STRICT_RESPONSE_PROPERTIES` needed no change at all**, and that is the correct answer rather than an
  oversight: all five new response properties are nullable — four of them move in pairs and the fifth is `null`
  for nearly every case — and none is a Java primitive, a collection or an id, which are the only three kinds
  that list admits.
- **The sortable-field list went 70 → 71 and the determinism fix holds.** `awaitingConfirmationSince` is inserted
  at index 66, the 70 shared names are in byte-identical order, and `createdOn, modifiedOn, createdBy, modifiedBy`
  are still the last four. `where` and `q` are byte-identical, so nothing in `query-fields.ts` is affected.
- **Adding `awaitingConfirmationSince` to `savedCaseSchema` also made it queryable in the mock**, because
  `QUERYABLE_FIELDS` derives from that schema's shape minus `id` and the two day counts. That is right rather
  than incidental — api publishes it as a sortable field — and it is why the mock needed no edit for the import.

Test count: **3,125 across 166 files**, up 5 from the 3,120 baseline. All five are new contract-test cases (three
written here, plus the two the per-schema loop generates for `RecordConfirmationRequest`); no file was added.

- [x] the generated document and provenance name the merged api commit, all outstanding contract additions
      are registered atomically, keyed request bodies are non-empty, and the contract tests are green

### Task 2: Add the adapter, domain service and stateful mock

- Add the API-client confirmation function, returning `ApiResult<T>`, with both ids encoded and the standard
  timeout. Extend existing case/referral aliases rather than restating wire fields.
- Add a thin domain function under `libs/deed-poll/src/referrals/` taking `{ accessToken }` and no supplied
  author.
- Add view builders for waiting status, outcome labels and field-addressed form errors. Keep types with their
  consumers.
- Extend the mock with a waiting referral and a completed referral. Implement the confirmation transition,
  case/referral scoping, 409 for unasked or repeated recording, worklist removal, and count changes.
- Tests cover the happy path, both 409s, cross-case 404, malformed response, timeout/unavailable result, enum
  parsing and the absence of a client-supplied recorder.

- [ ] the adapter and domain own no process rule, the mock changes the worklist when an outcome is recorded,
      all errors preserve their API classification, and validation is green

### Task 3: Show the waiting worklist and case status

- Add the published awaiting-confirmation filter to the case-list navigation and reuse that same key for its
  count link.
- Fetch the count in parallel with the existing additive list-page calls. Carry `number | null` so failure,
  zero and work waiting have distinct renderings and logs contain no caseworker or case data.
- Show an important notification with the count and worklist link when non-zero; show a warning when the count
  is unavailable. Keep the existing returned-direction alert independently usable if either count fails.
- On the active waiting filter only, add a **Waiting** column from api's days-waiting value. Preserve api's
  order and paging.
- Show `awaitingConfirmationSince` beside the existing case state on case detail without changing the state
  label or deriving it from referrals/emails.
- Tests cover zero, one, plural and unavailable counts; both alerts together; link/count query identity;
  longest-waiting order as received; day zero; conditional column rendering; and `Returned` remaining visible.

- [ ] waiting work is visible and linked to the exact server-side filter that produced its count, failure
      cannot masquerade as zero, the list is not filtered or sorted locally, and validation is green

### Task 4: Record the applicant's response

- Extend the referral detail view model and page with requested date, pending/completed status, outcome,
  received date and recorder.
- Add `GET,POST /deed-polls/{id}/referrals/{referralId}/confirmation` with GOV.UK radios, note input, warning,
  back link, error summary and field errors. Preserve submitted values after local or api validation errors.
- Do not show the action for an unasked or completed referral. The POST still performs no pre-read and trusts
  api to enforce the transition.
- On success redirect to fresh referral detail with a success banner. On 409 redirect with a conflict marker;
  the refreshed detail names the outcome already recorded, without offering overwrite.
- A referral from another case and an unknown referral both remain the same 404 behavior provided by api.
- Tests cover both outcomes, note handling, missing/invalid outcome, preserved input, success, both 409s,
  cross-case 404, no recorder field on the request, action visibility, and the absence of any case-date write.

- [ ] a caseworker can record either published outcome with evidence, races are explained against fresh data,
      authorship and case scoping remain api-owned, no state/date consequence is invented, and validation is
      green

### Task 5: Security, accessibility and full journey validation

- Add a Playwright journey: open the awaiting-confirmation alert, reach the oldest case, inspect the referral,
  record each outcome in separate seeded scenarios, see the success state, and confirm the case leaves the
  waiting worklist.
- Run axe on the worklist, referral detail and confirmation form; test keyboard submission, labelled radios,
  linked error summary, logical heading order and non-color status text.
- Assert no inbound-email content, access token, recorder override or applicant personal data is logged.
- Prove directly that a cross-case referral id discloses no confirmation state and that an ordinary
  caseworker can use the journey without a new UI-only role gate.
- Run the full validation commands and record final test counts against the baseline. **There is no
  `[PROVISIONAL]` marker left to remove** — Task 0 resolved the only one against the published document — so
  what is left to check here is that no *claim* in this plan still disagrees with `openapi.json`.

- [ ] the complete waiting-to-recorded journey passes against the stateful mock, axe is clean, security and
      scoping are explicit tests, every provisional contract claim is resolved, and all validation is green

---

## Deliberately not in this plan

- Sending *Request confirmation to proceed*; notify-2 renders the Email tab and api notify-3 sends it.
- Reading or parsing the monitored inbox.
- Chasing an applicant who has not replied; no approved template or deadline exists.
- Changing `dateReturned`, `dateEnroled`, `signatureRequestedDate` or `DeedPollState`.
- Issuing or recording a refund.
- Automatically enrolling a deed after `Confirmed`.
- Overwriting or deleting a recorded outcome.
- A new role or presentational permission gate.

---

## Flags for Steve

1. **The UI can record an answer but cannot tell the caseworker what operational step follows it.** api
   notify-3b flag 1 is still unanswered: a confirmed case is `Returned`, and nobody has decided which date a
   caseworker should clear or set next. This does not block recording the reply, but it blocks honest
   “what next” guidance.

2. **Withdrawn is not a terminal case state.** It is a referral outcome alongside a case still shown as
   `Returned`. Reporting and refund completion will therefore need to read the confirmation outcome, not infer
   it from state.

3. **There is no deadline or escalation.** The worklist prevents silent disappearance; it does not decide when
   to chase or close a case.

4. **The count adds another API call to the case-list page.** It follows the existing returned-for-action
   pattern and runs in parallel, but two workflow alerts now mean two global count queries. If more queues are
   added, api should publish a single work-summary response rather than allowing one query per banner to grow
   without bound.
