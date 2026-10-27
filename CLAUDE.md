# deed-poll-admin AI Development Guide

**One application, at the repository root.** `src/` *is* the app — there is no `apps/` directory and no
application workspace. `libs/` is still a Yarn workspace of seven packages, so this is a monorepo in the
library sense only. See "Project Structure" below, and `docs/plans/03-collapse-to-single-app.md` for why the
four-app shape went.

## Core Development Commands

```bash
# Development
yarn dev                        # Start all services concurrently

# Testing
yarn test                       # Run all tests across workspaces
yarn test:e2e                   # Playwright E2E tests
yarn test:coverage              # Generate coverage report

# Code Quality
yarn lint:fix                    # Run Biome linter
yarn format                     # Format code with Biome

# deed-poll-api
yarn seed:cases                 # Preview/apply 30 representative cases through the real API; non-production only
                                # See docs/SEED-DATA.md for targets, credentials and resumable journals
yarn mock:api                   # The in-memory api the pages develop against, on port 3200
yarn mock:seed                  # Seed the running mock: 57 cases across every tab plus nine referrals — four
                                # Decided so the returned-for-action count is non-zero, two of those also
                                # awaiting the applicant's confirmation (waiting 14 and 3 days) so the second
                                # count, its tab and the Waiting column are non-empty too. Resets the store
                                # unless given `--keep`, and exits non-zero on a mismatch
```

The mock starts **empty**, so a page whose data comes from a list — the case list, its filter tabs, the
dashboard's count — shows nothing until `yarn mock:seed` has run. An empty store is indistinguishable from a
broken feature, which is why the seeder reads its own numbers back (`scripts/seed-local-cases.mjs`).

The seed also provides 26 Gazette-ready cases and 26 frozen past batches, with a 101-case batch whose
reference preview stops at 100. These are mock fixtures; mock request outcomes never send email.

The Gazette area `/deed-polls/gazette/**` is gated once in `app.ts` after authentication, using
`requireCapability(ACCESS_GAZETTE)`, read from the session's stored `GET /me` answer — never from a role string,
which is what master's `caseworker-deedpoll-admin` gate got wrong once api moved to `ACCESS_GAZETTE` (#100). Its
independent main-list count is requested only for callers holding `ACCESS_GAZETTE`; zero and unavailable
both retain the area link. Ready reads forward only paging and `filter=readyForPublication`, never a
sort or local membership predicate. History preserves API totals and the explicit truncation flag.
The recipient editor is the "London Gazette recipient" section of `/deed-polls/settings` (see "Delivery Manager
settings" below); `/deed-polls/gazette/settings` is now only a `GET` 302 to `/deed-polls/settings#gazette-recipient`.
It uses API GET/PUT settings, forwards the original revision on save and preserves input on 400/409. A conflict
requires a reload, never an automatic write with a fresh revision. Attribution comes
from API; the page does not post it. The mock starts unset and resets settings with
its other fixtures. Saving a setting sends no email.
The Welsh extractor already includes this area recursively through `deed-polls`.

The request list/detail pages at `/deed-polls/gazette/requests` consume the API ledger and
full frozen membership, linked from history by public batch ID. Every outcome has explicit
copy; status failures offer refresh and never a resend control. Legacy unknown facts stay
unknown. `/deed-polls/gazette/batch` implements the mandatory five-check review,
selection, preview-backed confirmation and submission. Signed session-bound hidden
state keeps visits independent. All selected reviews are checked before/after preview
and before the first send; changes invalidate them. There is no persisted API sign-off.
The request UUID is derived at confirmation from the original visit, so back navigation
cannot mint a replacement. Lost responses preserve the original body/key; the explicit
status check replays that keyed POST without pre-reading changed case data. An API
request status redirects to its read-only page. Unknown outcomes never offer a new key.
The domain's `callGazetteApi` seam accepts only typed Gazette refusals as evidence of
non-admission and strips provider diagnostics. Ordinary operations still use `callApi`.
The submit (and the status check, which replays it) has its own 20 s timeout, `GAZETTE_SUBMIT_TIMEOUT_MS` in the
api client, because api sends synchronously and the default 10 s turned a slow success into an unknown outcome
(finding R03, `docs/plans/completed/20261021-r03-gazette-submit-timeout.md`). It is not api's 60 s Notify deadline,
and not "just above 30 s" either: **both** Application Gateways default `request_timeout` to 30 s, the backend one
between this app and api and the frontend one between the browser and this app. Past 30 s the caseworker would get
the gateway's error page, not the recovery page with the request's key, and the send request first re-checks every
selected review. So a send over 20 s is still an unknown outcome until both gateways' `request_timeout` is raised or
api sends asynchronously. And 20 s alone is no end-to-end bound, because the re-check and a token refresh spend the
same request's time first: `recordArrival` (`src/request-arrival.ts`, the first layer in `createApp`) stamps
`res.locals.receivedAt` from the monotonic `performance.now()`, and the send and the status check wait only for what is left of a 25 s budget from it
(`src/gazette/send-deadline.ts`), capped at 20 s and by `DEED_POLL_API_TIMEOUT_MS`, which can only shorten it. The
budget bounds the send, not what precedes it: the re-check's reads and the refresh keep their own timeouts, so a
pre-send phase that alone outlasts 30 s still ends on the gateway's page, having sent nothing. Under
a 5 s floor nothing is sent: the confirm step or the recovery page re-renders with the same journey and key, saying
nothing was sent or checked (`docs/plans/completed/20261021-r03b-gazette-send-deadline.md`).

`yarn test:gazette` runs nine browser journeys, the settings page's included, against a fresh mock on 3216 and this app on 3316,
using Redis on 6316/database 1 and local IDAM on 5556. It is separate from `yarn test:e2e` because its
empty-state check must never reset a shared developer mock. See README for prerequisites.
The standalone mock resolves missing token roles from local IDAM userinfo (override with
`DEED_POLL_API_MOCK_USERINFO_URL`); in-process fixtures can carry roles directly. This is mock-only:
real API authentication still belongs to API, and no page sends an asserted role.

There are **no database commands**, and the `yarn db:*` family that used to be listed here is gone rather
than renamed. See "No data access layer" below.

## Project Structure

```
deed-poll-admin/
├── src/                        # THE application (Express 5.x + Nunjucks) — the root package
│   ├── pages/                  # File-based routes, discovered by simple-router
│   │   └── layouts/            # The app-owned layouts every page extends — see below
│   ├── assets/                 # SCSS/TS bundles, compiled by vite
│   ├── auth/                   # IDAM OIDC: login, session, require-auth, require-role, persona switcher
│   ├── locales/                # App-level translations
│   ├── app.ts, server.ts       # createApp(), and the entrypoint that loads secrets first
│   └── secrets.ts              # Reads charts/deed-poll-admin/values.yaml for the vault alias map
├── config/                     # `config` package defaults + custom-environment-variables
├── libs/                       # The one remaining Yarn workspace — seven packages
│   ├── cloud-native-platform/  # Cloud Native Platform features
│   ├── deed-poll/              # The case domain — services, validation, view models
│   ├── deed-poll-api-client/   # The single adapter onto deed-poll-api, plus its in-memory mock
│   ├── express-govuk-starter/  # GOV.UK Frontend integration
│   ├── express-session-postgres/ # Template-provided, unused, deliberately kept — see below
│   ├── express-session-redis/  # The session store actually wired up
│   ├── simple-router/          # Simple Router features
│   └── [your-module]/          # Your feature modules
│       └── src/
│           └── [domain]/       # Reusable functions consumed by the app
├── e2e-tests/                  # End-to-end tests (Playwright), including the @smoke spec
├── charts/deed-poll-admin/     # The one Helm chart, where helmInstall requires it
├── docs/                       # Documentation and ADRs
├── Dockerfile                  # The root image `az acr build … .` builds
├── Jenkinsfile_CNP             # withPipeline("nodejs", "deed-poll", "admin")
└── package.json                # The application's manifest AND the workspace root
```

Two consequences of the application being the root package, both easy to trip over:

- **Turbo will not run a root-package script unless the task is named `//#<task>`**, and a root `//#build`
  would make `yarn build` invoke itself. So the app's tasks are `//#build:app`, `//#test:app` and
  `//#dev:app`, and `yarn build` / `yarn test` / `yarn dev` each run `turbo <x> <x>:app`. The `:app` suffix
  is load-bearing.
- **The app's TypeScript project settings are in `tsconfig.app.json`, not `tsconfig.json`.** The root
  `tsconfig.json` holds the `libs/*` `paths` and deliberately no `include`: `vite-tsconfig-paths` matches
  each source file against the tsconfig *projects* it discovers, and the root file is the only project
  covering the libraries' `*.test.ts` files. Giving it an `include` made every library test resolve
  `@hmcts/*` to `dist` while its source resolved to `src`, so `vi.mock` silently stopped applying — 44
  failures. Do not merge `tsconfig.app.json` up.

## No data access layer

**This repo is a presentation layer and owns no database.** Every read and write of case data goes to
[`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) over HTTP. Prisma, the pg pool, the
migrations, `apps/postgres`, `apps/api` and `libs/postgres-prisma` were all deleted — see
`docs/plans/completed/02-dal-cutover-to-api.md` for what moved and why. Consequences worth knowing before
writing any query-shaped code:

- **`libs/deed-poll-api-client` is the only thing that speaks HTTP to api**, and it never throws: it
  returns `ApiResult<T>`, a discriminated union, so an unreachable api is a state a page renders rather
  than a 500. Its wire types and its mock are deliberately not exported from the package index.
- **`libs/deed-poll/src/api/deed-poll-api.ts` is the only place that knows where api is.** `callApi` turns
  a failed `ApiResult` into the domain errors `src/errors.ts` already renders. No page sees a base
  URL, and every service function takes a `Caller` — `{ accessToken }` — because api derives both the audit
  author and the admin status from the token.
- **api must be reachable to run anything.** `yarn dev` starts the in-memory mock alongside the app; the
  unit suite drives the same mock in process. Nothing depends on a running Java service, and nothing
  should.
- **`DEED_POLL_API_URL`** is the base URL, defaulting to the mock at `http://localhost:3200`. Deployed
  environments set it in `charts/deed-poll-admin/values.yaml`, resolved per environment from
  `global.environment`; preview overrides it to AAT's api, so **preview writes land in AAT's data**.

Three facts about the confirmation worklist that are not derivable from a single file:

- **A worklist is either a published `filter` key or a `where` condition, and which one is api's choice, not a
  style preference.** Awaiting-confirmation is a filter key (`AWAITING_CONFIRMATION_FILTER`), so it comes with
  api's own default order — `awaitingConfirmationSince:asc`, longest wait first — and the count and the tab must
  send **no `sort`** of their own or they override it. Not just their own: the tab is not orderable *at all*
  (`isReorderable` in `libs/deed-poll/src/deed-poll/list-sort.ts`), because a `sort` reaches it three other ways —
  the tab link carrying the previous tab's order, a sortable column header, a bookmarked URL — and api's default is
  only a default. So the worklist drops any `sort` it is asked for and renders its headings as plain text; leaving
  the headers as links while dropping the order would be seven controls that do nothing. Returned-for-action is a `where` on
  `currentReferralState`, because api publishes no tab for it. Do not convert one into the other, and do not
  narrow either list here.
- **A case can be waiting for the applicant with no case state saying so.** There is no ninth `DeedPollState`:
  the case still reads `Returned`, and `awaitingConfirmationSince` — recomputed by api from its referrals' two
  confirmation columns — is the only thing that says it is waiting. So the case page says it as inset text
  *beside* the Status row (the case's `state`, labelled Status since 2026-10-22) (`src/pages/deed-polls/[id].ts`), and a referral is "waiting" by api's two-column
  predicate rather than by its state: `Closed` clears neither column, so a closed referral can still be holding
  its case on the worklist.
- **A recorded confirmation cannot be amended, and a 409's meaning comes from a fresh read.** api publishes no
  amend operation and refuses a second recording, which is what the form's warning text states. The POST reads
  nothing first — api owns the transition — and on 409 redirects to the referral, which picks the sentence from
  the freshly-read referral, because api's two refusals are distinguishable only by prose this app must not
  parse. Same shape as the withdraw and close conflicts.

Two facts about the email send's idempotency key, which spans six files and is cheap to break from inside any one
of them:

- **Where the key is minted is the whole of what makes it work.** api requires `Idempotency-Key` on
  `POST /caseworker/cases/{id}/emails/{template}` — a UUID, absent or unparseable being a 400 that names the
  header — and it is minted **when the check page renders** (`src/pages/deed-polls/[id]/emails/[template]/preview.ts`),
  never at the send: a key minted at the POST would be new on every retry and the header would guarantee nothing.
  `loadEmailJourney` only ever *reads* it, and a value that is not a UUID reads as `null` rather than travelling.
  **Both** of the check page's forms carry it — including the way *back* to the wording, or a correction would
  return to a check page that minted a second key and the resubmit would be a second email. A send that arrives
  without one is a fault in this app: a plain `Error` and the 500 page, never a field error, because no form has a
  control for a header — and **that takes two checks in `send.ts`, not one**, because api's own 400 naming the header
  arrives as an `InvalidInputError` whose field matches no control, which the shared rejection path would otherwise
  render as the check page's "this email cannot be sent for this case" refusal about a perfectly sendable case,
  logging nothing. The control is `idempotencyKey` in this repo's camelCase deliberately — the slots beside it
  are GOV.UK Notify placeholder names and must stay `snake_case` — and both write bodies set
  `additionalProperties: false`, so the key in a body is a 400 naming it. A *reload* of the check page is a new
  journey and that is correct; two tabs on one case get a key each, which is why this is a hidden control rather
  than session state.
- **A redundant send is a success, and only one of api's two answers is not.** api answers 200 with the first row's
  id and `enqueued: false` both for a repeat of one key and for a case already owed that email, so the tab says it
  had already been sent rather than that anything failed. A 409 is the other thing entirely: the case is in no
  state to send, or the key was used for *different* content. Those two are distinguishable only by api's prose, so
  `send.ts` renders api's own sentence for both — see its docblock for the one refusal that leaves the check page
  with no forward control, and why re-keying instead would break the other.

## Personas and role gating

**Four staff personas, one deployable.** Caseworkers, Team leaders and Delivery Managers work `/deed-polls/**`; a judge works `/judicial/**` — the
shared referral pool, one referral, the claim, and the direction flow. Facts that are not derivable from a
single file:

- **`/judicial` is gated on the area, not the page.** `src/app.ts` mounts `requireJudicial()`
  (`src/auth/require-role.ts`) on the `/judicial` prefix, *after* `requireAuth` so an anonymous visitor still
  gets sent to log in rather than refused. A page added under `src/pages/judicial/` is gated because of where
  it lives; `src/app.test.ts` reads that directory off the filesystem and fails if the mount stops covering
  one. **Do not add a per-page role check** — the pages deliberately never ask about the role, which is also
  why no page test can show the boundary.
- **This is a persona boundary, not the data boundary.** Every role rule before it was presentational
  (`canDeleteWitness` hides a button). API gates the same `/judicial/**` routes on the same role, so a
  caseworker who defeated this gate would see a screen of 403s, not a judge's referrals. The gate decides which
  chrome a signed-in user gets.
- **It refuses with `next(new ForbiddenError(...))` and renders nothing.** `src/errors.ts` answers 403 on the
  **404** view and logs the message the gate built — that render is the end of the chain, and the starter's
  handler (the only thing that logs) is never reached. The view says nothing about what was refused, and the gate
  runs before anything is looked up, so a guessed judicial URL never discloses whether that referral exists. The
  **403 status does disclose the area**: that `/judicial/**` exists and this caller may not enter it. That is
  deliberate and pinned by `e2e-tests/tests/judicial.spec.ts` and `staff-roles.spec.ts`; do not describe the area
  as non-enumerable (review finding R14, `docs/plans/completed/20261021-r10-r14-error-disclosure.md`).
  `src/pages/errors/403.njk` exists but belongs to the login flow, where the user already knows who they are.
- **Staff capabilities do not imply judicial access.** Team leaders and Delivery Managers are refused
  `/judicial/**` unless they separately hold the judicial role. `isAdmin` remains only the privacy adapter.
- **Access comes from api's `GET /me`, not from IDAM roles.** IDAM is sign-in only; api resolves permissions
  (from AM) and answers `{ staff, judicial, capabilities }`. `loginFrom` (`src/auth/idam.ts`) asks at sign-in and
  the refresh middleware asks after each token refresh and once for a session holding no answer
  (`src/auth/caller-access.ts`); the answer is stored on the session user. Nothing in the authorisation path
  reads a role — `KNOWN_ROLES` and `rolesFrom` are gone, and the role constants in `roles.ts` survive only for
  provisioning test identities (persona users, seed scripts) and for the mock. A new api capability must be added
  to `capabilities.ts` and to the mock's table (`libs/deed-poll-api-client/src/mock/caller-access.ts`), whose test
  pins it to the `CallerAccessResponse` enum in `openapi.json`. `callerAccessFrom` drops unknown capability
  strings and turns a missing or malformed answer into no access, so an unlisted capability fails closed.
- **`/` is where each persona's home is decided, and the only place it can be.** A judge's home is
  `/judicial/referrals`, other staff land on `/deed-polls`. A judge who also has staff capabilities lands on the case list;
  ordinary caseworker plus judicial still lands on the pool.
  `/login`'s `returnTo` fallback is therefore `/` and **not** a concrete list path: the `/me` answer does not
  exist until the token has been exchanged, so hard-coding `/deed-polls` there strands every judge on a list api answers
  403 to, with nothing in the logs to say why.
- **Judicial page copy must never name or imply a holder.** api answers withdrawn, closed, another judge's and
  never-there as one indistinguishable 404 on purpose, so the "no longer available" wording has to stay true of
  all four — it does not enumerate the causes either, since a hedged "may already be with another judge" is the
  implication the rule forbids.
- **api checks visibility before state, so no 409 on the judicial surface can mean "somebody else has it".** By
  the time a 409 is possible the caller can already see the referral, which api's visibility narrows to their own:
  a claim 409 means they hold it or have already directed it, a direction 409 means they can see it but do not
  hold it. So both name a *state* ("not waiting to be claimed", "not waiting for a direction from you") and the
  claim's 409 redirects to the **referral** rather than the pool — "This referral has already been claimed" plus a
  bounce to the list would tell a judge somebody else has work that is in fact theirs. The pool therefore carries
  one refusal, not two. A caseworker's 409s are a different thing entirely (two caseworkers racing), which is why
  `referrals/new.ts` re-renders at 409 instead.
- **Judges see the full application and its documents (business decision, 2026-10-19).** This replaces the
  eight-field view of 2026-09-17. `application` on `GET /judicial/referrals/{id}` is api's `JudicialApplicationView`:
  the details, witnesses and attached documents, with no payment, refund or fee data, and private cases in full.
  `libs/deed-poll/src/judicial/view.ts` builds the read-only "Application" section from that type alone, listing its
  fields in `APPLICATION_SECTIONS` and borrowing only labels and formatting from the caseworker metadata. Do not
  import the caseworker view model: the judge's page must not grow a field because the caseworker's did. Documents
  open in the shared viewer (see "Document viewer" below); the original download, and the legacy
  `src/pages/judicial/referrals/[referralId]/documents/[documentId]/file.ts`, share
  `src/document-response.ts` with the caseworker route. Who may open one is api's visibility: any judge on `Open`,
  the holder on `Claimed`, the director on `Decided`, nobody once closed. On the legacy `file.ts` the same 404 covers
  each refusal and renders the unavailable page, and its relay keeps api's `inline` only for PDF, JPEG and PNG under a policy with
  `default-src 'none'` and a bare `sandbox` (no `allow-*` token), and downloads everything else, filename kept; the
  caseworker upload page never renders api's 404 text, only its own sentence, logging api's through `forLog`
  (review findings R09 and R13, `docs/plans/completed/20261021-r09-r13-document-responses.md`).
- **The judge who gave a direction can change or withdraw it until the office closes the referral.** On a
  `Decided` referral (api shows it only to its director) the page links to `direction?change=1`, which reuses the
  direction form and check page, prefilled and worded as a change, and calls `reviseDirection` (`PUT`). It also
  links to `withdraw`, a confirmation page that calls `withdrawDirection`. That leaves the referral `Claimed` by the
  same judge with no direction, so the page offers the ordinary direction form again. A 409 on either redirects to
  the freshly read referral with a state-only sentence, and a 404 is the unavailable page. api writes the
  caseworker a case note, keeps the earlier direction on its audit trail and sets `directionChangedAt`. The
  caseworker's referral page and the case page's referrals panel show "The judge changed this direction on {date}."
  as inset text from that flag. It sits outside the direction section because a withdrawal leaves no direction.
- **A user holding both roles still has no link to `/judicial/**`.** There is judicial navigation now, but it is
  the two judicial lists' own (`src/pages/judicial/referrals/list-navigation.njk`) and it renders only on pages
  inside the area; the shared chrome renders no service-navigation, so the caseworker-first landing in
  `src/pages/index.ts` leaves such a user typing the URL. The gate admits them, so this is a missing route rather
  than a refusal; it is `referrals-admin-3`'s flagged open question, and the fix if the business confirms such a
  user is a conditional link on the case list, not a change to the landing.
- **The pool is `Open` only, so claiming a referral takes the row off it — and onto `/judicial/referrals/mine`.**
  api filters `GET /judicial/referrals` to `Open` (the plan's "plus the judge's own `Claimed`/`Decided`" describes
  `referrals-admin-3` decision 3's *read* visibility, not its list), and `GET /judicial/referrals/mine` is the
  second collection that answers for the judge's own `Claimed`/`Decided` work — added by api follow-up 6 and
  consumed by `referrals-admin-6`. **Membership is api's answer about the token's IDAM subject**: do not derive
  "mine" from rows previously seen, session state, browser history or `claimedBy` display text, and do not filter
  or re-sort either list here. The states the personal list admits live in one predicate —
  `isMyListState` in `libs/deed-poll/src/judicial/view.ts` — which is also what decides whether a referral's detail
  page links back to the pool or to My referrals, so the two cannot drift into returning a judge to a list their
  referral is not on. A lapsed claim is keyed on the state, not the holder: api's inactivity sweep makes the row
  `Open` again and it leaves the personal list even though the name is still on it.
- **A new page area must be added to `scripts/extract-welsh-strings.mjs`'s `INCLUDE`.** The script's scope is a
  list of directories, so a page area that is not on it contributes nothing to
  `.business_context/welsh-translation-request.csv` and nothing to `yarn welsh:check` — with no failure anywhere,
  because the pages still carry their `en`/`cy` pairs. `src/pages/judicial/**` shipped that way and was invisible
  to the translation request until the directory was added. The extractor parses with the
  `typescript-6` alias, not the build's TypeScript: TypeScript 7 dropped the JavaScript compiler API it uses, and
  `.github/renovate.json` holds the alias below 7. `src/welsh-extractor.test.ts` fails if it stops reaching its summary
  line, because `--check` exits 1 by design and a crash once passed unnoticed for that reason. A page whose *second* content pair is named
  `<name>En`/`<name>Cy` is picked up too, under a `<name>.` key prefix.
- **The same silence applies one level down, to a content *shape* the extractor cannot parse.** An unparsed key is
  not reported as unparsed — it is simply absent, and a page whose other twenty keys are present looks complete. All
  three shapes `.claude/rules/frontend.md` documents are handled now (string, nested object, and a **function** that
  interpolates a runtime value), but a fourth would need adding: `const en = (m) => ({ … })`, the whole-object
  function form, is not read, and a page written that way would contribute nothing. Nor is a nested object under a
  cast (`fieldErrors: { … } as Record<string, string>`): both witness pages' `fieldErrors` are missing that way, so
  their `blankErrors` carry no cast and the lookup widens the type at the use site instead. A second pair mirrors the same
  way the first does, `<name>Cy = { ...<name>En }`: until 2026-10-19 only a bare `{ ...en }` counted, so a page with
  no plain pair (the judicial document route) reported its strings with no `cy`, and they were missing from
  `yarn welsh:check`'s count. Function entries are reported
  one row per sentence (`returnedForActionFor.1`, `.2`) because English needs a singular and a plural where Welsh
  needs more, so which sentence covers which count is a translator briefing rather than a string.

Ordinary caseworkers hold `caseworker-deedpoll` for CCD document READ. Both new staff roles need mappings
to the API's reader profile alongside the existing legacy admin and judicial mappings; no staff persona receives the system role. The AAT IDAM role registration must
land before the updated ordinary-caseworker persona can be created. Existing real accounts need assignment.
The judicial gate still requires `judicial` in the `/me` answer.

api owns the capability matrix (`RoleCapabilities.java`); the mock mirrors it, and admin holds no copy:

| Role | Privacy override, note/witness deletion, shared-query management, CCD repair | Gazette | Process settings | Judicial |
|---|---|---|---|---|
| `caseworker-deedpoll` | No | No | No | No |
| `caseworker-deedpoll-team-leader` | Yes | No | No | No |
| `caseworker-deedpoll-delivery-manager` | Yes | Yes | Yes | No |
| `caseworker-deedpoll-admin` (temporary compatibility) | Yes | No | No | No |
| `caseworker-deedpoll-judicial` | No | No | No | Yes |

`can(user, capability)` is the UI policy entry point (`libs/deed-poll/src/auth/capabilities.ts`); `staffAccess(user)`
gives `{ staff, judicial }` for the future staff block, which this app does not yet enforce. CCD repair has no
Admin UI control. `isAdmin` is derived from `OVERRIDE_PRIVACY` solely for the existing form/presentation
interfaces, and `isJudicial` from `judicial`. `sessionUser` validates the stored answer on every read and
recomputes the flags, ignoring stale booleans. The answer *is* persisted on the session; staleness is bounded by
refreshing it with the token. A changed role assignment takes effect within one token lifetime, not at next
login. If `/me` fails at sign-in the user is signed in with no access until the next refresh; if it fails on
refresh the previous answer is kept.

Deploy this Admin change only after API #105 (`GET /me`) is serving on every target instance, both new roles are
registered with IDAM, and CCD reader mappings are imported. Assign Delivery Manager explicitly to
Gazette operators. `scripts/seed-idam-users.mjs` retains legacy admin only as a negative Gazette fixture;
the switcher has no legacy persona. The case seeder uses Team leader but keeps its journal's `admin`
key and subject IDs so existing runs remain resumable. See the
[role-change plan](docs/plans/20261009-team-leader-delivery-manager.md) for validation and infra handoff.

## The dev persona switcher, and the two patterns it establishes

A tester switches between the Caseworker, Team leader, Delivery Manager and Judge personas from a strip on every page, by signing in
as that persona's real IDAM user (`src/auth/persona-switcher.ts`, `src/auth/persona-users.ts`,
`src/pages/switch-persona.ts`). Two things about it generalise beyond the feature:

- **Every page template extends `layouts/app.njk` or `layouts/app-full-width.njk`, never the starter's
  `layouts/default.njk`.** The app-owned layouts are the starter's plus the strip, and they are app-owned because
  `libs/express-govuk-starter` is template-provided: an edit there is lost at the next re-scaffold with nothing
  failing. A page on the starter's layout renders perfectly and simply has no switcher, on one page, so
  `src/pages/layouts/app.njk.test.ts` reads `src/pages/**` off the filesystem and fails any template extending
  something else. The starter's own layouts must stay ignorant of the strip, which that file also pins.
- **A non-production control is gated on a chart-injected `ENVIRONMENT_NAME` against a named allowlist, and
  never on `NODE_ENV`.** `package.json`'s `start` is `NODE_ENV=production node dist/server.js`, so *every*
  deployed pod runs as production — AAT and preview included — and a `NODE_ENV` test either enables the control
  in production or disables it everywhere it is wanted. So: a flag in the chart (`PERSONA_SWITCHER_ENABLED`, off
  in `values.yaml`, which a production deploy inherits) **and** `PERSONA_SWITCHER_ENVIRONMENTS.has(…)`. Both
  halves fail closed, which is why `config/default.json` leaves `environmentName` **empty** — it defaulted to
  `development`, itself a permitted environment, so any deploy path that did not render the variable reduced two
  conditions to one. `yarn dev` and `vitest.config.ts` are therefore the two places that name their own
  environment. `config/production.json` restates the flag's `false` and cannot enforce it: node-config applies
  `custom-environment-variables.json` *after* `{NODE_ENV}.json`, so the variable always wins. Same allowlist
  argument as `libs/deed-poll/src/auth/plain-http.ts` — **do not "simplify" either to `!== "production"`**.
- **Preview has no switcher, and the flag is what keeps it that way.** Jenkins deploys preview with
  `global.environment=aat`, so `ENVIRONMENT_NAME` reads `aat` there and the allowlist cannot tell the two apart.
  `values.preview.template.yaml` therefore never sets `PERSONA_SWITCHER_ENABLED`, and `src/deployment-chart.test.ts`
  fails if it does. Otherwise every PR's unreviewed code would get a privilege switcher writing to AAT's data (OWASP M1).
- The switcher's copy is **English-only in a `COPY` const**, not in `src/locales`: `yarn welsh:check` fails on a
  `cy` identical to its `en`, so the alternative to billing a translator for a development tool is a red check
  with no defect behind it. This is the one exception to "every page has `en`/`cy`" — do not copy it for
  anything a caseworker sees.
- `src/deployment-chart.test.ts` pins all of the above from the chart's side: which templates may enable the
  flag, that the allowlist names each of them, that the env-var mapping actually maps (asserted structurally,
  since a mis-nested key leaves every name present while `config.get` silently falls back), and that the
  default environment name matches nothing.

## Deployment and sessions

Facts that are easy to get wrong from the code alone, and expensive to get wrong:

- **CI/CD is the Jenkins CNP pipeline**, `Jenkinsfile_CNP` at the root — `withPipeline("nodejs", "deed-poll",
  "admin")`. There are **no GitHub Actions workflows and none should be added**: `.github/workflows/` was
  deleted in full and `.github/renovate.json` is all that is left under `.github/` that the platform reads.
  The pipeline invokes six `yarn` scripts and **fails the stage on a missing one** — `lint`, `test`,
  `test:coverage`, `test:a11y`, `test:smoke` and `test:functional`. Do not delete any of the six;
  `src/pipeline.test.ts` fails if one goes. See `docs/PIPELINES.md`.
- **One image, one chart, one component.** `charts/deed-poll-admin/` is a single `nodejs` chart, and the
  directory name is not a preference: `Helm.HELM_RESOURCES_DIR` is the literal `charts` and `helmInstall`
  throws without it, then requires `charts/deed-poll-admin/values.yaml`. `values.yaml` holds the real
  configuration; the per-environment files are `values.aat.template.yaml` and
  `values.preview.template.yaml`. **Do not add a bare `values.template.yaml`** — `helmInstall` renders that
  name *over* `values.yaml` instead of layering, so everything `values.yaml` holds and the template does not
  restate is silently lost. `src/deployment-chart.test.ts` pins all of this.
- **The chart ships inside the image.** `src/secrets.ts` reads `../charts/deed-poll-admin/values.yaml` to
  build the Key Vault alias map, and `getPropertiesVolumeSecrets` swallows a missing chart by returning an
  empty map — so moving or excluding that file un-aliases every secret with nothing failing until the first
  `config.get` in a deployed pod.
- **Admin carries no Google Tag Manager, and the CSP names no Google host** (review finding R12; plan
  `docs/plans/completed/20261022-r12-r15-gtm-off-and-input-gaps.md`). `src/app.ts` calls `configureHelmet({ enableGoogleTagManager: false })` and passes no `gtm` nunjucks
  global, so the starter's analytics templates render nothing; there is no `gtm` config. The template's placeholder
  `GTM-XXXXXX` bootstrap was inline and un-nonced, and `*.googletagmanager.com` is a known CSP-bypass host, so the
  allowance weakened containment for a feature admin does not use. Adopting GTM later needs a real container, a nonce
  and analytics consent, not a config flag. The change is in the app, not `libs/express-govuk-starter`, and Dynatrace
  is untouched. `src/analytics.test.ts` pins the rendered page and the exact CSP.
- **This repo owns no Terraform.** The resource group, Key Vault, App Insights and Redis are all in
  [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra). **Do not create an `infrastructure/`
  directory here.** The Postgres that root also provisions is `deed-poll-api`'s now, not this app's.
- **Sessions are in Redis**, via `@hmcts-cft/express-session-redis` and `REDIS_URL` — and they are the one
  piece of state this app still holds locally, deliberately. The reasoning is at the call site in
  `src/app.ts`: a session is transport state, and putting it behind api would invert
  authorisation. Local Redis comes from `docker compose`, so `yarn dev` needs Docker running. Preview gets an
  ephemeral `redis` subchart per pull request rather than AAT's cache, because one cache shared across every
  open PR means a collision or a flush in one is felt in the rest — the reasoning is in `charts/…/Chart.yaml`. That subchart
  speaks only `redis://`, which `assertRedisUrl` refuses under `NODE_ENV=production`, so the preview template alone sets
  `REDIS_PLAINTEXT_PERMITTED`. It admits `redis://` only to a `deed-poll-admin-pr-<n>-redis-master` host, and
  `src/deployment-chart.test.ts` fails if any other values file sets it.
  `libs/express-session-postgres` is still on disk and still a dependency of the root package deliberately —
  it is template-provided and unwiring it invites a re-scaffold conflict — but nothing imports it, and a
  change that puts sessions back on Postgres is a regression, not a refactor.
- **The readiness probe names Redis and api, and no database.** `deedPollApiStatus()` in
  `libs/deed-poll/src/api/deed-poll-api.ts` is what replaced the Postgres table check: a probe that went
  green while api was unreachable would have Kubernetes send traffic to a pod that 500s every case page.
- **A failed IDAM discovery recovers on its own, and a restart is not the fix.** `idamConfiguration`
  (`src/auth/idam.ts`) caches only a successful discovery. A failed one (a 503, a reset connection, the client's
  own timeout) holds off the next attempt for `DISCOVERY_RETRY_COOLDOWN_MS` (5 s). Logins, callbacks and refreshes
  inside that window fail at once with "IDAM discovery failed recently" and make no request, and the first request
  after it starts one shared attempt. So a pod is back within about 5 s of IDAM recovering, at a cost of at most one
  discovery request per 5 s during an outage, with no background retry. Only discovery is retried: a refused
  discovery means the code exchange and refresh grant are never sent, and a refresh that cannot discover throws,
  which keeps the session as transient instead of ending it. **A misconfigured issuer looks the same in the logs
  but never recovers**: `openid-client`'s "discovered metadata issuer does not match the expected issuer", or an
  HTTPS refusal, repeats once per interval indefinitely. That is fixed in `IDAM_ISSUER_URL` or the chart, not by
  waiting or cycling the pod.
- **Ending a session is local first, and IDAM is asked afterwards** (review finding R04; plan
  `docs/plans/completed/20261021-r04-timeout-during-idam-outage.md`). A timeout (`endTimedOutSession` in
  `src/auth/session-lifetime.ts`) and logout (`src/pages/logout.ts`) emit their ending event, end the session here
  (regenerate or destroy; logout then sets `Clear-Site-Data`), and only then look up IDAM's end-session address,
  through `availableEndSessionUrl` (`src/auth/end-session.ts`). A lookup that fails, the discovery cooldown included,
  falls back exactly like an issuer advertising no endpoint (`TIMED_OUT_PATH` for a timed-out GET, `/login` as a
  timed-out POST's sign-in link, `/signed-out` for logout), so an outage still ends the session on the first request rather than
  answering 500 and emitting the event again on every retry. The IDAM session survives such an ending, and the sign-in
  link can re-enter it once IDAM recovers; that is the accepted cost, and the fix is never to await IDAM before the local
  end again. The event stays
  *before* the local end, so it carries the old `sid`: fix an ordering problem here by moving the lookup, never the
  event.
- **A logout that cannot reach IDAM's end-session page lands on `/signed-out`, never on `/`** (plan
  `docs/plans/completed/20261021-r04b-signed-out-page.md`). `/` sends an anonymous visitor straight to `/login`, which
  starts IDAM sign-in without a click, so through the IDAM session that survives an outage (or an issuer advertising no
  end-session endpoint) someone who clicked "Sign out" on a shared PC would be signed straight back in.
  `src/pages/signed-out/` is public (`PUBLIC_PATHS`) and offers sign-in only as a link. Its copy says "signed out of
  this service" because IDAM may still hold its own session. With IDAM healthy, logout still goes to IDAM's
  end-session URL.

## Session writes

A destroyed session must stay destroyed whatever request is still holding it (review finding E01; plan
`docs/plans/completed/20261020-e01-session-revocation.md`). `connect-redis`'s unconditional `SET` let a refresh waiting on IDAM,
an activity save or `express-session`'s own autosave put a logged-out session back. The rules, which every future
authenticated writer must follow:

- **The store is `GuardedSessionStore` (`src/auth/guarded-session-store.ts`), passed through the unchanged
  `expressSessionRedis` seam.** Each record is one Redis hash under `admin-sess-v2:<id>`: `inc` (a random incarnation
  minted at creation), `rev` (a counter every write moves), `sess` (the JSON), and while a refresh runs `lease` and
  `leaseUntil`. Every operation is one Lua script, so atomic. The version a request read travels in a `WeakMap` keyed
  on the session object, never in the cookie or the session JSON, so autosaves carry it and the browser cannot.
- **Only a never-stored, freshly generated id can create a key.** An update is refused `missing` if the key is gone,
  `conflict` if `inc` or `rev` moved; `touch` checks `inc` and `EXPIRE` never creates; `destroy` is a plain `DEL` and
  wins in either order. A refusal is `SessionWriteRefusedError` and changes nothing. **Never add a fallback to a plain
  write, a retry of a timed-out write, or a write that bypasses the store** — each reopens E01.
- **An authenticated write that is not a sign-in goes through `saveReconciled` in `src/auth/session.ts`.** It applies a
  change, and on `conflict` reloads and re-derives the same change from what the store now holds, at most three
  times. The change must be computed from the re-read session, never copied from the request's snapshot, or an older
  snapshot rolls back newer tokens or access. `touchLastSeen`, `storeAccess` and `publishRefresh` are its callers.
  Sign-in, persona switch and timeout restart regenerate instead: the old key is deleted, a new id created (a persona
  switch only if the old key still existed; see the next rule).
- **A re-sign-in replaces its session only if that session still exists** (review finding R05; plan
  `docs/plans/completed/20261021-r05-r06-session-edges.md`). A persona switch waits on IDAM's password grant, and a
  logout on another pod can land meanwhile, so it calls `reSignIn` in `src/auth/session.ts`, not `signIn`.
  `reSignIn` first runs the store's `destroyExisting` (one `DEL` that reports whether a key was there). If the key was
  already gone it refuses with `SessionWriteRefusedError("missing")` and creates nothing, so the switch ends in
  `endedElsewhere` with no cookie and no `auth.persona.switched` event, returning to `/` after sign-in because
  `/switch-persona` has no `GET`. A store without the method fails closed. The
  OAuth callback is the one unconditional regenerate: its session is anonymous, so there is nothing to protect, and a
  sign-in must always mint a new id (session fixation). Do not route it through `reSignIn`. **One window is left
  open, deliberately** (Steve, 2026-10-21): `regenerate` deletes and then saves, so a logout or timeout landing in the
  couple of Redis round trips between `destroyExisting` and the new session's `CREATE` finds nothing to delete, and the
  switch then completes. Closing it needs one script that creates the new key only if the old one still exists,
  deleting it in the same step; that was judged not worth the risk in the store for a non-production tool. Revisit it
  before the switcher is ever allowed near production.
- **A gone session is one outcome: `isSessionGone(error)`.** Its handler is `endedElsewhere`
  (`src/auth/ended-elsewhere.ts`): destroy the request's copy and redirect to `/login`, emitting no event, because
  whatever ended the session already did. The keep-alive endpoint answers 401. A request whose write was refused never
  carries on authenticated on its discarded snapshot; any other refusal or store failure is a 500.
- **One refresh per session across every pod.** `claimRefresh` takes a lease in the session's own hash against Redis's
  clock (60 s, above the worst refresh; waiting at most 10 s), then reloads so the decision is made from stored state: a waiter normally finds the
  winner's tokens and refreshes nothing. `publishRefresh` writes the tokens and the `/me` answer in one save that is
  refused if the lease expired or passed on; a lost lease fails the request and is never retried, because IDAM may
  already have rotated the refresh token. The lease is released in `finally`, only if still held, and dies with the
  session's `DEL`.
- **The lifetime paths are never refreshed** (review finding R06, same plan). `refreshMiddleware` skips
  `NOT_REFRESHED_PATHS`: `/logout`, `STATUS_PATH` and `TIMED_OUT_PATH`, the last two imported from
  `session-lifetime.ts` rather than restated. The skip runs before the `/me` backfill as well. The lifetime middleware
  exempts the timed-out page and only answers the status poll, so without the skip a session past its absolute limit
  got fresh IDAM tokens from either one. Neither path's answer or render changed. Do not add a refresh for either one
  anywhere else.
- **TTL is the session's own.** `sessionStoreTtl`: signed-in until 15 minutes after the absolute deadline, anonymous
  10 minutes. Revision and lease share the key, so no coordination state can outlive or resurrect a session.
- **Legacy and rollout.** Old `admin-sess:` string records are never read; they expire on their own TTL. Old pods can
  neither read nor write a guarded record, so a mixed-version rollout signs people out, never in, and old pods keep
  the E01 defect only for their own old-keyspace sessions until they are gone. A rollback returns everyone to the old
  keyspace and the old defect. The procedure is in `docs/DEPLOYMENT.md#session-writes-and-rollout`.
- **The Redis suites are a gate.** `src/auth/guarded-session-store.test.ts`, `refresh-coordination.test.ts`,
  `session-lifecycle.test.ts` and `src/session-store.test.ts` run against real Redis with two app instances and a
  per-run prefix. They skip only when `REDIS_URL` is unset and Redis is unreachable; set `REDIS_URL` to make them
  mandatory. No pipeline stage provides Redis yet, so run them locally before changing any session writer.
- This is a guarantee about this app's session store. It does not revoke tokens at IDAM: a token copied out of a
  session before logout is IDAM's and api's concern.

## Security events

Sign-ins, sign-outs, persona switches and refusals go to App Insights as `customEvents`
(`docs/plans/completed/20261015-security-events.md`; the AAT query is in `docs/DEPLOYMENT.md`). They are about the session
only — api keeps the audit trail of writes and reads, and this app must not duplicate it.

- **A new security-relevant path emits through `securityEvent(name, req, props)`** (`src/auth/security-events.ts`).
  Nothing calls `trackEvent` from `@hmcts-cft/cloud-native-platform` directly: the emitter is what fills in `sid`,
  `env`, `method`, `route` and `subject`, and what keeps the names and keys closed. Without an App Insights client
  `trackEvent` writes one JSON `console.info` line, so local runs and tests still show the event.
- **The vocabulary is a closed union, `SecurityEventName`:** `auth.login.succeeded`, `auth.login.failed`
  (`reason`: `idam_error` | `exchange_failed`; IDAM's `error` code in `outcome`, or `unrecognised`), `auth.logout`,
  `auth.session.ended` (`reason`: `no_refresh_token` | `no_subject` | `refresh_refused` | `refresh_failed_expired` |
  `subject_mismatch` | `api_401` | `idle` | `absolute` | `untimed`), `auth.persona.switched`,
  `auth.persona.switch_failed`, `authz.denied` (`source`: `role` | `api`, plus `requiredCapability` when known) and
  `csrf.refused` (`fetchSite` or `originHost`). A new name is a change to the union and to its test, not a string.
- **The properties are a closed allowlist, `SecurityEventProperties`**, and an unknown key is a compile error, checked
  by `src/auth/security-events.test-d.ts` under vitest's typecheck mode — `yarn build` excludes test files, so it
  would not catch one. The rules behind the keys:
  - **`route` is `req.baseUrl + req.path`, never `originalUrl` or `url`**, because a search's query string carries
    names. Callers cannot set it.
  - **`sid` is the first 16 hex characters of `sha256(req.sessionID)`**, never the raw id. Emit **before** `signOut`
    so an ending event carries the old session, and **after** `signIn` so a login carries the new one.
  - **`subject` is the IDAM subject from `sessionSubject(req)`.** Never an email address or a display name.
  - **Never a token, secret, raw session id, cookie, email address, display name or applicant data**, test fixtures
    included. A value the browser or IDAM chose (an `error` code, a `Sec-Fetch-Site`, an `Origin`) is recorded only if
    it has the expected shape — otherwise `unrecognised`, or the host alone, or nothing — and never as prose.
- **The IDAM callback's refusal page shows only this app's sentences** (review finding R10,
  `docs/plans/completed/20261021-r10-r14-error-disclosure.md`). The callback query is the browser's to write, so
  `src/pages/oauth2/callback.ts` maps a known RFC 6749 `error` code to its own `en`/`cy` sentence through a `Map`
  (so `constructor` finds nothing) and renders `errors/403` with no `reason` for anything else. `error_description`
  is never displayed. Add a code by adding a sentence, never by echoing the query.
- **Every 403 is emitted in one place, `src/errors.ts`.** `ForbiddenError` carries `reason` (`role`, `same-origin` or
  the default `api`, which `callApi` raises) and the gate's details; `requireJudicial`, `requireCapability` and
  `same-origin.ts` set them, and `errors.ts` maps them to `authz.denied` or `csrf.refused`. Do not emit a refusal at
  the gate as well, or it is counted twice. The one 403 outside it is `requireAuth`'s refusal of an unauthenticated non-GET request, which has no
  session subject to record and is deliberately not an event.
- **An api error message reaches a log only through `forLog`** (`src/for-log.ts`), which strips CR, LF, ANSI escapes
  and other control characters and caps the text at 500 characters. `src/for-log.test.ts` scans `src/pages` and fails
  a `console.*` call that interpolates `.message` without it.
- **`forLog` bounds text; it is not a privacy filter.** What goes *into* an error message is the control (review
  finding E03, `docs/plans/completed/20261020-e03-safe-error-diagnostics.md`). A request's query values and raw headers never
  belong in one: a search's `q` and `where` are applicant names, and an `Origin` or `Sec-Fetch-Site` is whatever the
  browser sent. Safe inputs are the method, a route built from `req.baseUrl + req.path` (never `originalUrl`), a
  fixed operation or reason phrase, an HTTP status and schema field paths. The api client cuts a request path at its
  first `?` or `#` before `parseResponse` composes a diagnostic (`withoutQuery` in `client.ts`); the CSRF gate names
  the initiator with fixed prose and keeps the bounded `fetchSite`/`originHost` for the event only. Removal happens
  where the message is built, by position rather than by parameter name, because telemetry URL redaction cannot
  repair an exception that already embeds the value. `src/error-diagnostics.test.ts` drives both parse failures and
  the refusals through the real final handlers with synthetic markers.

## Abuse limits

Search, email preview, email send and upload are limited per IDAM subject
(`docs/plans/completed/20261016-abuse-limits-admin.md`, OWASP M6). Facts that are not derivable from a single file:

- **api is authoritative; this app's limiter is not the control.** `src/rate-limit/limiter.ts` exists so a caseworker
  is refused on this app's page before a pod spends a multipart parse or an api round trip, and its numbers mirror
  api's so it never refuses what api would allow. Change a limit in both places or in neither. It is keyed on the
  subject, falling back to the session id, and **never on IP or `X-Forwarded-For`**.
- **It fails open.** A Redis error passes the request with a `console.warn`, because Redis being down already means no
  sessions. `rateLimit.mode` (`RATE_LIMIT_MODE`) is `off | observe | enforce`, defaulting to `observe`, which logs the
  `rate_limit …` line `enforce` would refuse on and refuses nothing. Never gate it on `NODE_ENV`.
- **A 429 means "slow down", a 409 means "not in this state".** Both api's 429 (`rate-limited` in the adapter) and this
  app's own refusal arrive as `TooManyRequestsError` and render `errors/429` with `Retry-After` when the wait is
  known; no page catches it, and the refused request did nothing. A 409 stays what the sections above say it is — a state
  conflict or a reused key — and is resolved by the page that made the call. Do not map one onto the other.
- **The cap and the limiter go before multer.** `mountAbuseLimits` (`src/rate-limit/routes.ts`) mounts them in
  `app.ts` ahead of the router, in the order in-flight cap, limiter, then the page's `uploadSingleFile()`;
  `app.test.ts` pins it. A limiter after parsing protects nothing. The per-pod in-flight upload cap
  (`rateLimit.uploadInFlight`) enforces in every mode.
- **Search counts only a non-blank `q`.** Saved-query and worklist links carry `where` or `filter`, and the dashboard's
  counts are internal reads; counting either would refuse a caseworker for clicking their own dashboard.
- **The observe-check script's tests skip without `python3`.** `src/rate-limit-observe-check.test.ts` drives
  `scripts/rate-limit-observe-check.sh` and its parser (review finding R16) only when `python3` runs, and nobody has
  confirmed the Jenkins agents have it, so a green pipeline may not have run them. Run them locally before changing
  either file.
- **Gazette's 429 stays an unknown outcome.** `callGazetteApi` turns it into `GazetteOutcomeUnknownError`, not
  `TooManyRequestsError`, because only a published Gazette refusal proves nothing was admitted under the request's
  key. The Gazette batch page is not limited here; api limits it.

## Document viewer

Every document link opens one app-owned viewer (plan `docs/plans/completed/20261023-full-page-document-viewer.md`). Facts that
span several files:

- **Two scoped route sets, never one generic URL.** `deed-polls/[id]/documents/[documentId]/` and
  `judicial/referrals/[referralId]/documents/[documentId]/` each have `view`, `preview` and `download`, and a
  judicial URL never carries a case id. Each route builds its paths with `caseViewerScope`/`referralViewerScope` and
  `documentPaths` (`src/document-viewer/context.ts`) **before any read**. The return link is that scope's fixed
  `#documents` anchor and never a `returnTo`. The legacy `file.ts` routes stay for existing consumers.
- **The view reads its context once, and each binary request is authorised on its own.** The selector, title and
  return link come from the one case or referral read (`libs/deed-poll/src/document-viewer/view.ts`, api's order).
  `preview` and `download` read nothing first, and nothing loads every document to fill the selector. A preview 404
  is `{ code: "DOCUMENT_UNAVAILABLE" }` inside the viewer, never the referral-unavailable page; a referral 404 on
  `view` is that page.
- **api's preview refusals are typed, and their prose never travels.** `callPreviewApi`
  (`libs/deed-poll/src/api/deed-poll-api.ts`) maps the four codes to `DocumentPreviewRefusedError` only on their
  published status. It replaces api's message with `document preview failed (<kind> <status>)`, because api's prose
  can hold a converter's words or a file name. The relay (`src/document-viewer/preview-response.ts`) answers a
  fixed `preview.pdf` attachment under `default-src 'none'; sandbox`, and the shell's CSP is the app's own, not the
  binary's.
- **The limits are the producer's, restated once.** `DOCUMENT_PREVIEW_LIMITS` and `PREVIEW_TIMEOUT_MS` (27 s, a ceiling
  `DEED_POLL_API_TIMEOUT_MS` can only shorten) are in the api client, and `contract.test.ts` pins the limits to
  `openapi.json`. The page passes them to the browser as `data-max-bytes`/`data-max-pages`; do not restate them in
  the client.
- **PDF.js runs with WebAssembly off (`useWasm: false`) so the CSP stays unchanged.** Turning it on needs
  `'wasm-unsafe-eval'`. Also off: scripting, XFA, the annotation layer and range or streamed loading. It is the
  **legacy** build in both the browser and the Node tests. `pdfjs-dist` is a devDependency because vite bundles it.
  Its data files are copied by `vite.build.ts` to `/assets/pdfjs/` (`PDFJS_ASSET_MOUNT`), which
  `src/document-viewer/pdfjs-assets.ts` serves in development; `pdfjs-assets.test.ts` pins both lists, and that
  `package.json` resolves `pdfjs-dist` through a patch file that exists.
- **`pdfjs-dist` is patched, and a page it cannot draw in full is a page state, not a document state** (plans
  `docs/plans/completed/20261025-document-viewer-incomplete-pages.md` and
  `docs/plans/completed/20261025-document-viewer-oversized-image-only.md`). **Only an oversized image fails a page**:
  an image whose declared size is over `maxImageSize` makes the patched worker throw its own `ImageTooLargeError`
  whatever `ignoreErrors` says, and the patch rethrows it at each catch it passes through (the XObject `Do`, nested
  form XObjects and inline images, tiling patterns, an ExtGState SMask and an annotation's appearance stream).
  **`stopAtErrors` is deliberately off.** It is PDF.js's whole `ignoreErrors`, so it also failed or silently emptied
  pages for a broken font, ToUnicode map, colour space, shading or pattern, where PDF.js falls back and draws: an
  empty `FontFile2` drew none of its text. Do not turn it back on to catch some other fault; patch that fault's check
  instead. On the display side the patch fails each pending render task instead of completing it with the truncated
  operator list, and drops the failed list from `_intentStates`, so drawing the page again asks the worker rather
  than drawing a cached blank page; the worker resets an annotation's streams even when its appearance fails, or the
  next draw would read an emptied appearance and draw the page without its stamp as if complete. Unpatched, 6.4.299 draws the page without the image and resolves.
  `package.json` resolves `pdfjs-dist` through `.yarn/patches/` (committed; `.gitignore` admits only that directory
  under `.yarn/`), and the browser loads the **unminified** legacy worker (`pdf.worker.mjs?url`) because the minified
  files are unpatched. `pdf-document.test.ts` fails if the patch's behaviour is lost, which is what a version bump does,
  and Renovate never automerges `pdfjs-dist`. Re-apply the patch to a new version with `yarn patch` on the original
  package (not `--update`, which stacks a second patch). An upstream fix for the swallowed error (draft issue:
  `docs/pdfjs-render-error-upstream-issue.md`, not yet filed) retires only the display hunks; the worker hunks are
  this app's own and stay. **Three gaps are known and left** (Steve,
  2026-10-25: patching further into PDF.js costs more than the rare cases are worth). An oversized image can still be
  dropped silently when it is (1) an image's own `/SMask` or `/Mask` stream, which PDF.js builds as a `PDFImage`
  without the size check and whose decode failure it swallows; (2) a JPEG 2000 (JPX) image whose codestream is larger
  than its declared `/Width × /Height`, because PDF.js replaces the declared size after the check; or (3) inside a
  Type3 glyph, because PDF.js catches every Type3 glyph error itself. Each needs an exotic or crafted PDF over 64
  megapixels. The viewer's footer therefore says it is a preview and points to **Download original** for anything that
  looks missing; do not reword it into a promise of completeness.
  `renderPage` answers `incomplete` with the canvas emptied, and the viewer shows the page's sentence with **Download
  original** while every control keeps working; a thumbnail gets a grey placeholder. A page that cannot be read at all
  is still `failed`, the document's unavailable state. Never remove `maxImageSize`.
- **`src/assets/**` has its own type check, `tsconfig.assets.json`**, which `build:app` runs after
  `tsconfig.app.json` (which excludes it), so a type error in a browser bundle fails the image build. No unit test
  imports `viewer.ts` or `thumbnails.ts`; their behaviour is covered only by `yarn test:document-viewer`, which no
  pipeline stage runs. `render-page.test.ts` drives `renderPage` against real PDF.js with a minimal DOM stand-in. It and `pdf-document.test.ts` draw onto PDF.js's Node canvas, `@napi-rs/canvas`, which arrives only as an
  optional dependency of `pdfjs-dist`, so an install that skips optional dependencies fails them. Keep rules in DOM-free `presentation.ts`, where tests reach them.
  Switching documents replaces history and never pushes, and per-document state lives only in memory,
  `history.state` and a validated fragment, never in storage. `viewer.test.ts` scans the sources for storage,
  logging and requests, and allows a network call only in `fetch-preview.ts`.
- **`yarn test:document-viewer` runs the viewer's browser journeys** (caseworker and judge, all five formats) against
  a fresh mock on 3219 and this app on 3319, with Redis database 4 and local IDAM on 5556. It is kept out of
  `yarn test:e2e` because it switches the mock's preview scenario, which must never happen on a shared developer mock.
- **A browser that goes away mid-preview is not an error.** `relayPreview` aborts api's read on the response's
  `close` and drops the failure that produces, which the adapter would otherwise report as an api timeout: the
  loader aborts on every document switch. A close after the headers have gone is cut off in `domainErrorHandler` (`res.destroy()`,
  nothing logged for a premature close) and never passed on: the starter's handler would render over the sent headers
  and throw outside any handler, taking the pod down.
- **A preview fetch past a session limit is refused 401 and does not end the session.** The viewer's fetch never
  follows a redirect, so ending it there would leave IDAM's session standing and "Sign in again" would sign the reader
  straight back in. `sessionLifetime` leaves a non-navigating GET (`Sec-Fetch-Mode` present and not `navigate`) for
  the next navigation, the sign-in link to `view`, to end through IDAM. A refusal keeps api's own status, carried on `DocumentPreviewRefusedError`.
- **`download` (either scope) always answers `attachment`** through `sendDownload`, and its 404 is the shared "Page
  not found", not the referral-unavailable page. The `inline` rules in "Personas and role gating" are the legacy
  `file.ts` routes'.
- **Welsh:** `src/document-viewer` is on the extractor's `INCLUDE`, and `src/welsh-extractor.test.ts` compares every
  `en` key of `content.ts` with the extracted rows.

## Delivery Manager settings

`/deed-polls/settings` is where a Delivery Manager changes the service's process values while it runs (plan
`docs/plans/20261026-dm-settings-page.md`). Phase 1 holds the referral claim window, the London Gazette recipient and
a link to XUI staff administration. The other process values are later plans; add no field or placeholder for them.
Facts that span several files:

- **The area is gated once, on `MANAGE_PROCESS_CONFIG`.** `src/app.ts` mounts
  `requireCapability(MANAGE_PROCESS_CONFIG)` on `/deed-polls/settings`, after `requireAuth`, beside the Gazette gate;
  `src/app.test.ts` reads `src/pages/deed-polls/settings/` off the filesystem and fails if the mount stops covering a
  page. Only Delivery Managers hold it. The case list's "Service settings" link is drawn from the session's capability
  alone, with no api read. The capability arrives through `/me`, so an existing session gets the link within one token
  lifetime, or at once on signing in again: a missing link straight after a deploy is that, not a failed deployment.
- **Two forms, two Saves, two revisions.** The process section posts to `/deed-polls/settings` and the Gazette section
  to `/deed-polls/settings/gazette-recipient`, each with only its own revision, so a conflict in one never touches the
  other's stored value. A browser submits only the form whose button was pressed, so unsaved edits in the other
  section are lost, and the intro says "Save each section before you change another". The handler code is in
  `src/service-settings/` (every `.ts` under `src/pages` is a route). The submitted section is redrawn from the body
  with its **original** revision on a 400 or 409, never re-read; the other section is re-read and, if that read fails,
  degrades to a sentence with no form. A success is a 303 to `?saved=<section>#<section>`, and the banner shows even if
  the follow-up read fails.
- **The claim window form is digits only and does not use `readNumericInput`.** `processSettingsFormSchema`
  (`libs/deed-poll/src/settings/schemas.ts`) reads hours 0–24 and minutes 0–59 as trimmed `^\d{1,4}$` or blank, and
  the total must sit within `PROCESS_SETTINGS_LIMITS` (30–1,440 minutes, pinned to `openapi.json`). Signs, decimals,
  exponents and a missing control are refused. Do not swap in the case form's parser, which accepts `+2` and `2.0`.
- **The Gazette section needs `ACCESS_GAZETTE` as well.** The area gate admits every Delivery Manager, so the section
  is drawn and read only for holders, and its POST refuses anyone else with a `role` `ForbiddenError` before any read
  or write, because api checks the same capability.
- **The XUI link is per environment, from the chart, and is a link, never a permission.**
  `externalLinks.xuiStaffAdmin` (`XUI_STAFF_ADMIN_URL`) is AAT's address in `config/default.json`; `values.yaml` drops
  the environment segment only for `prod`, and preview pins AAT's. A non-production environment must never name
  production XUI; `src/deployment-chart.test.ts` renders every environment through `helm template` to prove it, and
  **those render tests skip without `helm`**. XUI checks `staff-admin` itself, which the copy says.
- **The page's Welsh is pending.** `src/service-settings` is on the extractor's `INCLUDE`; the new copy's `cy` mirrors
  its `en`, so it adds to `yarn welsh:check`'s identical count.

## Redirect paths

A redirect that names a case builds its path with `casePath(id)` (`src/case-path.ts`), and one that names a judicial
referral with `referralPath(id)` (`src/judicial-referral-path.ts`). Any other id in a path built in TypeScript — a
referral under a case, a saved query, a Gazette request, an email — goes through `pathSegment(id, label)`
(`src/path-segment.ts`), which both helpers delegate to. Never interpolate an id into a `res.redirect` target or an
`href` built in a handler. This is internal URL-construction hardening (Fortify `14866335…`, `250FCCE3…`, `2950F280…`; plan
`docs/plans/completed/20261019-case-id-redirect-encoding.md`); it is not proof that every redirect is safe.

- **Encode once, from the value Express or api gave you.** Route parameters arrive decoded, so the helper's single
  `encodeURIComponent` keeps a literal `%2F` literal (`%252F`). Do not decode again, encode a whole URL, or mutate
  `req.params`. Domain calls keep the raw id.
- **Empty, `.` and `..` are a fixed-message `NotFoundError`**, because encoding leaves dots alone and a browser drops
  a dot segment. Build the path **before** any write (and, on the judicial pages, before any read), so a refusal
  cannot follow a write. For an api-returned id (`created.id`, `referenceMatch`) build it after the response and
  never retry the write.
- **Templates are not covered yet.** About 25 `.njk` hrefs still interpolate `{{ case.id }}` and child ids directly,
  some with `| urlencode`; those ids come from api, and the sweep was deliberately kept to TypeScript. A new link
  should be built in the handler with the helpers and passed in, rather than added to that list.
- `gazette/batch.ts`'s 303 after a send keeps plain `encodeURIComponent`: it sits inside the outcome-unknown catch,
  so a refusal there would report a completed send as an unknown outcome.
- `src/case-redirects.test.ts` drives the two reported handlers over HTTP. A URL-parsing client resolves `.`, `..`
  and `%2E` as dot segments before sending, so the dot-only refusal is tested at the handler boundary instead.
- **The api adapter refuses the same three ids itself, so no api request ever carries one** (review finding R11; plan
  `docs/plans/completed/20261022-r11-r16-path-segments-and-observe-guard.md`). The check is once, in `exchange`
  (`hasUsableSegments` in `libs/deed-poll-api-client/src/api/client.ts`), which every operation reaches, so a new
  operation cannot skip it. Such a path answers `{ kind: "not-found" }` with a fixed message naming no id, sends
  nothing, and reaches a page as `NotFoundError`. That does not replace `pathSegment`: the adapter guards api's
  paths, the helpers guard this app's redirects. The Gazette batch page's `review:<id>` reads a not-found case as
  its existing `invalid` state, not as a Gazette outage.

## Numeric case-form input

A typo in a number field used to reach the patch as `null`, an instruction to clear the stored value (review finding
E04; plan `docs/plans/completed/20261020-e04-numeric-input-validation.md`). The rules for every `kind: "number"` field:

- **One parser, four outcomes.** `readNumericInput` (`libs/deed-poll/src/deed-poll/numeric-input.ts`) reads a
  submitted control as `absent` (not in the body: omitted from the patch, never nulled), `blank` (empty or
  whitespace-only: `null`, unless the field is `notNullable`), `valid` (the number) or `invalid`. Only `blank` clears.
  `readFieldInput` (`form-input.ts`) hands every number field to it, and `collectFormErrors` and `buildUpdatePatch`
  both read through `readFieldInput`, so validation and patch construction cannot drift; do
  not convert a numeric string anywhere else, and never with a bare `Number()`.
- **Accepted syntax is plain decimal after trimming: `^[+-]?(\d+(\.\d*)?|\.\d+)$`.** Signs are kept because
  `UpdateCaseRequest` sets no minimum. Exponents, `0x`/`0b`/`0o` prefixes, `NaN`, `Infinity`, currency symbols,
  thousands separators and non-ASCII digits are refused, never stripped, and a non-finite result is invalid. A value
  that is not one string (a repeated field arriving as an array, a bracketed name parsed into an object) is invalid.
- **Integer versus decimal comes from the contract.** `numberFormat: "integer"` on the `FieldDef` marks api's
  `int32` fields (`ageOfMinor`, `ageOfMinorMonths`), and `form-fields.test.ts` pins every editable number field to
  `openapi.json`. An integer must be whole and within int32: `7.0` reads as 7, while `7.5` and
  `7.00000000000000001` are refused rather than rounded (the fraction is checked on the text, since `Number()`
  rounds the second to 7). Absent means `decimal` (`refundAmount`), and a decimal longer than a double holds is
  rounded by `Number()`. Add no range, precision or positivity rule here; those belong to api.
- **Validate before mutation.** The edit handler runs `collectFormErrors` (dates, numbers and any input the form could
  not have sent, together in field order) before building the patch, and re-renders the exact submitted text with
  GOV.UK field errors and no write. `buildUpdatePatch` also throws `InvalidInputError` on any invalid reading, a
  number included, so a future caller that skips validation
  still gets no patch. Read-only numbers are never patched, whatever is posted.
- **api's validation still applies.** This guard only stops unreadable text becoming a clearing patch. api remains
  authoritative for permissions and business rules, and its 400s still come back through the handler's existing
  `InvalidInputError` path. `src/case-edit-numeric.test.ts` drives real URL-encoded posts through the handler with
  persistence mocked; it proves the outgoing patch, not a live save.
- **The field-error messages are English-only domain strings** in `form-validation.ts`, like the date-part messages, so
  they sit outside the Welsh extractor's page scope and add nothing to `yarn welsh:check`. Do not add `cy` strings.

## Case edit form saves

An unchanged save must write back exactly what is stored, and a refused save must redraw exactly what was submitted
(review findings R01 and R02; plan `docs/plans/completed/20261020-r01-r02-edit-form-untouched-fields.md`). The POST handler reads
no case first, so the body is the only evidence of what the page rendered. The rules:

- **"Absent" means something different for each field kind.** A rendered text input, textarea or select always
  submits its value, even an empty one, and a rendered date always submits its three parts. So when one of these is
  missing from the body, it was never rendered: hidden by its rule, locked, or not on this tab. `buildUpdatePatch`
  (`libs/deed-poll/src/deed-poll/form-payload.ts`) leaves it out of the patch. A date counts as absent only when all
  three parts are missing. A *present* empty value still clears a nullable field; a `notNullable` one (`privacy`, `urgency`) is
  silently left out instead, because nulling its column is a 500 and the stored value stands. Numbers
  follow `readNumericInput` (above), which has the same rule.
- **Checkboxes are the exception, because an unticked box is absent too.** An absent boolean is `false` and an
  absent multiselect is `[]`, so a hidden checkbox field would be cleared on every save. Today `getFieldRules` hides
  none, and `deed-poll-validation.test.ts` fails if a rule ever hides a boolean or multiselect for any type, migrated
  or not, published or not. A rule that needs to hide one first needs a different way to tell "unticked" from "not
  rendered".
- **A nullable boolean is Yes / No radios, not a checkbox** (review finding R07; plan
  `docs/plans/completed/20261020-r07-r08-edit-form-input-shapes.md`). A checkbox has two states and `inPerson` has three:
  api types it `["boolean", "null"]`, and as a checkbox an unanswered question read as unticked, so every save of the
  Application tab turned "not answered" into "No". `nullable: true` on the `FieldDef` renders it as radios with
  neither selected for `null`; nothing selected is absent and leaves the stored value alone, Yes sends `"true"` and
  No `"false"`. `form-fields.test.ts` pins which booleans are nullable to `openapi.json`, so a contract change
  fails there. `retainPermanently` is a plain `boolean` and stays a checkbox. This is not required-field
  enforcement: an unanswered question may stay unanswered, and "required" is api's rule.
- **A value the rendered form could not have sent is a field error and no write** (review finding R08, same plan).
  `readFieldInput` (`libs/deed-poll/src/deed-poll/form-input.ts`) is the one parser per kind, shared by
  `collectFormErrors` and `buildUpdatePatch` as `readNumericInput` is for numbers, and reads each field as absent,
  valid or invalid. What each kind may send: a text input or textarea one string (trimmed); a select one string, exactly `""` or one of its `enumOptions` values (not trimmed); each date part
  one string; a checkbox `"true"` (or a browser's default `"on"`) when ticked and nothing when not; Yes / No radios
  `"true"`, `"false"` or nothing; a multiselect zero or more strings, each exactly equal to one of its `enumOptions`
  values, none repeated. Anything else (an array or object from a repeated or bracketed name, `"TRUE"`, a member such
  as `"1e0"`, `"0x2"`, `" 3 "`, `""`, `"2.5"`, one outside the option set or one sent twice, a select value such as `"NotAStatus"`) is refused by `collectFormErrors` in field order
  before any write, and `buildUpdatePatch` throws `InvalidInputError` on the same input. It used to be coerced into
  a clear, a first element or `false`. Nothing ticked still clears a multiselect. A refused field redraws from the
  stored record rather than as sent, except a mistyped number or a textarea string, which redraw as typed. The messages are
  English-only domain strings like the numeric ones and add nothing to `yarn welsh:check`. The date-part rule is
  `readDateInput`, which `collectDateErrors` uses, so the new-case form's date received and the query builder's date
  rows refuse a repeated or bracketed part the same way rather than reading it as blank.
- **The minor-only fields and the Gazette notice date are cleared by api, not here.** The old behaviour cleared them
  only by accident. api's update applies `applyGazetteGate` and `applyMinorGate` to the merged record
  (`DeedPollService.java` around lines 410-415 on api `origin/master` `554fe49`), and the mock's `patchCase` applies
  the same two (`writeGates`), so a local save behaves as api's does. The fields a Deed of Relinquishment hides (old
  names, marital status, nationality) are cleared by nobody, and no rule says they should be. If a clear is ever
  needed here, call the gate function explicitly, never through absent-means-null.
- **Checked state is computed in the view model, never in the template.** `decorate()` in
  `libs/deed-poll/src/deed-poll/edit-view.ts` sets `checked` on a boolean field and on each multiselect option. It
  reads stored values (`true`, numbers) and replayed ones (`"true"`/`"on"`, strings) through `checkbox-input.ts`, and
  sets `answer` (`true`, `false` or `null`) on a nullable boolean. A replayed value reaches it only once
  `readFieldInput` has accepted it, so it reads a box the way the patch does. `edit.njk` reads only those flags. A template that compares raw values redraws every ticked box unticked on
  a replay, and the corrected resubmit then clears them.
- **A textarea's advertised `maxlength` is also its enforced limit** (review finding R15; plan
  `docs/plans/completed/20261022-r12-r15-gtm-off-and-input-gaps.md`). `TEXTAREA_MAX_LENGTH` (2,000, in `libs/deed-poll/src/deed-poll/form-fields.ts`) is the one constant:
  `[tab].ts` passes it to `edit.njk` as `textareaMaxLength`, and `readFieldInput` reads a textarea whose trimmed text
  is longer as invalid (`too-long`), so `collectFormErrors` refuses it in field order and `buildUpdatePatch` throws.
  It counts `string.length` (UTF-16 code units) with a submitted CRLF counted once, because that is what the
  browser's `maxlength` and character count measure before the form turns each line break into CRLF, so text a
  browser accepts is never refused. api stores the three textareas as unbounded `text`; a longer legacy value is
  refused on its next save with the field error and redrawn as typed for the caseworker to shorten, never cleared.
  Do not restate the number in a page or template.
- **A locked field redraws from the stored record.** A non-admin's privacy select is rendered disabled, so it is
  never in the body; replaying it would redraw it blank. Read-only fields are excluded from the replay for the same
  reason, and so is any other field the body does not carry, by the same absence test as the patch: drawn empty, a
  field whose rule changed between render and redraw would be cleared by the corrected resubmit.
  `src/case-edit-untouched-fields.test.ts` drives the real handler and the real `edit.njk`, reads the
  rendered page back as the form a browser would submit, and pins both round trips.

# Agent instructions

Claude must follow these instructions strictly when contributing code. Rules and conventions are mandatory and must be adhered to without exception. After implementing code, Claude must review it to ensure full compliance with these guidelines.

## Rules

- **TypeScript**: Strict mode enabled, no `any` types
- **Formatting**: Use Biome (`yarn format` before commits)
- **Linting**: Fix all Biome warnings (`yarn lint` or `yarn lint:fix`)
- **Module System**: Use ES modules exclusively - `"type": "module"` is set in package.json
- **Hooks**: If hooks report failures, Claude must investigate and resolve them immediately
- **No CommonJS**: Use `import`/`export`, never `require()`/`module.exports`
- **Pinned dependencies**: Specific versions only (`"express": "5.1.0"`) - except peer dependencies
- **Tests**: Write tests for all new features and bug fixes. Aim for >90% code coverage
- **Colocate tests** with the code they test (e.g. `libs/deed-poll/src/notes/service.test.ts` next to `libs/deed-poll/src/notes/service.ts`)
- **Encapsulation**: Do not expose internal functions in order to test them

## Conventions

**Module Ordering**:
- consts outside the scope of a function should be at the top (e.g. `const COOKIE_NAME = "cookie_name";`)
- Exported functions should next
- Other functions should be ordered in the order they are used
- Interfaces and types should be at the bottom

**Domain driven folder structure**:
- Group by feature (e.g. `merge-request/`, `data-sources/`)
- Do not group by type (e.g. `models/`, `controllers/`, `services/`)
- Do not create generic folders (e.g. `utils/`, `helpers/`)

**Keep types with the code that uses them**:
- Do not create a types.ts file
- Types should be in the same file as the code that uses them

**Comments**:
- Use comments to explain why code exists, not what it does
- Keep comments minimal and reference documentation or specifications when possible

**Tests**:
- Use descriptive test names that explain the behavior being tested
- Follow Arrange-Act-Assert pattern in tests for clarity
- Write Playwright tests for user journeys in the `e2e-tests/tests/` folder

### Naming Conventions

Follow these strict naming conventions throughout the project:

### 1. Wire Fields
- api is Spring with Jackson's defaults, so **the wire is camelCase** and nothing is renamed at the
  boundary: `caseNumber`, `createdAt`. The adapter's domain types are aliases of the wire types rather than
  restatements of them, so a field named differently here would be a divergence to fix, not a style choice
- Database naming conventions are api's business, not this repo's. There is no schema here to name

### 2. TypeScript Variables
- Use camelCase: `userId`, `caseDetails`, `documentId`
- Booleans with `is/has/can`: `isActive`, `hasAccess`, `canEdit`

### 3. Classes and Interfaces
- Use PascalCase: `UserService`, `CaseRepository`
- NO `I` prefix: `UserRepository` not `IUserRepository`

### 4. Constants
- Use SCREAMING_SNAKE_CASE: `MAX_FILE_SIZE`, `DEFAULT_TIMEOUT`

### 5. Files and Directories
- Use kebab-case: `user-service.ts`, `case-management/`

### 6. API Endpoints
- This app exposes **no JSON API** — `apps/api` was deleted with the data access layer, and what is left
  serves pages. The endpoints it *calls* are api's, and their shape is api's decision: read
  `libs/deed-poll-api-client/openapi.json`, do not invent a path

### 7. Package Names
- Use @hmcts scope: `@hmcts/auth`, `@hmcts/case-management`

### 8. Module Ordering
- consts outside the scope of a function should be at the top (e.g. `const COOKIE_NAME = "cookie_name";`)
- Exported functions should next
- Other functions should be ordered in the order they are used
- Interfaces and types should be at the bottom

## Principles

* **YAGNI**: You Aren't Gonna Need It - Don't add speculative functionality or features. Always take the simplest approach. 
* **Functional style** favour a simple functional approach. Don't use a class unless you have shared state
* **KISS**: Keep It Simple, Stupid - Avoid unnecessary complexity. Write code that is easy to understand and maintain.
* **Immutable**: Data should be immutable by default. Use const and avoid mutations to ensure predictable state.
* **Side Effects**: Functions should have no side effects. Avoid modifying external state or relying on mutable data.

## Performance Considerations

- **One api call per thing a page needs, and no more.** A case's witnesses and documents arrive inside
  `GET /caseworker/cases/{id}`, so re-reading them is a second round trip for an answer already held — **but
  check the payload before assuming one carried it.** A case's *referrals* are not on it, so the referrals tab
  is a justified second call, made alongside the case (`src/pages/deed-polls/[id].ts`). The rule forbids
  re-reading what the first call already answered, not calling for something it never held
- **A second call for one panel must not be able to lose the page.** `[id].ts` reads the case, its
  referrals and its emails with `Promise.allSettled`, not `Promise.all`: the case read stays fatal, the referrals
  read degrades to `unavailableReferralsView()` and a log line. The field rules need only the case, so they are
  chained off the case promise inside the same `allSettled` rather than awaited after it, which would make them
  wait for the panels too (review finding E05, `docs/plans/completed/20261020-e05-case-detail-concurrency.md`; the
  `read scheduling` tests in `[id].test.ts` pin the order). `client.ts` classifies by status, so under
  `Promise.all` a referrals 404 rendered "Page not found" for a case that exists, a 5xx the 500 page, and a 403
  the 404 template — three disguises for a failure the adapter itself calls "try again shortly". The test for
  which way a given call goes is **load-bearing versus additive**: `findDeedPoll` is the case and
  `getCaseFieldRules` decides which fields exist at all, so both stay fatal. The degraded state must be
  distinguishable from an empty one — see `unavailableReferralsView`'s docblock for why. **And what does not
  depend on the degraded call must render outside every branch of it**: the Referrals panel's "Previous system
  referral information" snapshot comes off the case, so nesting it inside the live-history branch would let a
  failed referrals read hide a historical record that was never at risk
- **The list page is the same rule with a different mechanism.** `src/pages/deed-polls/index.ts` starts its additive calls — the saved-query nav, the returned-for-action and awaiting-confirmation
  counts, and the Delivery Manager-only Gazette count — *before* the list read and awaits each inside a helper that catches everything, logs, and returns a sentinel
  (`[]`, `null`); only the list read is fatal. Reach for that shape on a page with one load-bearing call rather
  than `Promise.allSettled`, which is `[id].ts`'s answer to two load-bearing reads beside two additive ones. `worklistCount(name, read)` is the generalised
  degrade-and-log helper, and the counts are separate reads on purpose: a caseworker whose confirmation count
  failed must still be told about a returned direction
- **A log is not a way of telling the caseworker.** Every degraded state must be distinguishable from an empty
  one *on the page*: a silently absent count banner reads as "nothing needs action", so each worklist count
  carries its `null` through as its own state and the page says the number could not be loaded. Two model keys per
  count rather than one shared list, so neither count's failure changes how the other renders. Log it as
  well, for whoever is asked why — but the log answers an engineer's question, not the caseworker's. An earlier
  version of this rule offered the log line *as* the resolution, which was circular: it asserted the states were
  distinguishable while leaving the two renderings identical
- Ask api to filter, sort and page. It resolves a filter key; do not fetch a list and narrow it here
- Consider caching for expensive computations
- Every call carries an `AbortSignal.timeout`, so a slow api degrades pages rather than hanging them

## Security Best Practices

- Validate all user inputs
- **Never assert an identity api has not verified.** Service functions take `{ accessToken }` and nothing
  else — api derives the audit author and the admin flag from the token
- Implement proper authentication/authorization
- Store sensitive data encrypted
- Follow OWASP guidelines for web security

## Debugging Tips

1. **Module Loading**: Check imports in src/app.ts
2. **api Issues**: check `yarn mock:api` is up on 3200, or `DEED_POLL_API_URL` if it is not the mock. A
   `deed-poll-api call failed (unavailable)` on the 500 page means the adapter could not reach it
3. **Run commands from the root directory**: Run yarn test etc from the root directory

## Communication Style

Be direct and straightforward. No cheerleading phrases like "that's absolutely right" or "great question." Tell the user when ideas are flawed, incomplete, or poorly thought through. Focus on practical problems and realistic solutions rather than being overly positive or encouraging.

Challenge assumptions, point out potential issues, and ask questions about implementation, scalability, and real-world viability. If something won't work, say so directly and explain why it has problems rather than just dismissing it.