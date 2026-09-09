# Architecture Overview

Note that this is an example architecture document for the deed-poll-admin. It should be adapted to fit the specific architecture of your project.

## Executive Summary

The HMCTS Express Monorepo Template is a production-ready, cloud-native application platform designed to deliver accessible, secure, and scalable UK government digital services. Built on Express.js 5.x with TypeScript, it implements the GOV.UK Design System and provides comprehensive tooling for building HMCTS (HM Courts & Tribunals Service) applications.

## System Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│                    (Browser / Mobile Device)                     │
└─────────────────────────────┬────────────────────────────────────┘
                              │ HTTPS
┌─────────────────────────────┴────────────────────────────────────┐
│                      Application Layer                           │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │         Web Frontend (@hmcts/web)                       │     │
│  │  - Express 5.x + Nunjucks                               │     │
│  │  - GOV.UK Design System                                 │     │
│  │  - Port: 3000                                           │     │
│  └──────────────┬──────────────────────────┬───────────────┘     │
│                 │ libs/deed-poll           │ express-session     │
│                 │ libs/deed-poll-api-client│                     │
└─────────────────┼──────────────────────────┼─────────────────────┘
                  │ HTTP, bearer token       │
┌─────────────────┴──────────────┐  ┌────────┴─────────────────────┐
│  deed-poll-api (another repo)  │  │  Redis                       │
│  - Spring Boot                 │  │  - Port: 6379                │
│  - Owns the case data          │  │  - Session store only        │
│  - Owns the database           │  │  - admin-sess: keyspace      │
└────────────────────────────────┘  └──────────────────────────────┘
```

**There is no data layer in this repo.** The database, the migrations and the ORM all moved to
[`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) — see
[`../docs/plans/02-dal-cutover-to-api.md`](plans/02-dal-cutover-to-api.md). What is left here is a
presentation layer plus one session store, and the only state this app owns is the session.

## Monorepo Structure

The project uses Yarn Workspaces with Turborepo for efficient monorepo management:

```
deed-poll-admin/
├── apps/                       # Deployable applications
│   ├── crons/                  # Scheduled jobs (CronJob)
│   └── web/                    # Web frontend application
│       └── src/
│           ├── pages/          # File-based page routes (auto-discovered)
│           └── locales/        # App-level translations
├── libs/                       # Reusable packages
│   ├── cloud-native-platform/  # Azure integration & monitoring
│   ├── deed-poll/              # The case domain: services, validation, view models
│   ├── deed-poll-api-client/   # The adapter onto deed-poll-api, and its in-memory mock
│   ├── express-govuk-starter/  # GOV.UK Design System integration
│   ├── simple-router/          # File-based routing system
│   └── [feature-module]/       # Feature modules
│       └── src/
│           └── [domain]/       # Reusable functions consumed by apps
├── helm/                       # Helm charts
│   └── deed-poll-admin/  # Umbrella chart
├── e2e-tests/                  # Playwright E2E tests
└── docs/                       # Documentation
```

### File-Based Routing

The web application uses Simple Router for automatic route discovery from the `apps/web/src/pages/` directory:

1. **Route Discovery**: All `.ts`/`.js` files under `pages/` are scanned recursively
2. **URL Mapping**:
   - `pages/deed-polls/new.ts` → `/deed-polls/new`
   - `pages/deed-polls/(group)/page.ts` → `/deed-polls/page` (parenthetical dirs are route groups — stripped from URL)
   - `pages/deed-polls/[id]/notes/[noteId]/edit.ts` → `/deed-polls/:id/notes/:noteId/edit`
3. **HTTP Methods**: Files export named functions (`GET`, `POST`) per HTTP method
4. **Views**: Nunjucks templates co-located with controllers; `(group)` directories are added as view paths so templates remain discoverable

## Core Components

### 1. Web Frontend (`apps/web`)

**Purpose**: User-facing web application with GOV.UK Design System

**Key Technologies**:
- Express 5.x server
- Nunjucks templating engine
- GOV.UK Frontend 5.11.2
- Vite for asset bundling
- SCSS for styling
- Redis for session management; `deed-poll-api` over HTTP for case data

**Features**:
- Server-side rendering
- Internationalization (English & Welsh)
- WCAG 2.1 AA accessibility compliance
- Content Security Policy (CSP) with nonces
- Cookie consent management
- Progressive enhancement

**Architecture Decisions**:
- File-based routing using Simple Router
- Page-specific content in controllers
- Shared content in locale files
- Co-located page templates and controllers
- Business logic imported from `libs/` feature modules

### 2. The api client (`libs/deed-poll-api-client`)

**Purpose**: the single adapter onto `deed-poll-api`, and the only code here that speaks HTTP to it

**Key decisions**:
- **It never throws.** Every operation returns `ApiResult<T>` — a discriminated union of `{ ok: true, data }`
  and a classified `{ ok: false, error }` — so an unreachable or refusing api is an ordinary state a page
  can render rather than a 500. This is a caseworker's whole working day: "the backend blinked" must not
  lose their form
- **`openapi.json` is api's published document, not a hand-written contract.** Taken from api commit
  `847933a` and recorded in `SPEC-PROVENANCE.md`; `src/api/contract.test.ts` fails if the adapter and the
  spec disagree, so divergence is a bug in one of them rather than licence to invent
- **The wire types and the mock are not exported from the package index**, deliberately. Nothing above the
  adapter knows api exists
- **Two value conversions happen here and nowhere else**: date-times become `Date` pinned to UTC (api's
  `LocalDateTime` is zoneless, and `new Date()` would read it as local, shifting date-only columns by a
  timezone), and `refundAmount` is a `number`

**The mock (`src/mock/`)**: an in-memory implementation of every operation this app uses, on port 3200.
`yarn dev` and `yarn test:e2e` run against it, and the unit suite drives it in process. api is not deployed
yet and nothing here waits for it.

### 3. The case domain (`libs/deed-poll`)

**Purpose**: the deed-poll model — services, validation, the field-rule matrix, the view models

- **`src/api/deed-poll-api.ts` is the only place that knows where api is.** `callApi` resolves the config
  from `DEED_POLL_API_URL` and turns a classified `ApiResult` failure into a domain error the pages already
  render. `apiConfig` is private to that file, so no page sees a base URL
- **Every service function takes a `Caller` — `{ accessToken }`.** api authenticates each call and derives
  both the audit author and the admin status from the token, so passing a user name or an admin flag
  alongside it would assert an identity api never verified
- **The rules stay local as well as remote.** `deed-poll-validation.ts`, `case-state.ts` and
  `upload-policy.ts` are applied here *and* by api on purpose: a client that rejects early gives a better
  error than a 400. `src/conformance/` pins those rules against the Dataverse exports — see its `README.md`
  for which layers stayed and which moved to api
- **No query layer.** There is nothing between a service function and the adapter

### 4. Session Store (Redis)

**Purpose**: Session storage in Redis, via `@hmcts-cft/express-session-redis`

**Features**:
- Express session integration
- Distributed session support
- TTL-based expiration
- Keyed `admin-sess:<id>`, with no schema and no migration. Per component rather than the library's default
  `sess:`, because the shared root provisions one Redis for the product and `deed-poll-web` reads the same
  `redis-url` — a caseworker service's IDAM tokens and a public service's sessions should not share a keyspace
- Cookie: 24 hours, `httpOnly`, `sameSite=lax`, and `Secure` outside development and test. All four stated at
  the call site in `apps/web/src/app.ts`, not inherited — the library spreads caller options over its
  defaults, so a partial `cookie` silently replaces the whole default object
- Fails fast during an outage rather than queueing: the client sets `disableOfflineQueue`, so a store read
  while Redis is away returns a 500 instead of hanging until it comes back. See
  [`DEPLOYMENT.md`](DEPLOYMENT.md#what-a-redis-outage-looks-like)

Sessions are held here rather than behind `deed-poll-api` deliberately — see the comment at the store call
site in `apps/web/src/app.ts` for the reasoning. `libs/express-session-postgres` is still vendored but no
longer wired up.

## Shared Libraries

### Cloud Native Platform (`libs/cloud-native-platform`)

**Purpose**: Azure cloud integration and monitoring

**Features**:
- **Properties Volume**: Kubernetes ConfigMap/Secret mounting
- **Azure Key Vault**: Secret management integration
- **Application Insights**: Telemetry and monitoring
- **Health Checks**: Kubernetes readiness/liveness probes

**Implementation**:
```typescript
// Automatic configuration loading
await configurePropertiesVolume(config, { 
  chartPath: path.join(__dirname, "../helm/values.yaml") 
});

// Health check endpoints
app.use(healthcheck()); // /health, /health/readiness, /health/liveness
```

### Express GOV.UK Starter (`libs/express-govuk-starter`)

**Purpose**: GOV.UK Design System integration

**Components**:
- **Nunjucks Configuration**: Template engine setup
- **Asset Management**: Vite integration for SCSS/JS
- **Security Headers**: Helmet.js with CSP
- **Session Stores**: Redis adapter
- **Cookie Manager**: GDPR-compliant cookie consent
- **Error Handling**: User-friendly error pages
- **Filters**: Date, currency, time formatting

### Simple Router (`libs/simple-router`)

**Purpose**: File-based routing system

**Features**:
- Automatic route discovery
- Dynamic parameters (`[id].ts`)
- HTTP method exports
- Middleware composition
- Zero configuration
- Multi-directory mounting support

**Example**:
```typescript
// apps/web/src/pages/deed-polls/[id]/index.ts
export const GET = async (req, res) => {
  const deedPoll = await findDeedPoll(req.params.id, callerFromRequest(req));
  res.render("deed-polls/[id]/index", detailView(deedPoll));
};
```

**Usage**:
```typescript
// apps/web/src/app.ts
app.use(await createSimpleRouter({ path: `${__dirname}/pages` }));
```

## Helm Chart Structure

The project uses an umbrella Helm chart pattern for coordinated deployment of all services.

### Umbrella Chart (`helm/deed-poll-admin/`)

**Purpose**: Coordinates deployment of all applications and dependencies

**Structure**:
```
helm/deed-poll-admin/
├── Chart.yaml                      # Parent chart with dependencies
├── values.yaml                     # Default values
└── values.preview.template.yaml    # Preview environment values
```

**Dependencies**:
- `deed-poll-admin-web`: Web frontend application
- `deed-poll-admin-crons`: Scheduled jobs

Three dependencies went with the data access layer — `deed-poll-admin-postgres` and `deed-poll-admin-api`
pointed at deleted directories, and `postgresql` provisioned a per-PR database with nothing to put in it.
A `file://` dependency on a missing chart fails `helm dependency build`, so they were removed rather than
disabled.

**Key Features**:
- Each app can be enabled/disabled via conditions
- Dynamic image tag substitution for preview deployments
- Team metadata in annotations for multi-team monorepos
- Environment-specific value overrides

### Per-App Charts (`apps/*/helm/`)

Each deployable application has its own Helm chart:
- Uses HMCTS standard charts (`nodejs`, `job`)
- Contains app-specific configuration
- Referenced as file-based dependency in umbrella chart

## Preview Deployment Architecture

### Overview

Automated preview environments are created for each pull request, allowing teams to test changes in isolation before merging.

### Jenkins CNP pipeline

**Trigger**: pull requests, and merges to `master`

The pipeline is `Jenkinsfile_CNP` — `withPipeline("nodejs", "deed-poll", "admin")` with an empty body. What it
is *for*: build the image, run `yarn lint` and the test stage, deploy the umbrella chart to the `deed-poll`
namespace on `cft-preview-01-aks`, then smoke-test the deployed URL and post the environment back to the PR.

**It cannot do the deploy half of that yet.** The chart is at `helm/` where the library reads `charts/`, the
pipeline builds one image where the umbrella chart wants two, there is no `yarn test:smoke`, and preview has
no Redis — four blockers inside this repo, plus platform onboarding and the fact that `deed-poll-api` is not
deployed either. All six are enumerated with the library source that proves each in
[`PIPELINES.md`](PIPELINES.md); two of them are design decisions rather than renames. Read that before
assuming a red build is a regression.

The previous GitHub Actions pipeline and the five bash scripts it composed (`detect-affected-apps.sh`,
`generate-build-metadata.sh`, `set-image-variables.sh`, `deploy-preview.sh`, `get-deployment-urls.sh`) were
deleted with `.github/workflows/`. Their per-app selective-build behaviour has **no equivalent** in the CNP
pipeline, which builds one image per component — see [`PIPELINES.md`](PIPELINES.md), which records that
mismatch and the rest of the work outstanding before a deploy can go green.

### Infrastructure Components

**Per-Preview Resources**:
- Kubernetes namespace: `{team-name}`
- Ingress hosts: `{team}-{release}-{app}.preview.platform.hmcts.net`
- **No database.** The per-PR Postgres went with the data access layer. A preview instead points
  `DEED_POLL_API_URL` at AAT's api, which means preview writes land in AAT's data — stated at the value in
  `helm/deed-poll-admin/values.preview.template.yaml`

**Shared Resources**, all provisioned by [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra)
rather than by anything in this repo:
- Key Vault: `deed-poll-{env}`
- AKS Cluster: `cft-preview-01-aks`
- Azure Container Registry: `hmctsprod.azurecr.io`

Redis is provisioned there too — one instance per environment, shared with `deed-poll-web` — but **only from
`aat` upwards**: the shared root applies per environment on the `aat`, `demo`, `ithc`, `perftest` and `prod`
branches, not in `preview`. Preview therefore has no session store, which is gap 4 in
[`PIPELINES.md`](PIPELINES.md).

### Cleanup

Cleanup is triggered when PRs are closed, and is the platform's. The `ns:`, `prd:` and `rel:` PR labels that
used to track cleanup targets went with `.github/workflows/` — nothing applies or reads them now.

## Scalability Design

- Stateless application design
- Redis-backed sessions for distribution
- Kubernetes HPA support

## Technology Stack Summary

| Layer | Technology |
|-------|------------|
| Runtime | Node.js |
| Framework | Express.js |
| Language | TypeScript |
| Case data | `deed-poll-api` over HTTP — no database in this repo |
| Session store | Redis |
| Template Engine | Nunjucks |
| UI Framework | GOV.UK Frontend |
| Build Tool | Turbo |
| Bundler | Vite |
| Testing | Vitest, Playwright |
| Container | Docker (Multi-stage Alpine) |
| Orchestration | Kubernetes + Helm |
| CI/CD | Jenkins CNP (`Jenkinsfile_CNP`) |

