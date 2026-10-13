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
`DEEDPOLL_ADMIN`. Its independent main-list count is requested only for admins; zero and unavailable
both retain the area link. Ready reads forward only paging and `filter=readyForPublication`, never a
sort or local membership predicate. History preserves API totals and the explicit truncation flag.
The recipient editor at `/deed-polls/gazette/settings` uses API GET/PUT settings,
forwards the original revision on save and preserves input on 400/409. A conflict
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

`yarn test:gazette` runs five browser journeys against a fresh mock on 3216 and this app on 3316,
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
  *beside* the State row (`src/pages/deed-polls/[id].ts`), and a referral is "waiting" by api's two-column
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

**Two personas, one deployable.** A caseworker works `/deed-polls/**`; a judge works `/judicial/**` — the
shared referral pool, one referral, the claim, and the direction flow. Facts that are not derivable from a
single file:

- **`/judicial` is gated on the area, not the page.** `src/app.ts` mounts `requireJudicial()`
  (`src/auth/require-role.ts`) on the `/judicial` prefix, *after* `requireAuth` so an anonymous visitor still
  gets sent to log in rather than refused. A page added under `src/pages/judicial/` is gated because of where
  it lives; `src/app.test.ts` reads that directory off the filesystem and fails if the mount stops covering
  one. **Do not add a per-page role check** — the pages deliberately never ask about the role, which is also
  why no page test can show the boundary.
- **This is a persona boundary, not the data boundary.** Every role rule before it was presentational
  (`canDeleteWitness` hides a button). api gates the same `/judicial/**` routes on the same role, so a
  caseworker who defeated this gate would see a screen of 403s, not a judge's referrals. The gate decides which
  chrome a signed-in user gets.
- **It refuses with `next(new ForbiddenError(...))` and renders nothing.** `src/errors.ts` answers 403 on the
  **404** view, so a guessed judicial URL discloses nothing, and logs the message the gate built — that render
  is the end of the chain, and the starter's handler (the only thing that logs) is never reached.
  `src/pages/errors/403.njk` exists but belongs to the login flow, where the user already knows who they are.
- **`isAdmin` and `isJudicial` are alternatives, not a ladder.** An admin is refused `/judicial/**`. A user may
  hold both, one, or neither.
- **A new role must be added to `KNOWN_ROLES`** (`libs/deed-poll/src/auth/idam-claims.ts`) as well as to `Role`.
  `rolesFrom` filters against that list, so an unlisted role is dropped silently and its holder resolves to no
  roles — it fails closed, and presents as a permissions bug rather than a missing list entry.
- **`/` is where each persona's home is decided, and the only place it can be.** A judge's home is
  `/judicial/referrals`, a caseworker's is `/deed-polls`, and a user holding both lands on the case list.
  `/login`'s `returnTo` fallback is therefore `/` and **not** a concrete list path: the roles do not exist until
  the token has been exchanged, so hard-coding `/deed-polls` there strands every judge on a list api answers
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
  to the translation request until the directory was added. A page whose *second* content pair is named
  `<name>En`/`<name>Cy` is picked up too, under a `<name>.` key prefix.
- **The same silence applies one level down, to a content *shape* the extractor cannot parse.** An unparsed key is
  not reported as unparsed — it is simply absent, and a page whose other twenty keys are present looks complete. All
  three shapes `.claude/rules/frontend.md` documents are handled now (string, nested object, and a **function** that
  interpolates a runtime value), but a fourth would need adding: `const en = (m) => ({ … })`, the whole-object
  function form, is not read, and a page written that way would contribute nothing. Function entries are reported
  one row per sentence (`returnedForActionFor.1`, `.2`) because English needs a singular and a plural where Welsh
  needs more, so which sentence covers which count is a translator briefing rather than a string.

Ordinary caseworkers hold `caseworker-deedpoll` for CCD document READ. Admin and judicial roles also map
to the API's reader profile; no staff persona receives the system role. The AAT IDAM role registration must
land before the updated ordinary-caseworker persona can be created. Existing real accounts need assignment
and a fresh login. UI admin/judicial gates are unchanged.

## The dev persona switcher, and the two patterns it establishes

A tester switches between the caseworker, admin and judicial personas from a strip on every page, by signing in
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
- **A second call for one panel must not be able to lose the page.** `[id].ts` reads the case and its
  referrals with `Promise.allSettled`, not `Promise.all`: the case read stays fatal, the referrals read
  degrades to `unavailableReferralsView()` and a log line. `client.ts` classifies by status, so under
  `Promise.all` a referrals 404 rendered "Page not found" for a case that exists, a 5xx the 500 page, and a 403
  the 404 template — three disguises for a failure the adapter itself calls "try again shortly". The test for
  which way a given call goes is **load-bearing versus additive**: `findDeedPoll` is the case and
  `getCaseFieldRules` decides which fields exist at all, so both stay fatal. The degraded state must be
  distinguishable from an empty one — see `unavailableReferralsView`'s docblock for why. **And what does not
  depend on the degraded call must render outside every branch of it**: the Referrals panel's "Previous system
  referral information" snapshot comes off the case, so nesting it inside the live-history branch would let a
  failed referrals read hide a historical record that was never at risk
- **The list page is the same rule with a different mechanism.** `src/pages/deed-polls/index.ts` starts its additive calls — the saved-query nav, the returned-for-action and awaiting-confirmation
  counts, and the admin-only Gazette count — *before* the list read and awaits each inside a helper that catches everything, logs, and returns a sentinel
  (`[]`, `null`); only the list read is fatal. Reach for that shape on a page with one load-bearing call rather
  than `Promise.allSettled`, which is `[id].ts`'s answer to two. `worklistCount(name, read)` is the generalised
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