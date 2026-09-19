# Plan: referrals to the judiciary (admin 3 of 3) — the judicial screen

## Overview

**Third and last of the `deed-poll-admin` plans** in the referrals feature (three api, one producer add-on
api-2b, one idam, three admin — see `deed-poll-api/docs/plans/referrals-api-*.md`, the idam plan, and the
workspace memory `deed-poll-referrals-feature`). This one builds the **judicial persona screen**: the
simplified, role-gated area a judge uses to work the shared referral pool — see the pool, open a referral,
read the narrow application view and its notes, claim a referral, and record a direction through a GOV.UK
check-your-answers attestation. It is the UI over **api-3**'s `/judicial/**` surface, gated by **idam-1**'s
`caseworker-deedpoll-judicial` role, and it records directions through api-2's `decide` transition (exposed
by api-3).

This is the persona the whole feature was built to serve: today a judge receives a batch of ~10 referrals by
email and returns directions to a shared mailbox; this screen replaces that with an in-app shared pool a
judge pulls from and directs in place. It is deliberately **not** the caseworker surface — a judge is not a
caseworker (api-3 decision 13), and this plan's central risk is the same as api-3's: showing a judge a field
they must not see is a disclosure bug, not a UX one.

## What a judge does — the four things, mapped to api-3

1. **See the pool** — `GET /judicial/referrals`: the `Open` referrals awaiting a judge, urgent-first then
   oldest, paged ~10, plus the judge's own `Claimed`/`Decided` referrals (api-3 decision 3 visibility). This
   screen is the judge's home, the way `/deed-polls` is the caseworker's.
2. **Open a referral** — `GET /judicial/referrals/{referralId}`: the referral, a **narrow** application view
   (`JudicialCaseView`), and the case's notes — all read-only, 404 if not visible.
3. **Claim** — `POST /judicial/referrals/{referralId}/claim`: take a pool referral.
4. **Direct** — `POST /judicial/referrals/{referralId}/direction`: record `{decision, directionsText,
   publishToGazette}` after a check-your-answers attestation.

## The api-3 contract this screen consumes — pinned, do not re-derive

From `deed-poll-api/docs/plans/referrals-api-3-judicial-surface.md` and `-api-2-…-close.md`:

- **Four operations, a new `/judicial/**` namespace, four judicial DTOs** — `JudicialReferralSummary`
  (pool row: id, reasons, urgency, age/`createdOn`, state), `JudicialReferralDetail` (referral fields +
  `JudicialCaseView` + notes), `JudicialCaseView` (the narrow application projection), `JudicialDirectionRequest`
  (the write body). **These are NOT the caseworker DTOs** — api-3 decision 1 keeps them physically separate
  and an ArchUnit rule enforces it. This screen's wire types mirror that: new judicial schemas in `wire.ts`,
  never a reuse of `caseSummarySchema`/`caseDetailSchema`.
- **`JudicialDirectionRequest = { decision, directionsText, publishToGazette }`** where `decision` is the
  **existing `MasterDecision` enum (`Approved`/`Rejected`)** — api-2 decision 5 reuses it rather than minting
  a new one, so admin already has `MASTER_DECISION = ["Approved","Rejected"]` in `wire.ts` (Explore finding 5).
  `directionsText` is free text ("Directions, including any comment on Gazette publication"); `publishToGazette`
  is a **required** boolean the judge sets (api-2 decision 6 — the judge's call, never derived from the
  caseworker's reasons).
- **Visibility is "resolve then refuse"** (api-3 decision 3): a referral is visible iff `Open`, or
  `Claimed`/`Decided` by this judge. Anything else — withdrawn, closed, another judge's, or a non-existent
  id — is **404, indistinguishably**. This screen must render that 404 as "this referral is no longer
  available" and never leak that a referral exists but belongs to someone else.
- **409s and 400 surface unchanged**: claiming a non-`Open` referral (someone else took it) is a 409; directing
  one you no longer hold (it lapsed) is a 409; a malformed direction is a 400. The screen handles each as a
  user-facing message, not a stack trace.
- **No caseId in any judicial URL** (api-3 decision 2) — the screen is keyed on `referralId` throughout; a
  judge never names a case.

## The critical structural finding — admin has NO role-guard, and drops unknown roles

This plan is materially larger than admin-1/admin-2 in one respect, established by grounding the admin repo
(not assumed):

- **There is no `requireRole`/`requireAnyRole` middleware in `deed-poll-admin` today.** The only auth
  middleware is `requireAuth` (`src/auth/require-auth.ts`), which is authenticated-vs-anonymous only and never
  inspects roles. The estate's entire authorization philosophy is "api enforces; this app only hides controls"
  — role logic today is presentational button-hiding (`canDeleteWitness(user) => user.isAdmin`,
  `libs/deed-poll/src/witnesses/delete-policy.ts`), which explicitly defers real enforcement to api.
- **The `Role` type is a single literal, not a union** (`libs/deed-poll/src/auth/roles.ts` — `Role = typeof
  DEEDPOLL_ADMIN`), and **`KNOWN_ROLES = [DEEDPOLL_ADMIN]`** (`idam-claims.ts`). `userFromClaims` drops any
  role not in `KNOWN_ROLES` (`idam-claims.ts`). **So the judicial role idam-1 asserts is silently discarded
  from the session `CurrentUser` until added here.** This is the first thing to fix and the easiest to miss.
- **`isAdmin` is hardcoded** to `roles.includes(DEEDPOLL_ADMIN)` (`current-user.ts`); there is no generic
  `hasRole`/`can()` accessor.

The judicial screen must both (a) refuse a non-judicial user (not merely hide a button — a judge's area
showing to a caseworker, or vice versa, is the persona boundary) and (b) recognise the judicial role at all.
api enforces the data boundary regardless (api-3 gates every route on `JUDICIAL` in the domain), so an admin
who reached `/judicial/**` gets api 403s — but the *UI* must not present the caseworker the judicial chrome,
nor the judge the caseworker chrome. That means this plan introduces the role-recognition and role-gating this
repo has never had. **This is decision 1 below and it is the spine of the plan.**

## AMENDED 2026-09-18 — the spec, the adapter and the judicial mock are admin-0's

**admin-1's gate fired on 2026-09-18**: api had merged all four referral plans, and because
`contract.test.ts` asserts set equality in both directions, a refreshed document obliges the adapter to carry
the whole api — judicial operations included — in one commit. So the spec refresh, the four judicial client
functions, the four judicial schemas and the `/judicial/**` **mock routing** all moved into
**[`referrals-admin-0-spec-and-adapter.md`](referrals-admin-0-spec-and-adapter.md)**.

**What this plan still owns, and it is the majority of it:** the **auth layer** (the role the repo drops
today), the **role-gate middleware** the repo has never had, the **domain services**, every **page**, the
**attestation flow**, and the **persona routing**. Layers 2, 3, 6, 7 and 8 below are untouched by the
amendment.

**The preconditions are now: admin-0, admin-1 and admin-2 have landed, and idam-1's role exists.** The idam
dependency is unchanged and is still the one outside this repo — admin-0 deliberately does **not** depend on
it, because the adapter looks identical whether or not the role has been provisioned.

**One thing did not move, and must not be read as having moved.** The `JudicialCaseView` field-set check is
still this plan's loudest stop. admin-0 registers whatever schema api publishes — that is its job — so it is
**not** a filter on disclosure. If `JudicialCaseView` carries an admin-only field, the fix is in api-3, and
Task 0 here still stops for it. A schema being present in the adapter says nothing about it being *right*.

### The original hard block — superseded in part, kept for the reasoning

**This plan cannot be *run* until its upstreams are merged and the spec is refreshed, and its Task 0 is a
reconciliation gate that STOPS if not.** Same discipline and reason as `admin-1`, `admin-2`, `11-saved-queries-ui`
and `12-case-search-ui`: `libs/deed-poll-api-client/src/api/contract.test.ts` asserts the wire client equals
the published `openapi.json` bidirectionally on three axes (operation set via `IMPLEMENTED_OPERATIONS`,
schema-key set, per-schema properties + enum members). Adding the four judicial operations and their DTOs to
the client before the spec carries them turns that suite red.

**Running order** on the api side: api-1 → api-2 → api-2b → api-3, run and published. **idam-1** provisions the
`caseworker-deedpoll-judicial` role. On the admin side: admin-1 → admin-2 → **admin-3**, each rebased on the
last. The preconditions:

1. **api-3 has been run and merged in `deed-poll-api`, and its OpenAPI spec is published**, carrying the four
   `/judicial/**` operations and the four judicial schemas (`JudicialReferralSummary`, `JudicialReferralDetail`,
   `JudicialCaseView`, `JudicialDirectionRequest`). api-2 (the `decide` transition + `MasterDecision` reuse)
   and api-2b (`currentReferralState`) precede it.
2. **idam-1 has been run** and `caseworker-deedpoll-judicial` exists as an assignable role, so a judicial user
   can actually log in and be recognised. (idam-1 is IDAM config, not a spec change — its precondition is
   operational, not a contract refresh: confirm the role string matches api-3's gate,
   `caseworker-deedpoll-judicial`.)
3. **`libs/deed-poll-api-client/openapi.json` here has been refreshed** per `SPEC-PROVENANCE.md` (regenerate in
   the api clone with `./gradlew integration --tests "*OpenAPIPublisherTest*"` → `/tmp/openapi-specs.json`,
   reformat to 2-space JSON, update the provenance table, **diff property-by-property**).
4. **admin-1 and admin-2 are merged into this repo's `master`, and this plan is branched off that master.**
   Both refresh the same `openapi.json`; because the contract test asserts the *whole* operation and
   schema-key set, admin-3's refreshed spec is "api through api-3, idam through idam-1" and its only new delta
   over admin-2's committed spec is the judicial surface.

**The reconciliation gate (Task 0) is a real stop.** The only *new* delta admin-3's refreshed `openapi.json`
should carry over admin-2's committed one is **the four `/judicial/**` operations and the four judicial
schemas** — nothing else. If the delta shows a different judicial DTO shape than api-3 documented (e.g.
`JudicialDirectionRequest` missing `publishToGazette`, or `JudicialCaseView` carrying a payment/fee/privacy
field the flag below says it must not), or a `decision` enum that is not `MasterDecision`'s `Approved`/`Rejected`,
or an unexpected caseworker-surface change, then the upstream is not what this plan assumes: **stop and
report** — do not hand-edit the spec, do not code around it. In particular:

- **`JudicialCaseView` carrying any admin-only field (payment/fee reference, privacy editability, internal
  audit) is a STOP** — that is the disclosure bug api-3 flag 1 exists to prevent, and it must be fixed in api-3,
  not filtered in the client.
- **`decision` not being the `MasterDecision` enum is a STOP** — api-2 decision 5 reuses it; a new enum means
  the api drifted from its plan.

## The three layers this repo enforces

`.claude/rules/backend.md` fixes adapter → domain → pages, and the mock is the contract the in-process suite
runs against. This plan touches all layers plus the auth layer (the new role) and the routing/layout layers (a
new persona area):

**Layers 1, 4 and 5 are admin-0's — the spec, the adapter and the judicial mock routing. Layers 2, 3, 6, 7
and 8 are this plan's, and they are the bulk of it.** Do not edit `openapi.json`, `wire.ts`, `client.ts`,
`contract.test.ts` or the mock's `/judicial/**` routes here; a change needed in any of them is a finding about
admin-0.

1. ~~**Spec** — refresh `openapi.json` (precondition 3): four judicial operations, four judicial schemas.~~
   **admin-0.**
2. **Auth** — `libs/deed-poll/src/auth/`: add `caseworker-deedpoll-judicial` to the `Role` union
   (`roles.ts`) and to `KNOWN_ROLES` (`idam-claims.ts`) so the token's judicial role survives into the session
   `CurrentUser`; add a capability accessor (an `isJudicial` alongside the existing `isAdmin`, or a small
   `hasRole` — mirror `isAdmin`'s shape, `current-user.ts`). **Without the `KNOWN_ROLES` edit the whole screen
   is dead: the role never reaches the session.**
3. **Middleware** — `src/auth/`: a role-gate the repo lacks. A `requireRole(role)`/`requireJudicial`
   middleware (or a per-page guard mirroring `requireAuth`'s allowlist shape) that renders 403 (via
   `ForbiddenError` → `src/errors.ts`, which already maps 403) for a user without the role, mounted for the
   `/judicial/**` area. Keep the allowlist polarity `.claude/rules/backend.md` fixes — this gate is *additive*
   to `requireAuth`, applied after it, never a replacement.
4. **Adapter — admin-0.** `libs/deed-poll-api-client`: four new operations on `client.ts` (`listJudicialReferrals`,
   `getJudicialReferral`, `claimJudicialReferral`, `directJudicialReferral`) with `judicialReferralPath`
   helpers; four new zod schemas in `wire.ts` (`judicialReferralSummarySchema`, `judicialReferralDetailSchema`,
   `judicialCaseViewSchema`, `judicialDirectionRequestSchema`), registered in `WIRE_SCHEMAS`; the four ops in
   `IMPLEMENTED_OPERATIONS`. Follow the **saved-queries** shape (its own top-level fetches, not on the case
   payload) — the established template for a resource area that is not part of the case (Explore finding 8).
5. **Mock — admin-0.** `libs/deed-poll-api-client/src/mock/server.ts`: hand-rolled handlers for the four `/judicial/**`
   paths, enforcing the same rules as api — visibility (404 for a referral not visible to the mock's judge),
   the pool ordering (urgent-first then oldest), 409 on claiming a non-`Open` referral and on directing one not
   held, 400 on a bad direction. Seed the mock with a judge identity and a pool of referrals in mixed states so
   the suite exercises pool/claim/direct/visibility.
6. **Domain** — `libs/deed-poll/src/judicial/` (a new area, mirroring `saved-queries/`): thin service functions
   `listPool(caller, paging)`, `getReferral(referralId, caller)`, `claimReferral(referralId, caller)`,
   `recordDirection(referralId, direction, caller)`, each calling `callApi(caller, …)`. Validation (zod) for
   the direction form colocated here or at the page, following the repo's colocated-schema convention.
7. **Pages** — `src/pages/judicial/` (a new top-level area). File-based routing maps it: `judicial/referrals/index.ts`
   → `/judicial/referrals` (the pool), `judicial/referrals/[referralId].ts` → the referral view,
   `judicial/referrals/[referralId]/claim.ts`, `judicial/referrals/[referralId]/direction.ts` (the direction
   flow). Gated by the middleware (layer 3).
8. **Layout/nav** — the persona chrome question (decision 8): every page shares one `default.njk` + one
   `site-header.njk` today, and the caseworker nav ("New case", filter bar) is page-local to `/deed-polls`, not
   global (Explore finding 7). So a judge who only visits `/judicial/**` never sees caseworker controls — but
   this plan must ensure a judge is *sent* to `/judicial/referrals`, not `/deed-polls`, on login/`/`.

## Decisions — implement these, do not revisit

1. **The judicial screen is a role-gated top-level area (`/judicial/**`), and the gate is new middleware this
   repo does not yet have.** Because `deed-poll-admin` has no `requireRole` (only `requireAuth`, authenticated-
   or-not), this plan adds one: a `requireJudicial`/`requireRole('caseworker-deedpoll-judicial')` guard that
   renders 403 for a non-judicial authenticated user and is applied to the `/judicial/**` pages. api enforces
   the data boundary (api-3 gates every route on `JUDICIAL`); this gate is the *UI* boundary so a caseworker
   never sees judicial chrome and a judge never sees caseworker chrome. It is **additive** to `requireAuth` and
   does not touch the public allowlist's polarity. **Fixing `KNOWN_ROLES`/`Role` so the judicial role is
   recognised at all (layer 2) is a precondition of this gate meaning anything.**

2. **The pool is the judge's home; `/` and login route a judicial user there, not to `/deed-polls`.** A judge's
   landing page is `/judicial/referrals`, the way `/deed-polls` is the caseworker's. Where a caseworker's `/`
   302-redirects to `/deed-polls` (`src/pages/index.ts`), a judicial user's `/` redirects to
   `/judicial/referrals`. A user with both roles is a caseworker-first default (they have the richer surface);
   flag if the business wants otherwise. This keeps a judge off the caseworker dashboard entirely — the
   cleanest way to not show them caseworker controls, given nav is page-local (Explore finding 7).

3. **The pool renders api's order and paging; no local sorting or matching.** `listJudicialReferrals` returns
   the pool already ordered urgent-first then oldest and paged ~10 with a total (api-3 decision 5); the page
   renders that order and the total, and pages via the same query-string convention the case list uses (state
   in the URL, nothing in the session — Explore finding 4, repo norm). The screen never re-sorts, never filters
   locally, never decides urgency. Same rule the whole estate holds: api owns the query, the app renders the
   answer.

4. **The referral view shows only `JudicialCaseView` + the referral's own fields + read-only notes — whatever
   api-3 returns, rendered, nothing added.** The screen does not fetch the case by id (it cannot — no caseId in
   a judicial URL, api-3 decision 2), does not enrich the view with any other call, and does not render a field
   the DTO does not carry. If `JudicialCaseView` is narrow, the screen is narrow. This is the disclosure
   boundary made visual: the client cannot show what api does not send, and Task 0 STOPS if the DTO carries an
   admin-only field. Notes render read-only (no add-note control on this screen — a judge does not write notes,
   api-3 decision: writes are exactly claim + direct).

5. **Claim is a single POST from the referral view or the pool row; its 409 is "someone else took it".** A
   judge claims a pool referral with one action; the api re-checks `Open` and 409s if another judge claimed it
   first (api-3/api-2). The screen renders that 409 as a plain message ("This referral has already been claimed")
   and returns the judge to the pool — not a stack trace, not a generic error. A claim that succeeds lands the
   judge on the referral view, now theirs to direct.

6. **The direction is a multi-step flow ending in a GOV.UK check-your-answers attestation — built fresh,
   because the repo has neither a CYA-before-submit pattern nor a session wizard.** The flow is: referral view
   → direction form (a `govukRadios` decision Approved/Rejected, a `govukTextarea` for directions text, a
   required choice for `publishToGazette`) → **check-your-answers** (a `govukSummaryList` of the entered
   direction with an "I confirm this is my direction" attestation) → POST to `recordDirection`. There is no
   existing CYA/review page to copy (the code says so — `src/pages/deed-polls/queries/[queryId]/delete.ts`
   docblock); the nearest structural template is the delete-confirmation page (single-purpose POST guarded by
   an `action` literal, cancel-as-link) and the witness form for the `govukRadios`+`govukTextarea`+
   `govukErrorSummary` shape (`src/pages/deed-polls/witness-form.njk`). Validation is **zod, colocated**, with
   `zodErrorToFieldErrors` feeding a field-keyed `errors` object and an ordered `errorList` for the summary —
   the exact pattern `witnesses/new.ts` uses. `publishToGazette` and `decision` are radios that must **not**
   default: compare to string literals so no-selection stays `undefined` and the schema rejects it (the
   witness boolean-radio pattern, `witnesses/new.ts`).

7. **The direction flow carries its state through the request the repo's way — URL/hidden fields, not the
   session — unless a compelling reason forces the session.** The repo's norm is "everything travels through
   the URL, nothing held in the session" (`src/pages/deed-polls/index.ts` docblock; `queries/new.ts` rejects
   hidden inputs as a second copy of state), and the session is auth-only today (Explore finding 4). The
   check-your-answers step re-renders the direction from the form values posted to it (hidden fields on the CYA
   form, or the form re-POSTing to itself), and the final confirm POSTs the complete direction to
   `recordDirection` in one atomic call — matching api-2 decision 7 ("a direction is a single transition, not a
   draft-then-submit; api does not model a draft"). **No draft is persisted anywhere** — client or server — so
   an abandoned direction leaves nothing behind. If a reviewer prefers a session-backed wizard, that is
   supported (the `deedPoll` namespace is extensible) but unprecedented; the request-carried approach is the
   repo norm and the recommendation.

8. **Judicial screens inherit the shared `default.njk` chrome; the persona separation is by *routing*, not a
   new layout.** There is one layout and one header for all pages, and no `govukServiceNavigation` is rendered
   (Explore finding 7); the caseworker nav is page-local to `/deed-polls`. So a judge, kept to `/judicial/**`
   by decision 1's gate and decision 2's landing redirect, simply never encounters caseworker controls — no
   layout swap needed. This plan does **not** build a bespoke judicial layout or service-navigation (YAGNI —
   there is no nav to diverge from). If the business later wants distinct judicial branding/nav, that is
   additive and out of scope. The judicial pages use the standard GOV.UK header/phase-banner/footer.

9. **The direction's `decision` reuses `MasterDecision` (`Approved`/`Rejected`) — the enum admin already
   has.** api-2 decision 5 reuses `MasterDecision` rather than minting a judicial-specific enum, and admin
   already carries `MASTER_DECISION = ["Approved","Rejected"]` in `wire.ts` (Explore finding 5). The direction
   form's radios are labelled from that enum; the judicial direction schema references it. Do **not** introduce
   a parallel decision enum — reconcile against the existing one (Task 0 STOPS if the spec's `decision` is not
   `MasterDecision`). Note the app also has *case-level* `masterDecision`/`referToMasterChoice`/
   `publishToLondonGazette` fields on the case payload (Explore finding 5/6) — those are the pre-migration
   snapshot (api-2 decision 10, leave-as-is); the **live** judicial direction is on the referral, fetched
   through `/judicial/**`, and must not be confused with or written back onto the case fields.

10. **Every judicial 404 reads as "no longer available", never "belongs to someone else".** api-3's visibility
    is "resolve then refuse" — an invisible referral (withdrawn, closed, another judge's, or non-existent) is a
    404 indistinguishably. The screen must honour that in its copy: a 404 from any judicial read is rendered as
    "This referral is no longer available" (or equivalent), returning the judge to the pool — it must never say
    or imply another judge holds it. This is the client half of api-3's non-enumeration guarantee.

11. **Welsh throughout, from `locales/`.** Every judge-facing string — pool headings, the direction form
    labels, the attestation copy, the 404/409 messages — lives in the `en`/`cy` locale files like every other
    string, following the existing pattern. The judicial persona is not exempt from bilingual delivery.

## Open questions — flagged, NOT answered here

- **api-3 flag 1 — the judicial application view's field set — is RESOLVED (Steve, 2026-09-17).** api-3
  implemented a defensible *minimum* (`JudicialCaseView`: reference, application type, old/new names, the
  referral's reasons/notes/urgency) and excluded payment/fee references, internal audit trails, and
  admin-only privacy fields, pending a legal/policy call ("what must a judge see to make a lawful direction,
  and what must they not see?"). **Steve has confirmed this exact set is correct.** This screen renders
  exactly what `JudicialCaseView` carries (decision 4), so the field set is owned upstream in api-3 and this
  screen inherits the confirmed set — no longer provisional. Task 0 still STOPS if the DTO carries an
  admin-only field it should not (that would mean api-3 drifted from the confirmed set), but the human
  question this flag raised is now answered.
- **The exact attestation wording** (decision 6 — "I confirm this is my direction") and the direction form
  labels — working text; a judicial-facing wording/Welsh pass can revise. Display-only.
- **Dual-role users** (decision 2 — a user with both caseworker and judicial roles) — defaulted to
  caseworker-first landing; confirm the business has no such user, or wants a chooser. Flagged.
- **A judge's "my decided referrals" history view** — api-3's visibility already permits a judge to read their
  own `Decided` referrals, so the data is reachable, but a dedicated history list is additive and not asked for
  (api-3 "deliberately not in this plan"). Out of scope here.
- **A session-backed direction wizard** vs the request-carried approach (decision 7) — recommended
  request-carried (repo norm); flagged in case a reviewer prefers session.

## Constraints

Same as admin-1/admin-2 (three-layer adapter→domain→pages, `.claude/rules/backend.md`; ES modules, no `any`,
Biome; colocated `*.test.ts`; **test command is `turbo test test:app --concurrency=1`, NOT bare `yarn test`** —
a bare `yarn test` false-reds with "0 successful, 8 total"; the mock drives the suite in process). Additional
to this plan:

- **The role must be recognised before anything else works.** Adding `caseworker-deedpoll-judicial` to
  `Role`/`KNOWN_ROLES` (layer 2) is the first code change; without it the token's judicial role is dropped by
  `userFromClaims` and the gate has nothing to gate on. A test must assert a judicial token yields a
  `CurrentUser` whose roles include the judicial role (mirror the admin-role claim test).
- **The gate must both admit a judge and refuse a caseworker.** Test the new middleware in both directions
  (mirror the `require-auth` tests): a judicial user reaches `/judicial/referrals`; an authenticated
  caseworker (no judicial role) gets 403; an unauthenticated user is handled by `requireAuth` as before.
- **The mock is the contract the suite runs against.** The pool/claim/direct/visibility flows are only testable
  in-process if the mock implements them — including the 404-on-invisible and the 409s. Seeding a judge
  identity and a mixed-state pool is part of this plan (layer 5); a test asserting "the pool shows N" or "an
  invisible referral 404s" is meaningless if the mock returns everything to everyone.
- **`contract.test.ts` must be green after the spec refresh + wire edits** — the four judicial schemas must
  match the refreshed spec's schemas key-for-key and enum-for-enum (`decision` = `MasterDecision`), and the
  four operations must be in `IMPLEMENTED_OPERATIONS`. Run it as the first check after Task 1.
- **A worker/`vitest` startup timeout is an environment failure, not a code failure** — re-run before
  investigating.
- **No caseId anywhere in this screen's URLs or calls** (api-3 decision 2) — the screen is referral-keyed
  throughout; a judge never names a case. A test/grep that no judicial page or call constructs a case-scoped
  path.

## Validation Commands

**These run after every task, so everything here must be green after every task — not only at the end.**

```bash
yarn turbo test test:app --concurrency=1
yarn lint
```

(Never bare `yarn test`, which reports a false failure here — [[deed-poll-admin-yarn-test-false-red]].)

**Corrected 2026-09-19: the `yarn` prefix is required and was missing.** `turbo` is not on PATH in this
devcontainer — only at `node_modules/.bin/turbo`, which `yarn` puts on PATH and a bare shell does not. Without
it this block starts **red with `command not found`**, which is not a signal about the code at all. See the
same correction in `referrals-admin-2`.

## Tasks

### Task 0: Verify the judicial contract and the IDAM role — STOP if either is wrong

**Amended 2026-09-18. This task used to refresh the spec; admin-0 does that now.** What remains is a
verification, and it is the most important gate in the referrals feature: **the field-set check is a
disclosure check, and admin-0 does not perform it.** admin-0 registers whatever api publishes, so the
adapter carrying `JudicialCaseView` proves only that api published it — not that it is safe.

Change nothing here. Read the *committed* `openapi.json` (no refresh) and confirm:

- The four `/judicial/**` operations
  (`GET /judicial/referrals`, `GET /judicial/referrals/{referralId}`,
  `POST /judicial/referrals/{referralId}/claim`, `POST /judicial/referrals/{referralId}/direction`) and the
  four judicial schemas (`JudicialReferralSummary`, `JudicialReferralDetail`, `JudicialCaseView`,
  `JudicialDirectionRequest`). `JudicialDirectionRequest` carries exactly `decision`
  (`Approved`/`Rejected`), `directionsText`, `publishToGazette`. `JudicialCaseView` carries **no**
  payment/fee reference, no privacy-editability field, no internal audit field.

  **Amended 2026-09-19: do not look for a `MasterDecision` *schema*.** There is no such component and there is
  no bug — **springdoc inlines every enum**, so the spec has 27 named schemas and **zero** named enum schemas.
  The case's own `masterDecision` is inlined identically. What api-2 decision 5 actually requires is the same
  *members*, and the adapter already expresses the reuse: `judicialDirectionSchema.decision` is
  `z.enum(MASTER_DECISION)` (`wire.ts:680`). So check the members, not a `$ref`.

  **Also amended: the spec carries six judicial schemas, not four** — `JudicialCaseNote` and
  `JudicialPoolResponse` in addition to the four named above. Both are supporting DTOs (a note projection and
  a paging envelope) and neither changes the shape of the four. Not a stop.
- **The IDAM role: check the string, not its provisioning.** `idam-access-config#995` is **open as at
  2026-09-19**, so the role is not yet assignable in a real environment — and that does **not** block this
  plan. Verified: `#995` declares `name: caseworker-deedpoll-judicial` and api's gate is
  `JUDICIAL("caseworker-deedpoll-judicial")` (`domain/auth/Role.java:40` on api master) — **an exact match, so
  the one risk this gate exists to catch is retired.** Local build and e2e do not touch `idam-access-config` at
  all: `scripts/seed-idam-users.mjs` seeds the `rse-idam-simulator` directly, so add the judicial test user
  there (importing the role constant, never restating it — that script's own comment records a copied string
  drifting once). `#995` gates a judge signing in to **AAT**, which is downstream of this plan.
- **admin-0, admin-1 and admin-2 have all landed**, and both validation commands are green with the totals
  recorded as this plan's baseline.
- If anything is otherwise — a different judicial DTO shape, `decision` carrying members other than
  `Approved`/`Rejected`, `JudicialCaseView` carrying an admin-only field, a missing `publishToGazette`, or the
  judicial ops absent — **STOP and report** which, and how reality differs. Do not hand-edit the spec, do
  not filter a leaked field in the client (that is an api-3 fix), do not guess. **`JudicialCaseView` with an
  admin field is the disclosure bug api-3 flag 1 exists to prevent — the loudest STOP, and the one thing here
  that admin-0 landing cleanly does *not* rule out.**

**PRE-FLIGHT DONE 2026-09-19, by hand, before this plan was run. Every condition below was checked and the
gate passes — re-check rather than trust, but do not spend a task rediscovering it:**

| Condition | Result |
|---|---|
| Four `/judicial/**` ops in the committed `openapi.json` | ✅ all four |
| Judicial schemas | ✅ **six** (the four, plus `JudicialCaseNote` and `JudicialPoolResponse`) |
| `JudicialDirectionRequest` shape | ✅ `decision` enum `[Approved,Rejected]`, `directionsText`, `publishToGazette`; `required: [decision, publishToGazette]` |
| **`JudicialCaseView` disclosure check** | ✅ **PASSES** — `displayReference`, `new{Forename,MiddleName,Surname}`, `old{Forename,MiddleName,Surname}`, `type`. No fee, no payment, no privacy-editability, no audit field |
| `decision` reuses the existing decision enum | ✅ in substance — `z.enum(MASTER_DECISION)` at `wire.ts:680`. There is no `MasterDecision` schema to reference; see the amendment above |
| IDAM role string | ✅ `#995` = `caseworker-deedpoll-judicial` = api's `Role.java:40`. PR **open**, which does not block this plan |
| admin-0 / admin-1 / admin-2 landed | ✅ `#112`, `#114`, `#115` — master at `a39a6d4` |
| Baseline | ✅ **2,245 tests**, 8/8 turbo tasks; `yarn lint` 0 errors, 2 warnings + 2 infos |

**RE-VERIFIED 2026-09-19 when the task ran**, every row above independently and against the committed
`openapi.json` — nothing hand-edited, nothing filtered. The judicial `$ref` graph is worth recording because
the four-vs-six question above only half-answers it: `JudicialReferralDetail` *extends* the summary and `$ref`s
`JudicialCaseView` (as `application`) and `JudicialCaseNote[]` (as `caseNotes`), and `JudicialPoolResponse`
wraps `JudicialReferralSummary[]` with `page`/`size`/`total`/`totalPages`. So the pool page reads its total off
the envelope rather than counting rows, and the referral view's three panels are one payload — decision 4 with
no second call available even in principle. The disclosure check re-ran against the live document, not the
table: `JudicialCaseView` is exactly `displayReference`, `new{Forename,MiddleName,Surname}`,
`old{Forename,MiddleName,Surname}`, `type`. Baseline reproduced to the test: 844 + 736 + 327 + 140 + 127 + 41
+ 23 + 7 = **2,245**.

One thing the table's ✅ does not say and the pages will need: **`JudicialDirectionRequest.required` is
`[decision, publishToGazette]` and `directionsText` is NOT required** ("an approval that needs no comment is a
real answer"), with `maxLength: 4000`. Decision 6 lists all three as form fields, which is right, but the
colocated zod schema in Task 4 must make the textarea **optional** and cap it at 4000 — a required-textarea
validation here would refuse a direction api accepts.

- [x] Verified (or re-verified) against the committed `openapi.json`: the judicial ops and schemas present with
      the shapes above; `decision`'s members are `Approved`/`Rejected`; **`JudicialCaseView` carries no
      admin-only field**; the role string matches api's gate; admin-0/1/2 all landed; both validation commands
      green with baseline totals recorded — or STOPPED and reported, with no spec edits and no client
      field-filtering

### Task 1: Auth — recognise and gate the judicial role

`libs/deed-poll/src/auth/`: add `caseworker-deedpoll-judicial` to the `Role` union (`roles.ts`) and to
`KNOWN_ROLES` (`idam-claims.ts`) so `userFromClaims` keeps it; add an `isJudicial` capability accessor on
`CurrentUser` mirroring `isAdmin` (`current-user.ts`). Add the role-gate middleware `requireJudicial`/
`requireRole` in `src/auth/` (mirror `require-auth`'s shape; render 403 via `ForbiddenError` → `src/errors.ts`
for an authenticated non-judicial user), applied to `/judicial/**` — additive to `requireAuth`, allowlist
polarity untouched.

**Amended 2026-09-19: the adapter clause is already done — verify it, do not build it.** This task used to say
"add the four judicial operations to `client.ts` and the four schemas to `wire.ts`", which contradicts this
plan's own AMENDED section: admin-0 owns the adapter and has landed. Confirmed by hand at `a39a6d4` — four
client functions (`getJudicialPool`, `getJudicialReferral`, `claimJudicialReferral`, `directJudicialReferral`,
`client.ts:466-505`), six judicial schemas in `WIRE_SCHEMAS` (`wire.ts:722-727`), four judicial ops in
`IMPLEMENTED_OPERATIONS` (**which lives in `contract.test.ts:35`, not `client.ts`**), and `/judicial/**` mock
routing. So **this task is auth only**; adding any of it again is duplicate work, and editing `wire.ts` risks
turning `contract.test.ts`'s two-way set equality red for no gain.

**Also amended: add the judicial test user to `scripts/seed-idam-users.mjs`**, importing the new role constant
rather than restating the string — the script's own comment records a copied string drifting once and every
e2e admin journey silently signing in unprivileged as a result. This is what makes Task 5's e2e possible without
`idam-access-config#995`.

- [x] Judicial role in `Role` + `KNOWN_ROLES`; a judicial token yields a `CurrentUser` with the role (tested);
      `isJudicial` accessor added; `requireJudicial` admits a judge and 403s an authenticated caseworker
      (tested both directions); judicial test user seeded from the imported constant; adapter coverage
      **verified unchanged** rather than re-added; `contract.test.ts` green;
      `yarn turbo test test:app --concurrency=1` green

**DONE 2026-09-19.** `DEEDPOLL_JUDICIAL` in `roles.ts` widens `Role` to a union for the first time; it is in
`KNOWN_ROLES`, and `currentUser` now sets `isJudicial` beside `isAdmin` — **as an alternative, not a level**,
which is asserted in both directions (an admin is not judicial, a judge is not an admin). `requireRole(role)` /
`requireJudicial()` is new in `src/auth/require-role.ts`, refusing by `next(new ForbiddenError(...))` so the
403 goes through the single mapping in `src/errors.ts` — whose "this is unreachable today" comment was true
until this commit and has been corrected rather than left to mislead.

Two things the checkbox did not ask for and the next task needs:

- **The mount is pinned, not just the middleware.** `app.use("/judicial", requireJudicial())` sits after
  `requireAuth`, and `src/app.test.ts` now asserts all three of: that it is mounted, that its layer matches
  `/judicial/**` and *not* `/deed-polls`, and that it is mounted **after** `requireAuth`. An unmounted gate
  leaves every judicial page open to any signed-in caseworker and the pages look identical either way, since
  they never ask about the role; a gate mounted *before* `requireAuth` would 403 an anonymous visitor instead
  of sending them to log in. Neither failure shows up in running the app.
- **`pageRequest({ judicial: true })`** in `src/express-doubles.ts`, independent of `admin`, so Task 3/4's page
  tests can express the persona without knowing the session shape.

Verified unchanged, as the amendment requires: `git status` shows no edit to `openapi.json`, `wire.ts`,
`client.ts`, `contract.test.ts` or the mock. Totals **2,261 tests** (up 16 from the 2,245 baseline: +12 app,
+4 `libs/deed-poll`), 8/8 turbo tasks; `yarn lint` 0 errors, 2 warnings + 2 infos — baseline exactly. The root
`tsconfig.json` project carries 49 pre-existing type errors in unrelated test files; confirmed against a
stash that this task adds none.

### Task 2: Domain — the judicial services over admin-0's adapter

**Amended 2026-09-18: the mock is admin-0's. This task is the domain layer only.** First *verify* what
admin-0 built, because every page above depends on it behaving like api: the mock must enforce visibility
(404 for a referral not visible to the mock's judge, indistinguishable from non-existent), pool ordering
(urgent-first then oldest) + total, 409 on claiming a non-`Open` referral and on directing one not held, and
400 on a bad direction, with a judge identity and a mixed-state pool seeded
(Open/Claimed-by-me/Claimed-by-other/Decided/Withdrawn/Closed). **If any of those is missing, stop and report
it as an admin-0 gap** — do not add it here, because a rule implemented twice in two plans is a rule that will
diverge. The original text follows, as the specification of what to check.

~~`libs/deed-poll-api-client/src/mock/server.ts`: handlers for the four `/judicial/**` paths enforcing api's
rules — visibility (404 for a referral not visible to the mock's judge, indistinguishable from non-existent),
pool ordering (urgent-first then oldest) + total, 409 on claiming a non-`Open` referral and on directing one
not held, 400 on a bad direction. Seed a judge identity and a mixed-state pool (Open/Claimed-by-me/
Claimed-by-other/Decided/Withdrawn/Closed).~~ **admin-0 — verify, do not build.** `libs/deed-poll/src/judicial/` (new area, mirroring
`saved-queries/`): `listPool`, `getReferral`, `claimReferral`, `recordDirection`, each `callApi(caller, …)`;
the direction zod schema (decision + `directionsText` + required `publishToGazette`), colocated. Export the
services from `libs/deed-poll/src/index.ts` (services only, never `callApi`/`ApiConfig`). Unit-test each
against the mock, including the 404/409/400 paths and visibility.

- [x] admin-0's mock **verified** to implement pool (ordered, total), read (404-on-invisible), claim
      (409-on-taken), direct (409-on-not-held, 400-on-bad) with a judge and mixed-state pool seeded — or the
      gap reported rather than filled here; domain services thin over `callApi`, exported service-only;
      direction schema rejects missing `decision`/`publishToGazette`; unit tests cover happy + 404/409/400 +
      visibility; `turbo test test:app --concurrency=1` green

**DONE 2026-09-19.** The mock verification passes on every clause, so nothing was filled in here:
`judicialPool` filters to `Open`, sorts by `poolOrder` (urgent-first by *position in `URGENCY`*, then oldest)
and publishes `page`/`size`/`total`/`totalPages`; `judicialReferral` runs `visibleToJudge` before anything else
and 404s otherwise; claim 409s on any non-`Open` state including the judge's own claim; direction 400s on the
wire schema and 409s when visible-but-not-held. The judge identity is the token's `sub` via `auditName`, and the
mixed-state pool is arranged per test (`mock.seed` with chosen `createdOn`, plus `referredCase`/
`claimedReferral`/`decidedReferral`) rather than baked into a global seed — which is what lets one test pin an
order three same-millisecond creates could not. Adapter-level coverage of all of it already exists in
`client.test.ts:853-990` and `server.test.ts:1080-1249`.

**One api behaviour the plan's prose does not state, and both Task 3 and Task 4 need it.** Directing a referral
is a **404, not a 409, when another judge now holds it** — visibility is checked before the hold, so "taken out
from under me" and "never existed" stay indistinguishable; the 409 is only for a referral the judge *can* see
but does not hold (still `Open`, or already `Decided` by them). So the direction page needs both branches and
they say different things: the 409 is "this referral is no longer yours to direct" beside the control, the 404
is decision 10's "no longer available". Reading the 409 as the only lapse case would render a 404 page for the
commonest lapse there is.

Two deviations from the task text, both deliberate:

- **`listPool(paging, caller)`, not `listPool(caller, paging)`.** Every service in this repo takes the caller
  last — `findDeedPolls(query, caller)`, `findReferrals(deedPollId, caller)` — and one function inverting it is
  a trap at the call site that no test would catch, because both parameters are objects.
- **The domain tests mock the adapter; they do not drive the mock.** `.claude/rules/backend.md` states nothing
  above the adapter imports the mock, and `.claude/rules/testing.md` makes the adapter the seam at this layer.
  The mock-driven 404/409/400/visibility coverage the task asks for is real and was verified — it lives one
  layer down, where the mock *is* the contract, and duplicating it here would assert the mock twice and the
  error mapping nowhere.

`getReferral` is exported under the plan's name, which reads bare next to the caseworker `findReferral` on the
flat index; the docblock says which surface it belongs to and that it takes no case id. Totals **2,288 tests**
(up 27: all in `libs/deed-poll`), 8/8 turbo tasks; `yarn lint` 0 errors, 2 warnings + 2 infos — baseline
exactly. `tsc -p libs/deed-poll/tsconfig.json` clean, which is what pins `DirectionInput` as assignable to the
adapter's `JudicialDirection` rather than a parallel restatement of it.

### Task 3: Pages — the pool, the referral view, claim

`src/pages/judicial/referrals/index.ts` → `/judicial/referrals`: call `listPool(caller, paging)`, render the
pool (api's order + total, paged the URL way — decision 3) with a link per row to the referral; gated by
`requireJudicial`. `src/pages/judicial/referrals/[referralId].ts`: call `getReferral`, render the
`JudicialCaseView` + referral fields + read-only notes (decision 4, nothing added), 404 rendered as "no longer
available" (decision 10); a claim control if the referral is `Open`, a "direct" control if the judge holds it.
`src/pages/judicial/referrals/[referralId]/claim.ts` (POST): `claimReferral`, 409 → "already claimed" back to
the pool (decision 5), success → the referral view. Route `/` and login for a judicial user to
`/judicial/referrals` (decision 2). Welsh from `locales/` (decision 11). Page tests: pool renders order+total;
referral view shows only the DTO fields and read-only notes; invisible referral → "no longer available"; claim
success and 409; a caseworker is 403'd from every judicial page.

- [x] Pool page renders api's order + total, gated `requireJudicial`; referral view shows `JudicialCaseView` +
      referral + read-only notes and nothing more, 404 as "no longer available"; claim POST works and renders
      409 as "already claimed"; judicial user lands on `/judicial/referrals` from `/`/login; caseworker 403'd
      on every judicial page (tested); Welsh present; `turbo test test:app --concurrency=1` green

**DONE 2026-09-19.** Three pages and three templates under `src/pages/judicial/referrals/`, and the router
discovers exactly `get /judicial/referrals`, `get /judicial/referrals/:referralId` and
`post /judicial/referrals/:referralId/claim` — verified against a real `createSimpleRouter` over `src/pages`,
because every one of them is gated by *where it lives* and a page the router did not find would be untested
rather than failing.

Four things the checkbox did not ask for, and the next task needs each of them:

- **The landing redirect could not be done at `/` alone, and the fix is in `login.ts`.** Decision 2 reads as one
  page's change, but `/` is on `requireAuth`'s allowlist, so an anonymous judge was redirected to `/deed-polls`
  *before* anyone knew who was arriving — which pinned the caseworker's list as the `returnTo` and landed them on
  a list api answers 403 to. So `/` now sends an anonymous visitor to `/login?returnTo=%2F` and resolves the
  persona on the way back, and `safeReturnTo`'s fallback moved from `/deed-polls` to `/` for the same reason:
  which home is right depends on roles that do not exist until the token comes back. This costs the hop the old
  docblock avoided deliberately; the docblocks on both files now say so rather than leaving the next reader to
  rediscover the trade.
- **Claiming has two refusals and they say different things.** api checks visibility before the hold, so a
  referral taken out from under this judge is a **404**, not a 409 — the finding Task 2 recorded, now rendered:
  `?claim=taken` is "already claimed", `?claim=unavailable` is decision 10's "no longer available", and neither
  sentence mentions another judge. Reading the 409 as the only lapse case would have rendered the commonest one
  as a fault.
- **"A caseworker is 403'd on every judicial page" is pinned in `src/app.test.ts`, derived from the filesystem.**
  No page test can show it — the pages never ask about the role — and a hand-written list of URLs goes stale the
  moment a page is added, which is the failure that matters since an ungated judicial page looks identical to a
  gated one. The test reads `src/pages/judicial` recursively, maps each file to its route the way `simple-router`
  does, and asserts the mounted gate matches all of them; `require-role.test.ts` still owns the both-directions
  behaviour.
- **The view models are `libs/deed-poll/src/judicial/view.ts`, not the pages.** The task text says "pages", but a
  template cannot format a timestamp here and the disclosure question has to be answerable in one place: the pool
  row and the referral view are two renderings of the same referral, and a field that must not be shown is the one
  added to one of them and missed on the other. `referralReasonLabel` is now exported from
  `referrals/referrals-view.ts` and shared, because the caseworker picks the reasons and the judge reads them —
  two wordings would have the two personas discussing different lists.

The direction control links to `/judicial/referrals/:referralId/direction`, which **Task 4 builds** — it 404s
until then, deliberately rather than by omission: hiding it would have meant a second state rule to remove.

Totals **2,375 tests** (up 87 from Task 2's 2,288: +63 app, +24 `libs/deed-poll`), 8/8 turbo tasks; `yarn lint`
0 errors, 2 warnings + 2 infos — baseline exactly. `tsc -p tsconfig.app.json` and `tsc -p
libs/deed-poll/tsconfig.json` are both clean; the root project's pre-existing errors are **44 before and 44
after**, measured against a stash rather than against the 49 recorded in Task 1. One fixture lesson worth
keeping: `wireDateTime` decodes to a `Date`, so a test that passes an ISO **string** for `createdOn`/`claimedAt`/
`decisionDate` type-checks only in the outer cast and fails at every override site.

### Task 4: Pages — the direction flow with check-your-answers attestation

`src/pages/judicial/referrals/[referralId]/direction.ts`: the multi-step direction flow (decision 6/7),
built fresh (no CYA precedent — mirror the delete-confirmation shape and the witness form). GET renders the
direction form: `govukRadios` for `decision` (Approved/Rejected from `MasterDecision` — decision 9),
`govukTextarea` for `directionsText`, a required choice for `publishToGazette` (radios that do not default —
decision 6), `govukErrorSummary` + field errors from `zodErrorToFieldErrors`. On valid submit, render the
**check-your-answers** step: a `govukSummaryList` of the entered direction + an "I confirm this is my
direction" attestation, state carried through the request (hidden fields / re-POST — decision 7, no draft
persisted). The confirm POST calls `recordDirection`, surfacing api's 409 (referral no longer held — lapsed)
and 400 (bad direction) as user messages (decision 5/10); success returns the judge to the referral (now
`Decided`) or the pool. Welsh throughout. Page tests: validation errors re-render with values; CYA shows the
entered direction; confirm records it; a lapsed-referral 409 is handled; radios do not default.

- [ ] Direction form validates (zod, no-default radios) and re-renders errors with values; CYA step shows the
      entered direction + attestation, state request-carried with no persisted draft; confirm POSTs one atomic
      `recordDirection`; 409 (lapsed/not-held) and 400 (bad direction) rendered as messages; success →
      `Decided`; Welsh present; `turbo test test:app --concurrency=1` green

### Task 5: E2E and full validation

A Playwright journey (`e2e-tests/tests/`, mirror an existing spec): a judicial user logs in, lands on the
pool, opens a referral, reads the application view + notes, claims it, fills the direction form, confirms at
check-your-answers, and sees the referral recorded — and a caseworker is refused the judicial area. Happy path
+ the caseworker-refused assertion.

- [ ] E2E: judge → pool → open → claim → direction form → CYA confirm → recorded; caseworker refused
      `/judicial/**`; `turbo test test:app --concurrency=1` and `yarn lint` green; the six pipeline scripts
      still present (do not delete `lint`/`test`/`test:coverage`/`test:a11y`/`test:smoke`/`test:functional`);
      a11y check on the new pages (pool, referral view, direction form, CYA) passes

## Deliberately not in this plan

- **api-3 / api-2 / api-2b / idam-1 themselves** — the judicial HTTP surface, the state machine, the
  denormalised state column, and the IDAM role. This plan consumes all four; it builds none of them.
- **The caseworker "returned — action needed" count** — admin-2. This plan is judicial-facing only.
- **A bespoke judicial layout / service-navigation** (decision 8) — the shared chrome + routing separation is
  the whole of the persona split; distinct judicial branding is additive and out of scope.
- **A judge's "my decided referrals" history list** — api-3's visibility already reaches the data; a dedicated
  history view is additive and not asked for.
- **A session-backed direction wizard** (decision 7) — request-carried is the repo norm and the choice; a
  session wizard is supported but unprecedented and not built here.
- **Any change to how a referral reaches or leaves a judicial state** — that is api-2's state machine and
  api-3's exposure; this plan only reads the pool, claims, and directs through them.
