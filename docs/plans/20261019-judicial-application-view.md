# Plan: judges see the full application, and can change or withdraw their direction (admin)

## Overview

The admin half of deed-poll-api#118 ("Judges see the full application, and can revise or withdraw their direction").
**Run only after #118 has merged**: this plan consumes its contract.

Business decisions (Steve, 2026-10-19). They supersede decision 8 of 2026-09-17, which limited judges to eight fields:

- judges see the application's details, witnesses and supporting documents, but no payment or refund data;
- private cases show in full;
- every judge who can see an `Open` referral can open its documents;
- nothing is visible once the office closes the referral;
- the judge who gave a direction may change it, or withdraw it and give a new one, until the referral is closed;
- the caseworker is told by a case note (written by api) and a flag (`directionChangedAt`);
- the original direction stays on record (api's audit trail).

**The contract this plan builds against** (api#118's generated spec, head `73206ce`):

| Operation | operationId | Notes |
|---|---|---|
| `GET /judicial/referrals/{referralId}` | existing | `application` is now `JudicialApplicationView`; the detail gains `directionChangedAt` |
| `PUT /judicial/referrals/{referralId}/direction` | `reviseDirection` | same body as `POST` (`JudicialDirectionRequest`) |
| `POST /judicial/referrals/{referralId}/direction/withdraw` | `withdrawDirection` | no body; returns the referral, now `Claimed` |
| `GET /judicial/referrals/{referralId}/documents/{documentId}/file` | `document` | binary; api sets Content-Type, disposition, `no-store` |

- **`JudicialApplicationView`** carries:
  - `displayReference`, `type`, `state`, `privacy`, `urgency`, `urgencyreason`, `inPerson`, `maritalStatus`;
  - the six old and new name fields;
  - the applicant fields `applicantBuildingNoName`, `applicantEmail`, `applicantTelephone`, `applicantTownCity`,
    `applicantPostcode`;
  - the representative fields `representativeName`, `representativeBuildingNoName`, `representativeCompany`,
    `representativeEmail`, `representativeTelephone`, `representativeTownCity`, `representativePostcode`;
  - `ageOfMinor`, `ageOfMinorMonths`, `minorDateOfBirth`, `parents`;
  - `nationality`, `nationalitySection`, `nationalitySectionOther`;
  - `dateOfDeclaration`, `dateOfApplication`, `dateReceived`, `awaitingFurtherDocsInfo`;
  - the previous system's referral fields `referToMasterChoice`, `masterName`, `masterDirections`,
    `masterDecision`, `masterDateOfDecision`, `dateDecisionDirectionsReceived`, `referralNotes`;
  - `witnesses: JudicialWitness[]` and `documents: JudicialDocument[]`.
- **`JudicialWitness`** carries `witnessName`, `witnessAddress`, `witnessOccupation` and `declarant`. There is no id.
- **`JudicialDocument`** carries `id`, `name`, `documentType`, `direction`, `mimeType`, `sizeBytes` and
  `uploadedOn`. Only attached files are listed.
- **`JudicialCaseView` is removed**, and `ReferralResponse` gains `directionChangedAt` (nullable date-time).

If the spec you refresh from differs from this table, stop and report the difference rather than adapting to it.

## Prerequisite (checked in Task 0, done by whoever launches)

The spec generated from api `origin/master` **after #118 merged** is at `/tmp/openapi-specs-api.json`, and its
api commit is in `/tmp/openapi-specs-api.commit`. To produce it, run `./gradlew integration` in an api worktree at
that commit, then copy `/tmp/openapi-specs.json`. Don't commit it on its own: `contract.test.ts` is set-equality
both ways, so the spec and the adapter must land together in Task 1, or the suite goes red.

## Decisions: implement these, do not revisit

1. **One refresh, in Task 1.** Copy the staged spec over `libs/deed-poll-api-client/openapi.json`, and in the same
   commit:
   - replace `judicialCaseViewSchema` in `wire.ts` with `judicialApplicationViewSchema`, `judicialWitnessSchema`
     and `judicialDocumentSchema`, and register them;
   - add `directionChangedAt` to the referral and judicial detail schemas;
   - replace `JudicialCaseView` in `client.ts` with the new types;
   - add `reviseDirection`, `withdrawDirection` and `downloadJudicialDocument` adapter functions.

   **Trap:** a bare grep for a field name in `wire.ts` passes falsely, because the caseworker schemas share the
   names. Check the field set per schema, which `contract.test.ts` does.
2. **The mock follows api's rules.** The judicial fixtures carry the wide application, witnesses and documents. Its
   visibility matches api: any judge on `Open`, the holder on `Claimed`, the director on `Decided`, nobody on
   `Closed`/`Withdrawn`, and the same 404 for each. `PUT` direction and withdraw behave as api's:
   - only the director, only while `Decided`, else 409;
   - withdraw leaves the referral `Claimed` by the same judge with the direction cleared;
   - both set `directionChangedAt`;
   - both add a case note.
3. **The "Application" section on `src/pages/judicial/referrals/referral.njk`** is read-only. It builds GOV.UK summary
   lists of the details, grouped and labelled like the caseworker detail page. Reuse `detail-view.ts`'s formatting
   functions (dates, enums, names) rather than copying them. It also has a witnesses list and a documents table
   (name, type, uploaded date, size) whose names link to the download route. With no documents, it says "No
   documents have been added to this application", never an empty table. No edit, upload, delete or email
   controls. Build its model in `libs/deed-poll/src/judicial/view.ts` from the judicial type only. Never import the
   caseworker view model wholesale: the judicial page must not grow a field because the caseworker one did.
4. **Document route `src/pages/judicial/referrals/[referralId]/documents/[documentId]/file.ts`.** It streams with
   `pipeline` and forwards api's Content-Type and disposition, with the same header containment and `nosniff` as
   the caseworker route (`src/pages/deed-polls/[id]/documents/[documentId]/file.ts`). Extract the shared part into
   one module rather than copying it. A 404 renders `judicial/referrals/unavailable.njk`, whose wording must stay
   true of every cause (CLAUDE.md: judicial copy never names or implies a holder).
5. **Change your direction.** On a `Decided` referral directed by this judge (api only shows it to them), a "Change
   your direction" link goes to `/judicial/referrals/{id}/direction?change=1`. It reuses `direction-form.njk`,
   prefilled from the current direction, and the existing check page with the same attestation, then calls
   `reviseDirection`. The heading, the check page heading and the button say "change". Validation and 400
   handling are the existing `POST`'s.
6. **Withdraw your direction.** A "Withdraw your direction" link goes to a confirmation page,
   `src/pages/judicial/referrals/[referralId]/withdraw.ts`, with this content: "You'll need to give a new
   direction. Until you do, this referral stays claimed by you. If it isn't directed, it may return to the shared
   list like any other claim." A "Withdraw direction" button calls `withdrawDirection`, then redirects to the
   referral, which now shows the direction form as for any `Claimed` referral.
7. **Refusals.** A 409 on change or withdraw re-reads the referral and renders its current state, as the claim
   flow does. A 404 renders the unavailable page. The copy must not say who did what.
8. **Caseworker notice.** When `directionChangedAt` is set, the caseworker referral page
   (`src/pages/deed-polls/[id]/referrals/[referralId].ts`, view model `buildReferralDetail` in
   `libs/deed-poll/src/referrals/referrals-view.ts`) and the referrals panel on the case page show GOV.UK inset
   text: "The judge changed this direction on {date}." Use the existing `formatTimestamp`.
9. **Every new page and string has `en`/`cy` pairs.** `src/pages/judicial/**` is already in
   `scripts/extract-welsh-strings.mjs`'s `INCLUDE`. The switcher's English-only exception doesn't apply here.

## Constraints

- Work only in this worktree (`.worktrees/deed-poll-admin-judicial-view`, branch `plan/judicial-application-view`
  from `origin/master`). Never touch the main `deed-poll-admin` clone: it holds Rowan's work.
- Never quote bare `yarn test` as evidence. Use the turbo command below. Foreground runs only; never background
  a test or build.
- Each task is test-first: the new test is seen failing first. Template tests spread `en` first and the
  handler's model over it (`.claude/rules/testing.md`).
- No new dependency. Pinned versions only. No `any`. Do not push.
- No page reads a role. Access is api's answer, and the `/judicial` mount in `src/app.ts` already gates the area.
- **Every new path containing an id is built in the handler, never in a template** (CLAUDE.md "Redirect paths").
  This covers the document links, the change and withdraw links, and every redirect:
  - use `referralPath(referralId)`, and `pathSegment(documentId, "document")` for the document id;
  - pass the finished hrefs to the template;
  - never interpolate `{{ referral.id }}` or a document id into an `.njk` href;
  - build a redirect target before the api call that precedes it.

## Validation Commands

**Must be green after every task, and before Task 1.**

```bash
yarn lint
npx turbo test test:app --concurrency=1
```

`yarn welsh:check` exits 1 on master by design (untranslated `cy`), so it isn't in this list. Task 0 records its
count, and Task 5 checks it moved only by this plan's new keys. A Biome "nested root configuration" error means a
stale `.claude/worktrees/`, not this change. Record test files and test counts after each task.

## Implementation Steps

### Task 0: Prerequisite and baseline
- [x] `/tmp/openapi-specs-api.json` exists, and its paths include operationIds `reviseDirection`,
  `withdrawDirection` and `document` under `/judicial`. If not, stop: #118 isn't merged or the spec isn't staged.
  (api commit `93c2dd370cb4d63f51375da155818ea452dcc9da`. Matches the contract table: `JudicialApplicationView`'s
  46 properties are exactly the listed set, `JudicialWitness`/`JudicialDocument` as listed, `JudicialCaseView`
  gone, `directionChangedAt` nullable date-time on `ReferralResponse` and `JudicialReferralDetail`; `PUT`
  takes `JudicialDirectionRequest`; withdraw has no body and returns `JudicialReferralDetail`.)
- [x] Run the Validation Commands. Record test files, tests and the `yarn welsh:check` count.
  (Baseline: `yarn lint` clean, one schema-version info only. Turbo 8/8 tasks green: 213 test files, 4446 tests —
  app 104/2168, deed-poll 66/1183, api-client 11/740, cloud-native-platform 13/157, express-govuk-starter 12/127,
  simple-router 4/41, express-session-postgres 2/23, express-session-redis 1/7. `yarn welsh:check`: 691 strings,
  474 still identical in cy (467 prose, 7 not prose).)

### Task 1: Spec refresh, wire schemas, adapter
- [x] Decision 1, in one commit. `contract.test.ts` passes, and `client.test.ts` covers the three new adapter
  functions against the mock.
  (Parsed delta is exactly the contract table, recorded in `SPEC-PROVENANCE.md`: 55 operations, 39 paths, 58
  schemas. `JudicialApplicationView` strict on `witnesses`/`documents`, `JudicialWitness` on `declarant` (a
  `boolean` on api's record, checked at the commit), `JudicialDocument` on `id`. A contract test pins no payment,
  refund, fee or case-id property on the view. `view.ts` only re-points its import; Task 2 widens it.)
- [x] Mock (decision 2), with tests:
  - visibility in all five states;
  - change and withdraw refusals (409 and 404);
  - `directionChangedAt` set by both;
  - the document download serving bytes with headers.
  (Revise/withdraw case notes copy api's `ReferralNotes.directionRevised`/`directionWithdrawn` at `93c2dd3`. One
  `sendDocumentFile` serves both downloads. 12 of the new mock tests were red against the old mock.)
- [x] Record the api commit from `/tmp/openapi-specs-api.commit` in the commit message.
  (Validation: `yarn lint` clean apart from the schema-version info. Turbo 8/8: 213 files, 4476 tests; api-client
  11/770, all others unchanged.)

### Task 2: The Application section
- [ ] View model and template tests (red first):
  - every field group renders, for a private case too;
  - no payment, refund, fee or case-id label appears;
  - witnesses render;
  - documents link to the judicial route;
  - the empty-documents sentence shows with no documents;
  - there are no edit controls.

### Task 3: Document download
- [ ] Route tests:
  - streaming and headers match the caseworker route's, through the shared module;
  - a 404 renders the unavailable page;
  - the route is under the `/judicial` mount, so `src/app.test.ts` still passes.

### Task 4: Change and withdraw
- [ ] Tests:
  - the prefilled change form, its check page and the `reviseDirection` call;
  - the withdraw confirmation, its call, and the redirect to a referral showing the direction form;
  - links only on `Decided`;
  - 409 and 404 as decision 7.
- [ ] A Playwright journey in `e2e-tests/tests/`, happy path only: a judge opens a decided referral, sees the
  application and its documents, changes the direction, then withdraws it and directs again.

### Task 5: Caseworker notice, Welsh, handoff
- [ ] Decision 8, with view-model and template tests.
- [ ] `yarn welsh:check`'s count moved by exactly this plan's new keys.
- [ ] `CLAUDE.md` "Personas and role gating": judges now see the full application and documents (2026-10-19), and
  how change and withdraw work. Update `libs/deed-poll/src/judicial/view.ts`'s header comment, which still
  describes the eight-field view.
- [ ] Final Validation Commands with counts.
