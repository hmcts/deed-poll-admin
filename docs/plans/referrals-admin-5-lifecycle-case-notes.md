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

## Tasks

### Task 0: Reconcile API wording and current note surfaces

Confirm API follow-up 5 is merged, copy its final event matrix and exact strings, and verify:

- case detail maps `record.notes`;
- judicial detail maps the same notes into `caseNotes`;
- no response schema or page filtering change is required;
- follow-up 4's withdrawal and closure behaviour is present in the mock.

Record focused adapter/app/E2E baselines. Stop on contract drift.

- [ ] API wording, mock transitions and existing note views reconciled; baselines recorded; no files changed

### Task 1: Add mock lifecycle-note side effects

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

Record final totals against Task 0 and verify the six Jenkins-owned package scripts remain.

- [ ] Documentation current; full app, lint, Welsh and E2E validation green; final totals recorded

## Out of scope

- New production admin pages or service calls.
- A generated-note badge or immutable-note controls.
- A new note/referral API contract.
- A judicial “My referrals” list, planned in `referrals-admin-6-judicial-my-referrals.md`.
- Claim-lapse scheduling that the mock does not already implement.
