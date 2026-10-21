# Deed Poll Admin

Admin service for HMCTS deed poll applications, built with Express.js, TypeScript and the GOV.UK Design System.

## 🚀 Overview

This repo is **one deployable**: the application is the root package, in `src/`. It was scaffolded from
[hmcts/expressjs-monorepo-template](https://github.com/hmcts/expressjs-monorepo-template); the `libs/` packages are
vendored copies of that template's shared libraries, kept private to this repo, and are still a Yarn workspace so
that a future re-scaffold stays tractable. The four-app layout that came with the template is gone — see
[`docs/plans/03-collapse-to-single-app.md`](docs/plans/03-collapse-to-single-app.md).

**This service owns no data access layer.** Every read and write of case data goes to
[`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) over HTTP, through the single adapter in
`libs/deed-poll-api-client`. Prisma, the pg pool, the migrations, `apps/api` and `apps/postgres` are gone — see
[`docs/plans/completed/02-dal-cutover-to-api.md`](docs/plans/completed/02-dal-cutover-to-api.md). Sessions are the
one piece of state still held locally, in Redis (`@hmcts-cft/express-session-redis`), for the reasons recorded at
the call site in `src/app.ts`. So this service depends on api and on Redis, and its readiness check names both.

api is not deployed yet, and nothing here waits for it: `libs/deed-poll-api-client/src/mock` implements the
contract in memory, `yarn dev` starts it alongside the app, and the unit suite drives it in process.

## Deployment

Document upload policy (2026-10-16): PDF, JPEG, PNG, TIFF and Word DOCX are accepted declared types;
legacy binary Word `.doc` is refused. Admin filters declared MIME types only: authoritative content checks
belong to the API. The API content-policy change rejects mismatched signatures, encrypted PDF/DOCX and the
specified active-content PDF/Word features. Deploy the coordinated API change before relying on those checks.
Mock content-check fidelity remains Plan 05 Task 9; no malware-scanning claim is made by this UI change.

This repo deploys through the **Jenkins CNP pipeline**: `Jenkinsfile_CNP` at the root, `withPipeline("nodejs",
"deed-poll", "admin")`. There is no GitHub Actions pipeline — `.github/workflows/` was deleted in full, and
`.github/renovate.json` is the only thing left under `.github/` that the platform reads.

This repo also owns **no Terraform**. The resource group, Key Vault, App Insights and Redis are all
provisioned by [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra), the product's shared root, which
`deed-poll-web` and `deed-poll-api` read from too. Do not add an `infrastructure/` directory here. The Postgres that
root also provisions belongs to `deed-poll-api`; this app holds no database credential.

- The reasoning behind both decisions, and the four others taken with them:
  [`.business_context/DEED_POLL_INFRA_PLAN.md`](.business_context/DEED_POLL_INFRA_PLAN.md)
- What the pipeline runs, and what is still outstanding before a deploy can go green:
  [`docs/PIPELINES.md`](docs/PIPELINES.md)
- Charts, secrets, environments and troubleshooting: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## ✨ Key Features

### Cloud Native Platform
- **Health Checks**: Configurable health endpoints with readiness and liveness probes for Kubernetes deployments
- **Properties Volume**: Secure configuration management through mounted volumes with automatic environment variable injection
- **Azure Integration**: Built-in support for Azure Key Vault secrets management and properties volume mounting
- **Application Insights**: Comprehensive monitoring with Azure Application Insights including custom metrics and distributed tracing

### Express GOV.UK Starter for frontends
- **GOV.UK Design System**: Fully integrated GOV.UK Frontend with Nunjucks templates and automatic asset compilation
- **Internationalization**: Welsh language support with locale middleware and translation management system
- **Security Headers**: Pre-configured Helmet.js with CSP, HSTS, and nonce-based script protection
- **Asset Pipeline**: Vite-powered asset compilation with SCSS support and production optimization
- **Cookie Management**: Built-in support for cookie consent
- **Session Handling**: Session management backed by Redis

### Simple Router  
A lightweight file-system router for Express applications, inspired by Next.js routing.

- **File-based Routing**: Maps files in directories to Express routes automatically
- **Dynamic Parameters**: Support for dynamic route segments using `[param]` syntax (e.g., `/users/[id]`)
- **HTTP Method Exports**: Export handlers for any HTTP method (GET, POST, PUT, DELETE, etc.)
- **Middleware Support**: Single handlers or arrays of middleware for complex request pipelines
- **Multiple Mount Points**: Mount different directories with different URL prefixes
- **Zero Dependencies**: Lightweight implementation with no external dependencies

### One application, with libraries
- One deployable, one image, one Helm chart, one Jenkins component
- `libs/*` are Yarn workspaces holding domain logic the application imports
- Testing with Vitest (co-located) and Playwright (`e2e-tests/`)
- Jenkins CNP CI/CD pipeline (`Jenkinsfile_CNP`)
- Biome for fast linting and formatting

## Project Structure

```
deed-poll-admin/
├── src/                        # THE application — Express 5.x + Nunjucks
│   ├── pages/                  # File-based page routes (auto-discovered)
│   ├── assets/                 # SCSS/TS bundles, compiled by vite
│   ├── auth/                   # IDAM OIDC: login, session, require-auth
│   ├── locales/                # App-level translations
│   └── app.ts, server.ts       # createApp(), and the entrypoint that loads secrets first
├── config/                     # `config` defaults + custom-environment-variables
├── libs/                       # Modular packages
│   ├── cloud-native-platform/  # Cloud Native Platform features
│   ├── deed-poll/              # The case domain — services, validation, view models
│   ├── deed-poll-api-client/   # The single adapter onto deed-poll-api, plus its in-memory mock
│   ├── express-govuk-starter/  # GOV.UK Frontend integration
│   ├── express-session-redis/  # The session store the app wires up
│   ├── simple-router/          # Simple Router features
│   └── [your-module]/          # Your feature modules
│       └── src/
│           ├── [domain]/       # Domain functions consumed by the app
│           ├── locales/        # Translations (loaded by govuk-starter)
│           └── assets/         # Module assets (compiled by vite)
├── charts/deed-poll-admin/     # The one Helm chart, where the CNP pipeline reads it
├── e2e-tests/                  # End-to-end tests (Playwright)
├── docs/                       # Documentation and ADRs
├── Dockerfile                  # The one image the pipeline builds
└── package.json                # The application's manifest AND the workspace root
```

Because the application is the root package, Turbo cannot run its scripts under an ordinary task name — a root
task has to be called `//#<task>`. Hence `//#build:app`, `//#test:app` and `//#dev:app`, with `yarn build`,
`yarn test` and `yarn dev` orchestrating both halves (`turbo build build:app`). The app's own compiler settings
are in `tsconfig.app.json`, not the root `tsconfig.json`.

## 🏁 Getting Started

### Prerequisites

- Node.js 22+
- Yarn 4+
- Docker — **required**, not optional. `yarn dev` runs `docker compose up -d` first, which serves Redis and
  the IDAM simulator. The web app connects to Redis during startup and refuses to start on a missing IDAM
  issuer, so it does not come up without them. There is no Postgres service: `yarn dev` also starts the api
  mock, which keeps its fixtures in process

### Quick Setup

```bash
# Install dependencies
yarn install

# Run development server
yarn dev
```

### Services

| Service | URL | Description |
|---------|-----|-------------|
| Web Application | http://localhost:3000 | Main web interface with GOV.UK styling |
| deed-poll-api mock | http://localhost:3200 | The in-memory api the pages develop against (`yarn mock:api`). Overridden by `DEED_POLL_API_URL` |
| Redis | localhost:6379 | Session store and rate-limit counters, from `docker compose`. Overridden by `REDIS_URL`; the default is `redis://localhost:6379` |
| IDAM simulator | http://localhost:5556 | Local OIDC issuer for the login flow. Build the image first with `yarn idam:build`, then seed users with `yarn idam:users` |


## 📦 Development

### Available Commands

```bash
# Development
yarn dev                        # Start all services concurrently

# Testing
yarn test                       # The app's tests and every lib's (turbo test test:app)
yarn test:e2e                   # Playwright E2E tests
yarn test:coverage              # Generate coverage report

# Code Quality
yarn lint:fix                    # Run Biome linter
yarn format                     # Format code with Biome

# deed-poll-api
yarn mock:api                   # The in-memory api, on port 3200 (yarn dev starts it too)
yarn mock:seed                  # Fill the running mock with cases: every tab, a page of results, and nine
                                # referrals (four Decided, so the dashboard's "returned — action needed"
                                # banner is non-zero; two of those also awaiting the applicant's
                                # confirmation, so that banner and tab are non-empty as well). Resets the
                                # store first; `--keep` adds to it
```

The mock starts **empty**, so `yarn mock:seed` is what makes the list page, its filters and the dashboard's
count show anything at all. An empty store looks the same as a feature that is not working.

Delivery Managers can follow the London Gazette count from the case list to an oldest-enrolled-first,
read-only ready list and paginated send history. History shows the full case count and identifies
truncated reference previews. The ready list links to **London Gazette recipient**, a Delivery Manager-only
settings editor backed by the API. It starts unset, validates one email address, displays the last
change attribution, and requires reloading after a concurrent edit. The court contact mailbox is
not used as a default recipient. Saving settings sends no email. Deploy the API settings contract
and migrations (through API PR #93) before this admin version. The request list and
detail pages show all five outcomes and paged frozen membership, including older batches
above 100 references. Missing legacy facts stay unknown; failed reads are visibly unavailable.
No status page offers a resend control. **Review and select applications** opens the
mandatory five-item checklist: complete it for each application, select the reviewed
cases, check the API-confirmed recipient and adult/minor groups, then explicitly send.
One email contains spreadsheet download links. Changed data invalidates review;
a lost response offers a status check using the original request identity. A send waits at most 20 s
for the API, so a slower one shows as an unknown outcome that the status check recovers. If the request
has already used most of its time before the send, nothing is sent or checked: the page says so and
keeps the same request identity, so trying again cannot send twice. Reviews
belong to the current visit and are not persisted as business sign-off. See
[plan 16](docs/plans/16-gazette-1-ready-list-review-and-send.md).

The seed includes 26 ready cases, cases excluded by the publication/sent-date rules, and 26 frozen
history batches. The newest batch has 101 cases and a sorted 100-reference preview. No email is sent.
`DEED_POLL_API_MOCK_URL=http://localhost:3216 yarn mock:seed` targets an isolated mock;
`--keep` adds to it. The standalone mock uses `http://localhost:5556/o/userinfo` to resolve roles
missing from simulator access tokens; `DEED_POLL_API_MOCK_USERINFO_URL` overrides that endpoint.

For the Gazette browser journeys, run `yarn build` to produce the workspace library exports, start
the local IDAM simulator (`yarn idam:build` if its image is missing, then `docker compose up -d idam`),
and seed it with `yarn idam:users`. Then provide a separate Redis instance on port 6316 (for example,
`docker run --rm -p 6316:6379 redis:8-alpine`). Run `yarn test:gazette` from this repository root.
The suite starts/stops its own app on 3316 and fresh mock on 3216, uses Redis database 1, and refuses
to reuse occupied app/mock ports. All eight journeys sign in through IDAM and include axe checks; the Delivery Manager
read and recipient-settings journeys also check Welsh. The dedicated config keeps the empty-state fixture out of the shared
`yarn test:e2e` suite. It never resets an existing mock. These checks cover ready/history reads, recipient settings (including invalid and stale edits),
all request outcomes and complete legacy membership, with Welsh and axe checks;
the mandatory review/send journey covers all five outcomes, lost responses and duplicate confirmation tabs.

For the session timeout journeys (`yarn test:session`), prepare the same way: `yarn build`, the IDAM simulator
running and seeded with `yarn idam:users` (the simulator holds its users in memory, so seed it again after any
restart), and Redis on 6379 (`docker compose up -d redis`). The suite starts its own app on 3317, with a
330-second idle limit and `SESSION_TIMEOUT_LOGOUT_PATH_REGISTERED=true`, plus a fresh mock on 3217, and uses Redis
database 2. It takes about twelve minutes, because it waits on a real clock: the warning opens at 210 seconds,
"Stay signed in" extends the session, and the session then runs out to `/session-timed-out`, with axe checks on
the warning and the timed-out page. A second journey, without JavaScript, shows the server still ends the session.
These local checks use the mock and never send a real Notify email.

There are no database commands: this repo has no database.

### Representative data in non-production environments

`yarn seed:cases` previews or creates 30 synthetic cases covering every application state through the real API.
It accepts an explicit non-production environment and API URL, preserves existing cases, and records a resumable journal.
See [the seeding guide](docs/SEED-DATA.md) for credentials, dataset coverage and usage.

### The persona switcher

`yarn dev` puts a red **Dev only — Switch persona** strip at the top of every page, offering *Caseworker*,
*Team leader*, *Delivery Manager* and *Judge*. Pressing one signs you in as that persona's real IDAM user, so one
sitting covers the caseworker screens, the staff controls and Gazette and `/judicial/**` without signing out. It
needs `yarn idam:users` to have seeded the simulator, since the personas are four separate fixture accounts.

Team leaders (`caseworker-deedpoll-team-leader`) can override privacy, delete notes/witnesses,
manage shared queries and perform API CCD repair. Delivery Managers (`caseworker-deedpoll-delivery-manager`)
have those capabilities plus Gazette access. Neither role grants judicial access. The temporary legacy
admin role retains Team leader capabilities and cannot use Gazette; its seeded account is only for
migration-refusal checks. Ordinary caseworker and judge permissions are unchanged.

The app reads none of these roles. It asks api's `GET /me` for the caller's `staff`, `judicial` and
`capabilities` at sign-in and after each token refresh, stores that answer on the session and gates every
control on it. If `/me` fails at sign-in the user is signed in with no access; on refresh the previous answer
is kept. Locally, the mock works `/me` out from the token's roles with the same table as api.

Before deploying, ensure API #105 (`GET /me`) is serving throughout the target environment and both new IDAM roles
and CCD reader mappings exist. A changed role assignment takes effect within one token lifetime, not at next
login. See the [role-change plan](docs/plans/20261009-team-leader-delivery-manager.md) for the handoff, and
[the `/me` plan](docs/plans/20261015-admin-me-capabilities.md).

It is a **privilege-escalation control by design** — it obtains a genuine token for another user — so it is
gated twice, and neither gate is `NODE_ENV` (every deployed pod runs `NODE_ENV=production`, AAT included):

| Variable | What it does |
|---|---|
| `PERSONA_SWITCHER_ENABLED` | Must be exactly `true`. Off in `config/default.json` and in the chart's `values.yaml`, which a production deploy inherits; only `values.aat.template.yaml` turns it on. Preview deliberately does not (OWASP M1) |
| `ENVIRONMENT_NAME` | Must name one of `development`, `test`, `aat`. The chart renders it from `global.environment`; `yarn dev` exports `development` and the test suite sets `test`. **Unset matches nothing**, so a deploy that loses it gets no switcher rather than falling back to a permitted name |

Both must agree, or nothing is rendered and `POST /switch-persona` is a 404. See
`src/auth/persona-switcher.ts` for the full reasoning and `docs/plans/completed/dev-persona-switcher.md`
for the decisions.

### Abuse limits

Search, email preview, email send and upload are limited per IDAM subject in `src/rate-limit/`; api is the
authoritative control and this limiter only spares a pod the work. Counters live in the session Redis and a Redis
error lets the request through.

| Variable | What it does |
|---|---|
| `RATE_LIMIT_MODE` | `off`, `observe` or `enforce`. Defaults to `observe`, which logs a `rate_limit …` line for what `enforce` would refuse and refuses nothing |
| `RATE_LIMIT_<BUCKET>_LIMIT`, `RATE_LIMIT_<BUCKET>_WINDOW_SECONDS` | Per-bucket count and fixed window; `<BUCKET>` is `SEARCH`, `EMAIL_PREVIEW`, `EMAIL_SEND` or `UPLOAD`. Defaults mirror api's in `config/default.json` |
| `RATE_LIMIT_UPLOAD_IN_FLIGHT` | Concurrent uploads allowed per pod (default 4); enforced in every mode |

A refusal renders a 429 page with `Retry-After` when the wait is known.

### Shared libraries

The `libs/` packages under the `@hmcts-cft` scope are vendored copies of
[hmcts/expressjs-monorepo-template](https://github.com/hmcts/expressjs-monorepo-template)'s shared libraries. They are
marked `private` here: this repo consumes them via `workspace:*` and must not publish them to the shared HMCTS Azure
Artifacts `hmcts-lib` feed, which the template owns.

To pick up an upstream fix, port the change from the template repo rather than editing and republishing.

### Creating a New Feature Module

Feature libs under `libs/` hold **pure domain logic** — services, validation, view models, navigation. Pages and assets live in the application at the repository root (`src/pages/`, `src/assets/`). Anything that reads or writes case data goes through `libs/deed-poll-api-client`; there is no query layer to write. There is no per-module registration metadata; the app imports named functions directly.

1. **Create the lib**:
```bash
mkdir -p libs/my-feature/src/my-feature
cd libs/my-feature
```

2. **`package.json`**:
```json
{
  "name": "@hmcts/my-feature",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "format": "biome format --write .",
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  },
  "peerDependencies": {
    "express": "^5.1.0"
  }
}
```

3. **`tsconfig.json`**:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "dist", "node_modules"]
}
```

4. **Add a path mapping in the root `tsconfig.json`** — used by IDE/tsserver and by `vitest` (via `vite-tsconfig-paths`) to resolve `@hmcts/my-feature` to `src/` before `dist/` exists:
```json
{
  "compilerOptions": {
    "paths": {
      "@hmcts/my-feature": ["libs/my-feature/src"]
    }
  }
}
```

5. **Write the domain code** under `src/my-feature/` — typically `service.ts`, `schemas.ts`, `validation.ts`, with co-located `*.test.ts` files. Re-export from `src/index.ts`:
```typescript
export * from "./my-feature/service.js";
export * from "./my-feature/schemas.js";
export * from "./my-feature/validation.js";
```

6. **Add the lib as a dependency** of the consuming app:
```jsonc
// package.json — the root one; the application IS the root package
"dependencies": {
  "@hmcts/my-feature": "workspace:*"
}
```
Then run `yarn install` from the repo root.

7. **Use it from the app** with named imports:
```typescript
// src/pages/my-feature/new.ts
import { createMyFeature } from "@hmcts/my-feature";
import { callerFromRequest } from "../../auth/current-user.js";

export const POST = async (req, res) => {
  const created = await createMyFeature(req.body, callerFromRequest(req));
  res.redirect(`/my-feature/${created.id}`);
};
```

That's it — no further wiring. `yarn dev` is `turbo watch dev dev:app`, so the new lib's `tsc --watch` starts automatically and `tsx` restarts the app whenever the lib emits.

#### If the feature needs to store something

**It cannot store it here.** There is no database in this repo, so a feature that persists anything needs the
operation in [`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) first — then in
`libs/deed-poll-api-client/openapi.json`, `client.ts` and the mock, in that order, with `contract.test.ts`
pinning the three together. See [`.claude/rules/backend.md`](.claude/rules/backend.md).

#### If the feature needs pages or static assets

Pages, templates, and assets belong to the application at the root, not to a lib:
- **Web pages** — `src/pages/my-feature/(group)/page.{ts,njk}`. `simple-router` discovers them; `(group)` segments don't appear in the URL.
- **SCSS/JS bundles** — `src/assets/css/my-feature.scss`, `src/assets/js/my-feature.ts`. Vite picks them up from `src/assets/`.

Each handler imports its lib's domain functions directly (`import { … } from "@hmcts/my-feature"`).

## 🧪 Testing Strategy

| Type | Tool | Location | Purpose |
|------|------|----------|---------|
| **Unit Tests** | Vitest | Co-located `*.test.ts` | Business logic validation |
| **E2E Tests** | Playwright | `e2e-tests/` | User journey validation |
| **Accessibility Tests** | Axe-core + Playwright | `e2e-tests/` | WCAG 2.1 AA compliance |

```bash
# Run specific test suites
yarn test                   # Unit tests
yarn test:e2e               # E2E tests
yarn test:coverage          # Coverage report
```

### Running `yarn test:e2e` locally

Needs `docker compose up -d`, plus three things that are easy to lose an hour to:

- **The journeys run against the api mock, not a database.** Playwright's `webServer` is `yarn dev:nowatch`,
  which starts it — so state resets whenever the mock restarts, and a journey that assumes a case another
  spec created will pass alone and fail in parallel.
- **`yarn idam:users` must have been run** against the running simulator. Without the seeded users the
  login page loads and simply never proceeds, which reads as a broken sign-in rather than an unseeded one.
- **Set `REDIS_URL=redis://127.0.0.1:6379` in the devcontainer.** `config/default.json` says
  `redis://localhost:6379`, and here `localhost` resolves to `::1` first while Docker's published port
  binds IPv4 only — so the session store never connects, and the first request to save a session takes the
  web server down before Playwright can start. Not a fault in the app: `redis-cli ping` passes throughout.

## Security

The Jenkins CNP pipeline runs a number of security checks:

- **Dependency Scanning**: `yarn audit` with suppressions, published as a CVE report
- **Container Scanning**: image scanning on push to the ACR
- **SonarQube**: SAST analysis for code quality and security, configured by `sonar-project.properties`

CodeQL was lost in the move off GitHub Actions — it is GitHub-native and has no Jenkins equivalent. That was accepted
deliberately; see [`.business_context/DEED_POLL_INFRA_PLAN.md`](.business_context/DEED_POLL_INFRA_PLAN.md), Decision 3.

## License

MIT
