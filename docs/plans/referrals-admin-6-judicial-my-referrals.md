# Plan: referrals to the judiciary (admin follow-up 6) — My referrals

## Overview

Business testing found that a judge who claims a referral cannot find it after navigating away. The shared
pool page correctly shows only `Open` referrals, so a successful claim removes the row from the only judicial
list. The detail route remains readable to the holder, but only through browser history or a remembered UUID.

The API companion plan,
`deed-poll-api/docs/plans/referrals-api-6-judicial-my-referrals.md`, adds:

```http
GET /judicial/referrals/mine
```

This plan consumes that operation and adds a role-gated **My referrals** page for the signed-in judge's
`Claimed` and `Decided` referrals.

## Dependencies and reconciliation gate

Implement after:

1. API follow-up 6 is merged and its regenerated OpenAPI document is available;
2. admin follow-up 4 supplies final withdrawal/closure behaviour;
3. admin follow-up 5 supplies lifecycle-note mock parity.

Before coding, refresh `libs/deed-poll-api-client/openapi.json` according to `SPEC-PROVENANCE.md`. The expected
contract delta is exactly one judicial GET operation and `JudicialMyReferralsResponse`. API follow-up 6 also
adds stable-owner fields in persistence, but they must not appear in any published DTO. Stop if owner ids
appear on the wire, application fields appear in list rows, or an unrelated operation/schema changes.

## User journey

1. A judge lands on **Referrals for a direction**, the existing shared `Open` pool.
2. Judicial list navigation offers **Referrals for a direction** and **My referrals**.
3. Claiming a referral removes it from the pool and makes it appear under **My referrals** as
   “Direction needed”.
4. Recording a direction keeps it under **My referrals** as “Direction recorded”.
5. A lapsed or withdrawn claim disappears; a direction disappears once a caseworker marks it actioned.
6. Opening any row uses the existing judicial detail page and its narrow application projection.

## Decisions — implement these, do not revisit

### 1. This is a second API-backed collection, not a local pool filter

Add a new client/domain operation and page:

```text
GET /judicial/referrals/mine?page=…
```

Do not derive “mine” from rows previously seen in the pool, session state, browser history, `claimedBy`
display text or local mock knowledge. The API token supplies ownership and returns the complete page.

### 2. The personal list shows `Claimed` and `Decided`, and nothing historical

Render the states in user-facing terms:

- `Claimed` → **Direction needed**
- `Decided` → **Direction recorded**

Do not include `Open`, `Withdrawn` or `Closed`. The page is current judicial work and recently completed
judicial work still awaiting the office, not an audit/history screen.

The API owns membership and order. Admin formats rows but does not filter, regroup or sort them.

### 3. Reuse the narrow summary; never enrich list rows

The new envelope contains the existing `JudicialReferralSummary`. The page may show:

- status;
- urgency;
- reasons;
- date raised;
- a link keyed only by referral id.

It must not fetch case details per row or show applicant names, case reference, direction text or case notes.
Those remain on the existing detail read after its visibility check. Avoiding per-row detail calls is both the
disclosure boundary and protection from an N+1 worklist.

### 4. Add judicial list navigation locally, not global caseworker navigation

Create one shared judicial-list navigation partial/component used by both:

- `/judicial/referrals` — **Referrals for a direction**;
- `/judicial/referrals/mine` — **My referrals**.

Use a labelled `<nav>` and `aria-current="page"` on the active link. Do not add this to global service
navigation or the caseworker case list: the `/judicial/**` middleware remains the persona boundary.

The service root still sends a judicial-only user to the shared pool. Landing-page behavior does not depend on
an extra API call to discover whether they own anything.

### 5. Detail back-navigation follows referral state

The existing detail page always says “Back to referrals” and links to the pool. Change the destination and
specific copy from the state already returned:

- `Open` → **Back to referrals for a direction** → `/judicial/referrals`;
- `Claimed`/`Decided` → **Back to My referrals** → `/judicial/referrals/mine`.

Do not trust a `returnTo` query parameter. The state is API-owned and prevents an open redirect. Direction
form/check pages continue returning to the referral detail; after claim or direction, that detail naturally
returns to **My referrals**.

An unavailable referral has no trustworthy state and continues returning to the shared pool.

### 6. The static `mine` route must win over the dynamic referral route

`src/pages/judicial/referrals/mine.ts` and the mock/API literal route coexist with
`[referralId].ts`/`/{referralId}`. Add routing tests proving `/mine` renders the list and is never treated as
referral id `"mine"`.

### 7. Mock behavior must model ownership and lifecycle

The in-memory API adds `/judicial/referrals/mine` before its dynamic referral matcher. It identifies the
caller using the same mock judicial identity mechanism as claim/direction and returns only that subject's
`Claimed`/`Decided` rows.

Because API follow-up 6 moves ownership to stable subject ids, add corresponding mock-only owner ids that are
never serialized. Display names remain response attribution. Prove two personas with the same display name but
different subjects do not see each other's work.

Membership changes through real mock transitions:

- claim adds;
- direction changes the displayed state but retains the row;
- lapse/withdraw/closure remove;
- refused writes change nothing.

The mock reproduces API order and paging. The page never compensates for incorrect mock ordering.

### 8. Errors follow existing judicial list behavior

The page is one load-bearing API read:

- malformed `page` is normalized by the existing `parsePage` convention before calling API;
- API 400/401/403/5xx retain existing classifications;
- an unavailable API renders through the established error handling, not an empty “My referrals” success;
- an empty successful response says the judge has no current referrals.

Do not add claim-refusal messaging to this page: a beaten claim remains the shared pool's responsibility.

## Layers

1. **Spec** — refresh `openapi.json`; expected delta only.
2. **Wire/client** — register `JudicialMyReferralsResponse`; add `getJudicialMyReferrals`.
3. **Mock** — stable mock owner ids, literal route, exact membership/order/paging/lifecycle.
4. **Domain** — add `listMyReferrals(paging, caller)` and `buildMyReferralRows`; no ownership logic.
5. **Pages** — add `mine.ts`/`mine.njk`, shared judicial-list navigation, and state-derived detail back link.
6. **Tests** — contract, client, mock, domain, route/template/app and E2E.

## Tasks

### Task 0: Reconcile the published API contract

Regenerate and refresh the spec, provenance and contract fixtures. Verify:

- five judicial operations;
- the literal `/judicial/referrals/mine` GET;
- `JudicialMyReferralsResponse` reusing `JudicialReferralSummary`;
- no owner ids or extra application data on the wire;
- no unrelated schema/operation delta.

Record focused app/package/E2E baselines and stop on drift.

- [ ] API contract reconciled and baselines recorded; no implementation files changed beyond the mechanical,
      provenance-backed spec refresh

### Task 1: Add client, domain and mock support

Add:

- `getJudicialMyReferrals(query, config)` in the API client;
- the new envelope schema/type and operation registration;
- `listMyReferrals(paging, caller)` in the judicial domain service;
- `buildMyReferralRows` with status labels/tags and formatting only.

Extend the mock with stable subject ownership and the literal personal-list route before the dynamic route.
Test exact operation path/query encoding, response validation, 401/403/error propagation, membership,
ordering, paging, lifecycle changes and same-display-name isolation.

Do not change existing pool semantics or sort/filter in the domain/view layer.

- [ ] Contract-equal client, thin domain service, formatting-only view model and faithful owner-scoped mock
      implemented; focused tests green

### Task 2: Add the My referrals page and navigation

Create the role-gated static page and template. Render:

- heading/intro and empty state;
- status, urgency, reasons and raised date;
- API total/pagination;
- qualified accessible links to existing referral detail;
- shared judicial navigation with correct `aria-current`.

Update the shared-pool page to render the same navigation. Prove static-route precedence, no case/application
fields, API order preservation, pagination URLs, empty/error states, escaping, Welsh key parity and
accessibility markup.

- [ ] Both judicial lists have accessible navigation; My referrals renders only the existing narrow summary;
      route/template/app tests green

### Task 3: Fix referral-detail return paths

Derive the detail page's return link from the API state:

- pool for `Open`;
- My referrals for `Claimed`/`Decided`;
- pool for unavailable/refused reads where no state exists.

Update view/handler/template tests and the claim/direction flows so a judge can claim, leave, return through
My referrals, direct, and return again without browser history. Do not add or accept `returnTo`.

- [ ] Claimed/decided detail returns to My referrals; open/unavailable detail returns to the pool; tests green

### Task 4: Prove the complete cross-persona lifecycle

Extend `e2e-tests/tests/judicial.spec.ts`:

1. claim a referral from the shared pool;
2. navigate away and recover it from My referrals;
3. switch to caseworker and back to judge, then recover it again;
4. record a direction and verify “Direction recorded” remains in My referrals;
5. switch to caseworker, action/close it using follow-up 4;
6. return as judge and verify it has left My referrals.

Add withdrawal and lapse coverage at the mock/domain level; use E2E only where it proves the user-visible
journey. Run axe on both list states and verify keyboard/navigation and no applicant data on either list.

- [ ] Original feedback journey and terminal removal proven end to end; focused E2E green

### Task 5: Documentation and full validation

Update completed admin-3's known-gap note, API-client comments, judicial page documentation and any assertions
that there are only four judicial operations or no judicial navigation.

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

- Permanent history of closed or withdrawn referrals.
- Judicial case search, filters or applicant information in list rows.
- A caller-selected owner/judge filter.
- Counts or badges outside the two judicial list pages.
- Changing the shared pool order, claim expiry or application state.
- Global navigation between judicial and caseworker personas.
