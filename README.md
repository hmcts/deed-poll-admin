# Deed Poll Admin

Admin service for HMCTS deed poll applications, built with Express.js, TypeScript and the GOV.UK Design System.

## 🚀 Overview

This monorepo contains the apps, libraries, and infrastructure for the Deed Poll Admin service. It was scaffolded from
[hmcts/expressjs-monorepo-template](https://github.com/hmcts/expressjs-monorepo-template); the `libs/` packages are
vendored copies of that template's shared libraries, kept private to this repo.

**This service owns no data access layer.** Every read and write of case data goes to
[`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) over HTTP, through the single adapter in
`libs/deed-poll-api-client`. Prisma, the pg pool, the migrations, `apps/api` and `apps/postgres` are gone — see
[`docs/plans/02-dal-cutover-to-api.md`](docs/plans/02-dal-cutover-to-api.md). Sessions are the one piece of state
still held locally, in Redis (`@hmcts-cft/express-session-redis`), for the reasons recorded at the call site in
`apps/web/src/app.ts`. So this service depends on api and on Redis, and its readiness check names both.

api is not deployed yet, and nothing here waits for it: `libs/deed-poll-api-client/src/mock` implements the
contract in memory, `yarn dev` starts it alongside the app, and the unit suite drives it in process.

## Deployment

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

### Monorepo Architecture
- Single repository for multiple applications (e.g. multiple frontends sharing common code, APIs or libraries)
- Workspace-based structure with Yarn workspaces
- Shared libraries for common functionality
- Testing with Vitest and Playwright
- Helm charts for Kubernetes deployment
- Jenkins CNP CI/CD pipeline (`Jenkinsfile_CNP`)
- Biome for fast linting and formatting

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
│           ├── [domain]/       # Domain functions consumed by the apps
│           ├── locales/        # Translations (loaded by govuk-starter)
│           └── assets/         # Module assets (compiled by vite)
├── e2e-tests/                  # End-to-end tests (Playwright)
├── docs/                       # Documentation and ADRs
├── helm/                       # Helm charts for Kubernetes deployment
└── package.json                # Root configuration
```

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
| Redis | localhost:6379 | Session store, from `docker compose`. Overridden by `REDIS_URL`; the default is `redis://localhost:6379` |
| IDAM simulator | http://localhost:5556 | Local OIDC issuer for the login flow. Build the image first with `yarn idam:build`, then seed users with `yarn idam:users` |


## 📦 Development

### Available Commands

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
yarn mock:api                   # The in-memory api, on port 3200 (yarn dev starts it too)
```

There are no database commands: this repo has no database.

### Shared libraries

The `libs/` packages under the `@hmcts-cft` scope are vendored copies of
[hmcts/expressjs-monorepo-template](https://github.com/hmcts/expressjs-monorepo-template)'s shared libraries. They are
marked `private` here: this repo consumes them via `workspace:*` and must not publish them to the shared HMCTS Azure
Artifacts `hmcts-lib` feed, which the template owns.

To pick up an upstream fix, port the change from the template repo rather than editing and republishing.

### Creating a New Feature Module

Feature libs under `libs/` hold **pure domain logic** — services, validation, view models, navigation. Pages and assets live in the consuming app (`apps/web/src/pages/`, `apps/web/src/assets/`). Anything that reads or writes case data goes through `libs/deed-poll-api-client`; there is no query layer to write. There is no per-module registration metadata; apps import named functions directly.

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
// apps/web/package.json
"dependencies": {
  "@hmcts/my-feature": "workspace:*"
}
```
Then run `yarn install` from the repo root.

7. **Use it from the app** with named imports:
```typescript
// apps/web/src/pages/my-feature/new.ts
import { createMyFeature } from "@hmcts/my-feature";
import { callerFromRequest } from "../../auth/current-user.js";

export const POST = async (req, res) => {
  const created = await createMyFeature(req.body, callerFromRequest(req));
  res.redirect(`/my-feature/${created.id}`);
};
```

That's it — no further wiring. `turbo run dev` picks the new lib up automatically and runs its `tsc --watch`; the apps' nodemon watches `../../libs/*/dist` so they restart whenever the lib emits.

#### If the feature needs to store something

**It cannot store it here.** There is no database in this repo, so a feature that persists anything needs the
operation in [`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) first — then in
`libs/deed-poll-api-client/openapi.json`, `client.ts` and the mock, in that order, with `contract.test.ts`
pinning the three together. See [`.claude/rules/backend.md`](.claude/rules/backend.md).

#### If the feature needs pages or static assets

Pages, templates, and assets are **app-scoped**, not lib-scoped:
- **Web pages** — `apps/web/src/pages/my-feature/(group)/page.{ts,njk}`. `simple-router` discovers them; `(group)` segments don't appear in the URL.
- **SCSS/JS bundles** — `apps/web/src/assets/css/my-feature.scss`, `apps/web/src/assets/js/my-feature.ts`. Vite picks them up from `apps/web/src/assets/`.

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
