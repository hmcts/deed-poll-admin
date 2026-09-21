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

## Validation Commands

**Added 2026-09-21, before the plan was run — it had none, exactly as `referrals-admin-5` had none.** `ralphex`
runs this section after every task; without it there is no per-task gate, and a task can leave the suite red
while the next one starts regardless.

```bash
yarn lint
npx turbo test test:app --concurrency=1
```

**Verified green on this branch before Task 1** — `yarn lint` exits 0, `8 successful, 8 total` across
**164 test files, 2,991 tests**. Those are Task 0's baselines and what Task 5 measures against.

**Two things must stay out of this section, and one of them is specific to this plan:**

- **`yarn welsh:check` exits 1 on `master`** — 446 strings, 421 still identical in `cy`, the repo-wide
  `cy = { ...en }` state pending the translation request. A gate that starts red fails every task from the
  first. It is **not** one of the six Jenkins-owned scripts, so it does not fail the build. This plan adds a
  page, so Task 5 should confirm the count has moved only by this plan's own new keys — **compare against 421,
  do not expect a zero exit.**
- **`yarn test:e2e`** needs a running app and mock, and **cannot start its own `webServer` from inside a
  worktree**: `dev:nowatch:web` runs `yarn dev:up`, and docker compose names its project after the directory, so
  it collides with the `deed-poll-redis`/`deed-poll-idam` containers the main checkout owns. Start the mock and
  app by hand without `dev:up` and let `reuseExistingServer` find them. **If port 3200 is already held it belongs
  to another agent's worktree — do not kill it**; wait, or report and stop.

**A bare `yarn test` is not a substitute.** It reports failure with `0 successful, 8 total` and "no tests" while
running nothing at all, which reads as a red suite and is not one. The `--concurrency=1` form is what runs.

## Tasks

### Task 0: Reconcile the published API contract

> **DONE 2026-09-21, by hand in a Claude Code session.** Every check passes and the delta is exactly what this
> plan predicted. Nothing was changed but this plan — **including `openapi.json`, which this task deliberately
> did NOT refresh. See "the correction to this task's own shape" below; it is not an omission.**
>
> **api follow-up 6 is merged** — `referrals-api-6` as PR **#36**, api `origin/master` at
> `227b714819d522197b1e1aecd31ab78a5172f292`, its plan moved to `completed/`, the clone clean and idle.
>
> **The delta is exactly one operation and one schema, measured:**
>
> | | admin now | api at `227b714` |
> |---|---|---|
> | Operations | 38 | **39** |
> | Schemas | 37 | **38** |
>
> Added: `GET /judicial/referrals/mine` and `JudicialMyReferralsResponse`. **Nothing removed, and no
> pre-existing schema altered in any property.** Five judicial operations, as required — pool, mine, detail,
> claim, direction.
>
> **All three stop conditions are clear, checked against the published schemas rather than api's source:**
>
> - **No owner ids on the wire.** `JudicialMyReferralsResponse` is `{ page, size, total, totalPages, referrals }`
>   and nothing else; `JudicialReferralSummary` is `{ id, state, reasons, notes, urgency, urgencyReason,
>   createdOn }`. There is no `ownerId`, `subject`, `claimedBy` or any other holder identifier anywhere in
>   either. api-6's stable-owner persistence fields stayed out of the DTOs, which is what this plan required.
> - **No application fields in list rows.** `JudicialReferralSummary` carries referral fields only — no case
>   reference, no applicant name, no surname, no application dates.
> - **No unrelated operation or schema changed.** Measured property-by-property, not by count.
>
> **`JudicialMyReferralsResponse` does reuse `JudicialReferralSummary`** — it `$ref`s it rather than declaring a
> second row shape, so the pool and the personal list are the same row type. The operation takes `page` and
> `size` as query parameters and declares only `200`.
>
> **Baselines: 164 test files, 2,991 tests, `yarn lint` exit 0** — see "Validation Commands", added below
> because this plan shipped without one.
>
> ---
>
> **The correction to this task's own shape, and it is the reason `openapi.json` is untouched.** As written, this
> task refreshed the spec while Task 1 registered the schema and operation. **That cannot work.**
> `libs/deed-poll-api-client/src/api/contract.test.ts:97` is
> `expect([...IMPLEMENTED_OPERATIONS].sort()).toEqual(inSpec)` — exact set equality against the document, and
> `WIRE_SCHEMAS` is compared the same way. So the moment `openapi.json` gains the new operation and schema, the
> contract test fails until both are registered: **this task would have ended red and taken every task after it
> down with it.**
>
> **So the refresh moves into Task 1, atomically with the registration**, which is the only split available and
> the same one notify-2 used. This task keeps the verification, which needs no write: api's document was
> generated per `SPEC-PROVENANCE.md` and compared to this repo's copy in place. Task 1 now owns the refresh, the
> new `SPEC-PROVENANCE.md` entry, and the registry — in one commit.

Regenerate and refresh the spec, provenance and contract fixtures. Verify:

- five judicial operations;
- the literal `/judicial/referrals/mine` GET;
- `JudicialMyReferralsResponse` reusing `JudicialReferralSummary`;
- no owner ids or extra application data on the wire;
- no unrelated schema/operation delta.

Record focused app/package/E2E baselines and stop on drift.

- [x] API contract reconciled and baselines recorded; ~~no implementation files changed beyond the mechanical,
      provenance-backed spec refresh~~ **no implementation files changed at all — the spec refresh moved to
      Task 1 because it is atomic with registration, see above**

### Task 1: Add client, domain and mock support

**Start by refreshing `openapi.json`, and do it in this task rather than the last one — the refresh and the
registration are one atomic step.** `contract.test.ts` compares `IMPLEMENTED_OPERATIONS` and `WIRE_SCHEMAS`
against the document as **set equality in both directions**, so a refreshed document with an unregistered
operation is a red suite. Refresh, register, and let the tests go green inside this one commit.

**The document is already generated** — Task 0 produced it from api
`227b714819d522197b1e1aecd31ab78a5172f292` (`origin/master`, PR #36) and it is at
**`/tmp/openapi-specs.json`**. Copy and reformat it with the `node -e` one-liner in `SPEC-PROVENANCE.md` step 1,
then **`biome format` the file** or 200-odd lines of array-formatting churn will hide whether anything was
removed. Write the new provenance entry to that file's standard; the facts are settled in Task 0 — **38 → 39
operations, 37 → 38 schemas, purely additive, nothing removed and no pre-existing schema altered**, so its "what
changed that was not an addition" section is "nothing".

**Do not run Gradle and do not touch the `deed-poll-api` clone.** Another agent works in it. If
`/tmp/openapi-specs.json` is missing or its counts are not 39 operations and 38 schemas, **stop and report**
rather than regenerating from whatever state that clone is in. `SPEC-PROVENANCE.md`'s two out-of-band re-checks
(the actuator settings and the `where`/`sort` parameter descriptions) can be done with
`git show <sha>:<path>`, never by checking that clone out.

Add:

- `getJudicialMyReferrals(query, config)` in the API client;
- the new envelope schema/type and operation registration;
- `listMyReferrals(paging, caller)` in the judicial domain service;
- `buildMyReferralRows` with status labels/tags and formatting only.

Extend the mock with stable subject ownership and the literal personal-list route before the dynamic route.
Test exact operation path/query encoding, response validation, 401/403/error propagation, membership,
ordering, paging, lifecycle changes and same-display-name isolation.

Do not change existing pool semantics or sort/filter in the domain/view layer.

- [x] Contract-equal client, thin domain service, formatting-only view model and faithful owner-scoped mock
      implemented; focused tests green

> **DONE 2026-09-21.** `yarn lint` exits 0 and `npx turbo test test:app --concurrency=1` is `8 successful, 8
> total` across **164 test files, 3,040 tests** — Task 0's 2,991 plus **49**, and no new test file, because every
> one went into a suite that already existed.
>
> **The spec refresh is exactly the predicted delta, measured rather than trusted**: 37 → 38 schemas, 38 → 39
> operations, **63 insertions and 0 deletions**, every pre-existing schema and operation byte-identical and **not
> one `operationId` shifted**. All three stop conditions clear; `contract.test.ts` now pins two of them itself —
> no `claimedById`/`decidedById`/`ownerId`/`subject`/`userId` on any of the seven `Judicial*` schemas, and
> `JudicialMyReferralsResponse.referrals` `$ref`ing `JudicialReferralSummary` rather than a second row shape.
>
> **The mock's owner ids needed a second identity, not just a second field.** `auditName` returned the token's
> `sub`, so subject and display name were one string and "keyed on the name" was **unfalsifiable**: every
> ownership test would have passed against either. So `callerSubject` is new beside it, `auditName` now prefers a
> `name` claim where the token carries one — which is also closer to api, whose display name comes from IDAM's
> `/o/userinfo` — and `asPerson(name, subject)` in the tests is what makes two judges share a display name while
> owning separate work. `visibleToJudge` and the direction's holder check both compare the **subject** now, and a
> row with a `claimedBy` and no subject is on nobody's list, exactly as api fails a pre-migration row closed.
>
> **`toWireReferral` was the leak to close.** It is `isoDates(referral)` — a spread — so the two new fields
> reached the caseworker referral response the moment they existed, and zod would have stripped them on the way
> back in without a word. They are now destructured out by name, with a test that fails on the subject appearing
> in either serialisation.
>
> **`MY_REFERRAL_STATE_LABEL` is keyed on `"Claimed" | "Decided"` and not on `ReferralState`**, against this
> repo's usual "key the map on the enum so a new member is a type error": only those two states can be on this
> list, and a judicial wording for `Open` would be a label for a row that must not exist. Anything else answers
> `NOT_RECORDED` rather than api's raw member.
>
> **One thing Task 2 should know, and it is not a defect here.** `scripts/seed-local-cases.mjs` claims and
> directs as `seed.judge@example.com`, so after `yarn mock:seed` the seeded `Claimed`/`Decided` referrals belong
> to **that** subject and the persona judge's own My referrals is empty until they claim something. That was
> invisible while ownership was the display name only because nothing listed it.

### Task 2: Add the My referrals page and navigation

> **Found by Task 1, and it will otherwise read as a broken page.** `scripts/seed-local-cases.mjs` claims and
> directs as `seed.judge@example.com`, so after `yarn mock:seed` every seeded `Claimed`/`Decided` referral belongs
> to **that** subject. The persona judge's **My referrals** is therefore legitimately **empty** until they claim
> something themselves — which is the empty state working, not a failed read. Claim one from the pool first when
> checking this by hand, and do not "fix" the seeder to assign work to the persona judge: two judges owning
> separate work is the property Task 1's subject-keying exists to provide.

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
