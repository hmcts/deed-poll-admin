# HMCTS Monorepo AI Development Guide

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
```

There are **no database commands**, and the `yarn db:*` family that used to be listed here is gone rather
than renamed. See "No data access layer" below.

## Project Structure

```
deed-poll-admin/
├── apps/                       # Deployable applications
│   ├── crons/                  # Cron jobs
│   └── web/                    # Web frontend (Express 5.x + Nunjucks)
├── libs/                       # Modular packages
│   ├── cloud-native-platform/  # Cloud Native Platform features
│   ├── deed-poll/              # The case domain — services, validation, view models
│   ├── deed-poll-api-client/   # The single adapter onto deed-poll-api, plus its in-memory mock
│   ├── express-govuk-starter/  # GOV.UK Frontend integration
│   ├── simple-router/          # Simple Router features
│   └── [your-module]/          # Your feature modules
│       └── src/
│           └── [domain]/       # Reusable functions consumed by apps
├── e2e-tests/                  # End-to-end tests (Playwright)
├── docs/                       # Documentation and ADRs
├── helm/                       # Helm charts for Kubernetes deployment
└── package.json                # Root configuration
```

## No data access layer

**This repo is a presentation layer and owns no database.** Every read and write of case data goes to
[`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) over HTTP. Prisma, the pg pool, the
migrations, `apps/postgres`, `apps/api` and `libs/postgres-prisma` were all deleted — see
`docs/plans/02-dal-cutover-to-api.md` for what moved and why. Consequences worth knowing before writing
any query-shaped code:

- **`libs/deed-poll-api-client` is the only thing that speaks HTTP to api**, and it never throws: it
  returns `ApiResult<T>`, a discriminated union, so an unreachable api is a state a page renders rather
  than a 500. Its wire types and its mock are deliberately not exported from the package index.
- **`libs/deed-poll/src/api/deed-poll-api.ts` is the only place that knows where api is.** `callApi` turns
  a failed `ApiResult` into the domain errors `apps/web/src/errors.ts` already renders. No page sees a base
  URL, and every service function takes a `Caller` — `{ accessToken }` — because api derives both the audit
  author and the admin status from the token.
- **api must be reachable to run anything.** `yarn dev` starts the in-memory mock alongside the app; the
  unit suite drives the same mock in process. Nothing depends on a running Java service, and nothing
  should.
- **`DEED_POLL_API_URL`** is the base URL, defaulting to the mock at `http://localhost:3200`. Deployed
  environments set it in `apps/web/helm/values.yaml`.

## Deployment and sessions

Three facts that are easy to get wrong from the code alone, and expensive to get wrong:

- **CI/CD is the Jenkins CNP pipeline**, `Jenkinsfile_CNP` at the root — `withPipeline("nodejs", "deed-poll",
  "admin")`. There are **no GitHub Actions workflows and none should be added**: `.github/workflows/` was
  deleted in full and `.github/renovate.json` is all that is left under `.github/` that the platform reads.
  The pipeline's test stage runs `yarn test`, `yarn test:coverage` **and** `yarn test:a11y`, and fails on a
  missing script — so do not delete any of the three. See `docs/PIPELINES.md`, which also lists the six
  things still blocking a green deploy.
- **This repo owns no Terraform.** The resource group, Key Vault, App Insights and Redis are all in
  [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra). **Do not create an `infrastructure/`
  directory here.** The Postgres that root also provisions is `deed-poll-api`'s now, not this app's.
- **Sessions are in Redis**, via `@hmcts-cft/express-session-redis` and `REDIS_URL` — and they are the one
  piece of state this app still holds locally, deliberately. The reasoning is at the call site in
  `apps/web/src/app.ts`: a session is transport state, and putting it behind api would invert
  authorisation. Local Redis comes from `docker compose`, so `yarn dev` needs Docker running.
  `libs/express-session-postgres` is still on disk and still a dependency of `apps/web` deliberately — it
  is template-provided and unwiring it invites a re-scaffold conflict — but nothing imports it, and a
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
- This app exposes **no JSON API** — `apps/api` was deleted with the data access layer, and `apps/web`
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
  `GET /caseworker/cases/{id}`, so re-reading them is a second round trip for an answer already held
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

1. **Module Loading**: Check imports in apps/web/src/app.ts
2. **api Issues**: check `yarn mock:api` is up on 3200, or `DEED_POLL_API_URL` if it is not the mock. A
   `deed-poll-api call failed (unavailable)` on the 500 page means the adapter could not reach it
3. **Run commands from the root directory**: Run yarn test etc from the root directory

## Communication Style

Be direct and straightforward. No cheerleading phrases like "that's absolutely right" or "great question." Tell the user when ideas are flawed, incomplete, or poorly thought through. Focus on practical problems and realistic solutions rather than being overly positive or encouraging.

Challenge assumptions, point out potential issues, and ask questions about implementation, scalability, and real-world viability. If something won't work, say so directly and explain why it has problems rather than just dismissing it.