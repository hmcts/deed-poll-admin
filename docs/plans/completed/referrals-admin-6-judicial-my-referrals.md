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

- [x] Both judicial lists have accessible navigation; My referrals renders only the existing narrow summary;
      route/template/app tests green

> **DONE 2026-09-21.** `yarn lint` exits 0 and `npx turbo test test:app --concurrency=1` is `8 successful, 8
> total` across **166 test files, 3,073 tests** — Task 1's 164/3,040 plus the two new files and **33** tests.
> `yarn welsh:check` is `465 strings, 440 still identical` — Task 0's 446/421 plus **19**, which is exactly this
> task's own new keys (16 on `mine.ts`, 3 for the pool's `nav`) and nothing else.
>
> **Decision 6 is pinned by dispatch, not by registration order.** `mine.test.ts` builds a real
> `createSimpleRouter` over the real `src/pages` tree with a view engine that names the template it was handed,
> then asserts `/judicial/referrals/mine` renders `mine.njk` with `listMyReferrals` called once and `getReferral`
> never — and that `/judicial/referrals/ref-1` still reaches `[referralId].ts`. Asserting the *order* `sortRoutes`
> produced would have passed on a router that then dispatched the other way; this fails the way the bug would
> present, as a judge being told their own list is no longer available.
>
> **The navigation is one partial with both destinations in it**, `judicial/referrals/list-navigation.njk`, so
> neither page can grow a link the other lacks — which is the failure decision 4 is guarding against, since the
> pool is the page a judge is standing on when the row they just claimed disappears. `aria-current="page"` stays on
> a link rather than becoming a `<span>` as `app-filter-nav` does: the plan asks for the link, and the state is
> announced by `aria-current`, printed as weight and underlined by `app-judicial-nav__current`.
>
> **Its own SCSS component rather than reusing `app-filter-nav`**, whose ~20 lines it resembles: that one is the
> case list's filter bar with labelled groups and variable-length saved-query entries, and sharing its classes
> would tie a change made for one page to a page that filters nothing. **Not `govukServiceNavigation` either** —
> it renders its own `govuk-width-container`, which inside the layout's would mean nesting one in another to say
> something only two pages may say, and decision 4 keeps this off global chrome.
>
> **The nav copy is in each page's own `en`/`cy`, deliberately duplicated.** It is user-facing wording, so it has
> to reach the translation request through `extract-welsh-strings.mjs`, and a shared const in a library would be
> English that Welsh cannot reach — the argument `buildDirectionView` already makes about "Yes"/"No". Both pages
> assert the same three strings, so a change to one that misses the other fails.
>
> **One thing Task 3 should know.** `mine.njk` links every row to `/judicial/referrals/{id}` and that detail page
> still says "Back to referrals" and links to the pool, so a judge who opens one of their own referrals from this
> list is currently returned to the list it is *not* on. That is Task 3's subject, not a defect here.

### Task 3: Fix referral-detail return paths

Derive the detail page's return link from the API state:

- pool for `Open`;
- My referrals for `Claimed`/`Decided`;
- pool for unavailable/refused reads where no state exists.

Update view/handler/template tests and the claim/direction flows so a judge can claim, leave, return through
My referrals, direct, and return again without browser history. Do not add or accept `returnTo`.

- [x] Claimed/decided detail returns to My referrals; open/unavailable detail returns to the pool; tests green

> **DONE 2026-09-21.** `yarn lint` exits 0 and `npx turbo test test:app --concurrency=1` is `8 successful, 8
> total` across **166 test files, 3,086 tests** — Task 2's 166/3,073 plus **13**, and no new test file.
> `yarn welsh:check` is `466 strings, 441 still identical`, one more than Task 2's 465/440: the single new key is
> `backToMine`, and the two reworded `backToPool` values are not new strings.
>
> **The state that decides the destination is one predicate, shared with the list's own membership rule.**
> `buildJudicialReferral` now publishes `isOnMyList`, and `isMyListState` in `libs/deed-poll/src/judicial/view.ts`
> is what both it and `myReferralStatus` ask — so the states api's personal list admits and the states whose detail
> page links back to it cannot drift apart. Two copies of `state === "Claimed" || state === "Decided"` is exactly
> how a judge ends up returned to a list their referral is not on, which is the bug this plan exists to fix
> arriving from the other direction.
>
> **The claim and direction flows needed no change, which is the point of deriving it from the state.** Both
> already redirect to the referral, and the referral re-reads it — so the link is resolved from the state api
> published a moment ago rather than from anything a handler assumed or a URL carried. There is no `returnTo` to
> add and none accepted: `[referralId].test.ts` posts `?returnTo=https://evil.example/` and `?return=…` at the page
> and asserts the pool still wins, so the open redirect decision 5 forbids fails a test rather than being an
> absence nothing pins.
>
> **The copy moved on three pages, not one, because a destination must have one name.** The pool link now reads
> "Back to referrals for a direction" on the referral view *and* on both renderings of the "no longer available"
> page (`[referralId].ts` and `[referralId]/direction.ts`), matching the shared navigation's own label for that
> list; My referrals reads "Back to My referrals", matching its. A refused read publishes no state, so those two
> pages keep the pool unconditionally — a guess at My referrals would be a link to a list the referral has left as
> well.
>
> **Two things Task 4 should know.** The one existing assertion on the old wording —
> `e2e-tests/tests/judicial.spec.ts`'s click on the unavailable page's link — is updated here, but **no E2E has
> been run**: this task's gate is lint and the unit suites, and Playwright's `name` matches the whole accessible
> name, so that line would have failed on the new copy. And the administrator-refusal test's list of judicial URLs
> does not include `${POOL_PATH}/mine`, so the gate's coverage of the page Task 2 added is currently pinned only by
> `src/app.test.ts`'s filesystem sweep.

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

- [x] Original feedback journey and terminal removal proven end to end; focused E2E green

> **DONE 2026-09-21.** `yarn lint` exits 0, `npx turbo test test:app --concurrency=1` is `8 successful, 8 total`
> across **166 test files, 3,087 tests** — Task 3's 166/3,086 plus **1**, the mock's lapse test — and
> `yarn welsh:check` is unchanged at **466 strings, 441 identical**, because this task adds no user-facing string.
>
> **E2E has actually been run, which it had not been since Task 2.** `judicial.spec.ts` is **6 passed**, the whole
> suite **39 passed**, and the judicial spec **9 passed** again under `--repeat-each=2`. The two copies of the new
> journey run concurrently as the *same* judge, which is the arrangement its paging lookup exists for. Task 3's
> updated "Back to referrals for a direction" wording is therefore verified against Playwright's whole-accessible-name
> matching rather than assumed, and so is the new page's.
>
> **How to run it from a worktree, since the plan's own note says `webServer` cannot**: `yarn mock:api`, then
> `yarn build:app:dev`, then `NODE_ENV=development ENVIRONMENT_NAME=development PERSONA_SWITCHER_ENABLED=true
> VITE_MIDDLEWARE=false npx tsx src/server.ts`, then `npx playwright test` from `e2e-tests/` — no `dev:up`, because
> the main checkout's `deed-poll-redis`/`deed-poll-idam` containers are already up and compose would collide on the
> names. `node scripts/seed-idam-users.mjs` is idempotent and safe against that shared simulator.
> `PERSONA_SWITCHER_ENABLED` is load-bearing here for the first time: without it the strip does not render and the
> journey cannot switch. **Both servers were stopped afterwards**, so Task 5 starts them itself rather than testing
> against a build that predates its own edits.
>
> **One journey and not six, and it signs itself in.** The six numbered steps are one referral's life, so they are
> one test per `.claude/rules/e2e-testing.md` — with `test.use({ storageState: undefined })`, because a persona
> switch calls `signIn` and regenerates the session id behind the restored cookie, which would sign the file's other
> journey out mid-run. That opt-out is **asserted** (`expect(await page.context().cookies()).toEqual([])`) rather
> than trusted: a context that had restored the judge session would still land on the pool from `/login`, so
> `signInAsJudge` would pass and the damage would surface as a timeout in a different file.
>
> **The persona switcher is the mechanism, and it is what makes step 3 worth running.** A second browser context
> holding the caseworker's cookie would have been cheaper and would have proven nothing: what decision 1 claims is
> that "mine" is api's answer about a token, so the discriminating arrangement is **one** session that becomes
> another identity and comes back. A list derived from session state, history or rows previously seen passes every
> unit test and fails exactly there.
>
> **The row is located through api's paging, like `poolRow`.** This list is keyed on the judge's own subject and the
> mock's store outlives the run (`reuseExistingServer`), so `judge@example.com` accumulates a decided referral from
> every run of the *other* journey — which never closes its own. Page 1 is therefore not where the row is, and
> `myReferralsPageOf` asks api the same question the UI's paging answers. The absence check after closure walks pages
> 1 to the one it was on, since a removal can only pull the rows behind it earlier.
>
> **The empty rendering is reached by a page past the end, and its sentence is deliberately not asserted.** A judge
> holding nothing cannot be arranged here for the reason above, and on page 99 "You have no referrals" is true of the
> page rather than of the judge — so this takes the axe check of the no-table branch and leaves the copy to
> `mine.njk.test.ts`. The same is true of the pool's own empty state, so it is not a new defect.
>
> **Welsh is not checked at runtime for this page, unlike the pool's.** `mine.ts`'s `cy` is `{ ...en }`, a literal
> spread, so the missing-key failure the pool's check exists to catch — a blank heading, with nothing failing — cannot
> be constructed, and `welsh:check` already counts all sixteen keys. A `?lng=cy` visit would assert that English
> equals English.
>
> **Two things fixed beside the journey.** The administrator-refusal loop now includes `/mine` and `?page=2`, which
> Task 3 flagged as covered only by `src/app.test.ts`'s filesystem sweep, and it asserts neither navigation label
> reaches a refused caseworker. And the first journey's "no other spec raises an urgent referral" comment was made
> true rather than left stale: what keeps an urgent row findable is that the band is ordered oldest-first, so a
> referral raised later — including this journey's — sorts *after* one already in it and cannot move it.
>
> **Withdrawal and lapse stayed at the mock/domain level, as the task asks, and only lapse was missing.** Task 1
> already pins withdrawal and closure removing a row and a refused write changing nothing, and `view.test.ts` already
> pins `Open`/`Withdrawn`/`Closed`/absent on both `buildMyReferralRows` and `isOnMyList`. The gap was api's
> inactivity sweep: it is a two-hour window on api's clock and the mock grows no timer for it, but its **result** is a
> state — an `Open` row still carrying the holder's name and subject — and that row is now seeded directly. It is off
> its old holder's list and back in the pool, and visible to another judge again. Keyed on `claimedById` instead of on
> the state, a lapsed claim would sit on its old holder's list for good: the same row on two lists, one of which
> cannot act on it.

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

- [x] Documentation current; full app, lint, Welsh and E2E validation green; final totals recorded

> **DONE 2026-09-21.** Documentation only — no behaviour changed, and the totals are Task 4's to the test:
> **166 test files, 3,087 tests, `8 successful, 8 total`**, `yarn lint` exit 0, `yarn welsh:check` **466 strings,
> 441 still identical** (exit 1, as this section says it must be), and `npx playwright test` **39 passed**, the whole
> suite including both judicial journeys. Against Task 0: **+2 test files, +96 tests, +20 Welsh strings** — the 20
> being this plan's own new keys and nothing else. The six Jenkins-owned scripts are all present and unchanged
> (`lint`, `test`, `test:coverage`, `test:a11y`, `test:smoke`, `test:functional`), asserted by `src/pipeline.test.ts`
> as well as read off `package.json` here.
>
> **What was actually stale, and it was never the API-client comments.** Task 1 had already moved those to "five
> judicial operations" as it added the fifth, and every page, service and mock docblock was written by the task that
> shipped it. What survived was **one count and one claim made in six places**: `libs/deed-poll/src/referrals/service.ts`
> still said the adapter carried "the four `/judicial/**` operations", and `CLAUDE.md`, `src/pages/index.ts`,
> `src/pages/index.test.ts`, `judicial.spec.ts` and admin-3's own gap note all said there was **no judicial
> navigation**. That is now false as written and true only as scoped: there *is* navigation, it is the two lists'
> own, and it renders only on pages inside `/judicial/**` — so the dual-role user's cost is unchanged and the reason
> for it is different. Each of the five now says the scoped version, because "no judicial navigation anywhere" is the
> sentence that would make the next reader build a second one.
>
> **`CLAUDE.md`'s "the pool is `Open` only" bullet was the one that would have caused work.** It ended "the missing
> query is api's… do not try to fix that here by re-listing or filtering client-side", which after admin-6 reads as
> an instruction to leave a shipped page unbuilt. It now names `GET /judicial/referrals/mine`, keeps the half of the
> prohibition that is still load-bearing (**membership is api's answer about the token** — no deriving "mine" from
> session, history or `claimedBy`, no filtering or re-sorting either list here), and points at `isMyListState` as the
> one predicate both the list and the detail page's back link ask, since two copies of that condition is how a judge
> gets returned to a list their referral is not on — the bug this plan exists to fix, arriving from the other
> direction.
>
> **Two additions rather than corrections.** Admin-3's "my decided referrals history view" gap is struck as shipped
> *in part*, with what was not shipped stated: `Withdrawn` and `Closed` are still on no judicial list and permanent
> history is still out of scope, so a reader does not take "delivered" for more than it was. And
> `docs/ARCHITECTURE.md`'s route-discovery section gained a fifth item for **precedence** — `sortRoutes` puts static
> segments ahead of parameterised ones, so a literal sibling of a `[param]` needs no registration order of its own —
> with decision 6's lesson attached: **test the dispatch, not the sort**, because an assertion about the sorted array
> passes on a router that then dispatches the other way.
>
> **E2E was run the way Task 4 documented and the note is worth keeping**: `yarn mock:api`, `yarn build:app:dev`,
> `NODE_ENV=development ENVIRONMENT_NAME=development PERSONA_SWITCHER_ENABLED=true VITE_MIDDLEWARE=false npx tsx
> src/server.ts`, then `npx playwright test` from `e2e-tests/` — no `dev:up`, against the main checkout's existing
> `deed-poll-redis`/`deed-poll-idam` containers. Port 3200 was free before starting and both servers were stopped
> afterwards.
>
> **This plan has not been moved to `docs/plans/completed/`.** Every completed plan lives there and this one should
> join them, but the two references to it that Task 5 updated (admin-4 and admin-5's out-of-scope lists) name it by
> its current path, and a move belongs with whatever lands the branch rather than inside it.

## Out of scope

- Permanent history of closed or withdrawn referrals.
- Judicial case search, filters or applicant information in list rows.
- A caller-selected owner/judge filter.
- Counts or badges outside the two judicial list pages.
- Changing the shared pool order, claim expiry or application state.
- Global navigation between judicial and caseworker personas.
