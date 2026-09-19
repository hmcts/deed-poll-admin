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
yarn mock:api                   # The in-memory api the pages develop against, on port 3200
yarn mock:seed                  # Seed the running mock: ~32 cases across every tab plus nine referrals, four
                                # of them Decided so the dashboard's returned-for-action count is non-zero.
                                # Resets the store unless given `--keep`, and exits non-zero on a mismatch
```

The mock starts **empty**, so a page whose data comes from a list — the case list, its filter tabs, the
dashboard's count — shows nothing until `yarn mock:seed` has run. An empty store is indistinguishable from a
broken feature, which is why the seeder reads its own numbers back (`scripts/seed-local-cases.mjs`).

There are **no database commands**, and the `yarn db:*` family that used to be listed here is gone rather
than renamed. See "No data access layer" below.

## Project Structure

```
deed-poll-admin/
├── src/                        # THE application (Express 5.x + Nunjucks) — the root package
│   ├── pages/                  # File-based routes, discovered by simple-router
│   ├── assets/                 # SCSS/TS bundles, compiled by vite
│   ├── auth/                   # IDAM OIDC: login, session, require-auth
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
  open PR means a collision or a flush in one is felt in the rest — the reasoning is in `charts/…/Chart.yaml`.
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
  distinguishable from an empty one — see `unavailableReferralsView`'s docblock for why
- **The list page is the same rule with a different mechanism.** `src/pages/deed-polls/index.ts` starts its two
  additive calls — the saved-query nav and the returned-for-action count — *before* the list read and awaits each
  inside a helper that catches everything, logs, and returns a sentinel (`[]`, `null`); only the list read is
  fatal. Reach for that shape on a page with one load-bearing call rather than `Promise.allSettled`, which is
  `[id].ts`'s answer to two. Both degraded states must still be distinguishable from empty ones: a silently
  absent count banner reads as "nothing needs action", which is why it is logged
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