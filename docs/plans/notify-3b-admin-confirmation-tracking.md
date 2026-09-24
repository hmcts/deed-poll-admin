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

**This plan is provisional until api notify-3b is implemented and its OpenAPI document is imported.** The api
plan names the intended operation and fields, but this repo's rule is that
`libs/deed-poll-api-client/openapi.json` is the wire authority. Task 0 replaces every provisional name below
with the published one before implementation begins.

**Dependencies:**

1. api notify-3 must be implemented and merged, because it introduces the email that starts the wait;
2. api notify-3b must be implemented and merged, because it owns the wait, outcome, filter and write;
3. the generated-client refresh must be coordinated with notify-2. Whichever admin plan runs first after the
   api work adopts the whole OpenAPI delta atomically; the other verifies and reuses it rather than refreshing
   the same contract a second time.

---

## Decisions taken — implement these, do not revisit

1. **The applicant's reply is recorded against the referral, not the case or the email.** api owns that model:
   the non-publication request, judicial decision and confirmation all concern one referral. The UI therefore
   starts from `/deed-polls/{id}/referrals/{referralId}` and calls api's nested, case-scoped confirmation
   operation. It does not write a case field and it never sends an author name; api derives the recorder from
   the access token.

2. **Waiting is shown beside the case state, never as a new state.** `Returned` remains the case's derived
   state. Where api publishes `awaitingConfirmationSince`, the case page says that the case is awaiting the
   applicant's confirmation and gives the date. Do not add an option-set value, relabel `Returned`, or infer
   waiting from correspondence history.

3. **The service has a visible waiting worklist and a count that links to the same query.** Add api's published
   awaiting-confirmation filter to the case-list navigation. As with
   `returnedForActionConditions()`/`countReturnedForAction()`, write the selection once and use it for both
   the count and the link, except this feature sends api's filter key rather than recreating the predicate as
   client-side conditions. The count is global, starts in parallel with the list read, and degrades
   independently: failure must not lose the case list, and it must not look like zero.

4. **The waiting list is server-filtered, server-sorted and server-paged.** Admin does not fetch ordinary
   cases and narrow them. api notify-3b promises longest-waiting first and a days-waiting value on each row;
   the view model renders those published values. When the awaiting-confirmation filter is active, the table
   adds a **Waiting** column. Other filters keep the existing table unchanged, so a workflow-specific column
   does not occupy space on every case list.

5. **Recording the reply is one GOV.UK question page.** Route:
   `GET,POST /deed-polls/{id}/referrals/{referralId}/confirmation`. It asks one question with radios:
   **The applicant wants to proceed** (`Confirmed`) or **The applicant does not want to proceed**
   (`Withdrawn`), followed by the note field in the same form because the note is evidence for that answer,
   not a second workflow decision. The submit label is **Record response**, with warning text that it cannot
   be replaced through this service.

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

## Expected contract `[PROVISIONAL]`

Task 0 replaces these names with the document's actual schemas, properties and filter key.

| Surface | Expected from api notify-3b |
|---|---|
| `POST /caseworker/cases/{id}/referrals/{referralId}/confirmation` | Request containing `outcome` and `note`; updated referral response |
| `ReferralResponse` | `confirmationRequestedAt`, `confirmationOutcome`, `confirmationReceivedAt`, `confirmationRecordedBy` |
| `CaseDetailResponse` | `awaitingConfirmationSince`, alongside `state` |
| `CaseSummaryResponse` | Days waiting while returned by the awaiting-confirmation filter |
| `GET /caseworker/cases` | A named awaiting-confirmation filter, longest wait first |

Expected enum values are `Confirmed` and `Withdrawn`. Do not encode them until the OpenAPI schema confirms
their spelling and casing.

---

## Constraints

The repository rules apply: strict TypeScript with no `any`, ES modules, Biome, colocated tests,
feature-grouped folders, wire types generated from the OpenAPI contract, no database, and no page speaking
HTTP except through `libs/deed-poll-api-client`.

Additional constraints:

- **Do not start before api notify-3b is merged.** A plan file is not an API contract.
- **Do not hand-edit a guessed wire shape.** Refresh `openapi.json`, update `SPEC-PROVENANCE.md`, and satisfy
  the set-equality contract tests atomically.
- **Do not duplicate notify-2's contract refresh.** If notify-2 already imported the api commit containing
  notify-3b, Task 1 is verification only. If this plan imports it first, it must register every outstanding
  schema and operation—including email schemas notify-2 will later consume—because the contract test does not
  permit partial adoption.
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
`yarn turbo test test:app --concurrency=1` exits **0** with **3,125 tests across 166 files**. That is the
baseline Task 1 was told to record, so it does not need rediscovering — but re-measure rather than quoting it if
anything has merged since.

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

- [ ] api notify-3b is merged, every provisional contract name is replaced by the published one, the atomic
      refresh has one named owner, and the validation commands are green without behavior changes

### Task 1: Adopt the OpenAPI contract atomically

If the exact api commit is already the provenance entry, verify this task and make no duplicate change.
Otherwise:

- Replace `libs/deed-poll-api-client/openapi.json` from api's generated document and add a complete
  `SPEC-PROVENANCE.md` entry.
- Account property-by-property for changes to existing case and referral schemas, not only new operation
  counts.
- Register every new schema in `WIRE_SCHEMAS`, every operation in `IMPLEMENTED_OPERATIONS`, and every response
  in `STRICT_RESPONSE_PROPERTIES`; update request-schema completeness checks.
- Verify the confirmation request is not published as `{}` and the filter/sort vocabulary is present in the
  case-list parameter descriptions.
- Update notify-2's Task 0/1 status if this import also satisfies its contract gate.

- [ ] the generated document and provenance name the merged api commit, all outstanding contract additions
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
- Run the full validation commands, record final test counts against the baseline, and remove every
  `[PROVISIONAL]` marker.

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
