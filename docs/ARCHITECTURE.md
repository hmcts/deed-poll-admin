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
│  └──────────────────────────┬──────────────────────────────┘     │
│                             │                                    │
│  ┌──────────────────────────┴──────────────────────────────┐     │
│  │         REST API (@hmcts/api)                           │     │
│  │  - Express 5.x                                          │     │
│  │  - JSON API                                             │     │
│  │  - Port: 3001                                           │     │
│  └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┴────────────────────────────────────┐
│                         Data Layer                               │
│    ┌────────────────────┐   ┌────────────────────┐               │
│    │  PostgreSQL        │   │  Redis             │               │
│    │  - Port: 5432      │   │  - Port: 6379      │               │
│    │  - Prisma ORM      │   │  - Session Store   │               │
│    │  - Case data       │   │                    │               │
│    └────────────────────┘   └────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

## Monorepo Structure

The project uses Yarn Workspaces with Turborepo for efficient monorepo management:

```
deed-poll-admin/
├── apps/                       # Deployable applications
│   ├── api/                    # REST API service
│   ├── crons/                  # Scheduled jobs (CronJob)
│   ├── postgres/               # Prisma Studio & migration runner
│   └── web/                    # Web frontend application
│       └── src/
│           ├── pages/          # File-based page routes (auto-discovered)
│           └── locales/        # App-level translations
├── libs/                       # Reusable packages
│   ├── cloud-native-platform/  # Azure integration & monitoring
│   ├── express-govuk-starter/  # GOV.UK Design System integration
│   ├── postgres-prisma/        # Prisma client library
│   ├── simple-router/          # File-based routing system
│   └── [feature-module]/       # Feature modules (e.g. onboarding)
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
   - `pages/onboarding/name.ts` → `/onboarding/name`
   - `pages/onboarding/(group)/page.ts` → `/onboarding/page` (parenthetical dirs are route groups — stripped from URL)
   - `pages/onboarding/confirmation/[id].ts` → `/onboarding/confirmation/:id`
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
- Redis for session management, PostgreSQL for case data

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

### 2. REST API (`apps/api`)

**Purpose**: Backend API service for data operations

**Key Technologies**:
- Express 5.x
- TypeScript with strict mode
- Prisma ORM for database access
- CORS support

**Features**:
- RESTful endpoints
- File-based routing
- Compression middleware
- Health check endpoints
- Error handling

**API Structure**:
```
/api/
├── users/          # User management
├── users/[id]      # Dynamic routing
└── [resource]/     # Additional resources
```

### 3. Database Layer

**Purpose**: Data persistence, schema management, and database inspection

The database layer is split into two components:

#### Database Client (`libs/postgres-prisma`)
- Provides Prisma ORM client for type-safe database queries
- Owns all Prisma schemas — feature modules do not define their own
- Exports Prisma client for use across applications
- Snake_case database naming convention
- CamelCase TypeScript interface mapping
- Database connection pooling

#### Prisma Studio Service (`apps/postgres`)
- Long-running service providing database inspection interface
- Runs database migrations on pod startup
- Hosts Prisma Studio on port 5556 (proxied via port 5555)
- Health proxy for Kubernetes health checks
- Accessible via ingress in preview/production environments
- Deployed using HMCTS `nodejs` Helm chart

**Database Schema**:
- **User**: Authentication and user management
- **Case**: Case management system
- **Document**: File attachments
- **CaseNote**: Audit trail

### 4. Prisma Studio Service (`apps/postgres`)

**Purpose**: Database inspection and migration management

**Key Features**:
- Runs database migrations on startup via `prisma migrate deploy`
- Provides web-based Prisma Studio interface for database inspection
- Health proxy server (port 5555) for Kubernetes health checks
- Proxies traffic to Prisma Studio (port 5556)
- Long-running service deployed using HMCTS `nodejs` chart

**Architecture Pattern**:
The health proxy solves the HMCTS `nodejs` chart v3.2.0 limitation that forces HTTP health checks:
- HTTP server on port 5555 responds to K8s probes
- All other traffic proxied to Prisma Studio on port 5556
- Both run continuously as a single pod

**Access**:
- Preview: `https://<team>-<release>-postgres.preview.platform.hmcts.net`
- Production: Via configured ingress host

### 5. Session Store (Redis)

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
// apps/api/src/routes/users/[id].ts
export const GET = async (req, res) => {
  const user = await getUser(req.params.id);
  res.json(user);
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
- `deed-poll-admin-postgres`: Database migration and Prisma Studio service
- `deed-poll-admin-web`: Web frontend application
- `deed-poll-admin-api`: REST API service
- `deed-poll-admin-crons`: Scheduled jobs
- `postgresql`: Database provisioning (HMCTS chart)

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
pipeline builds one image where the umbrella chart wants four, there is no `yarn test:smoke`, and preview has
no Redis. Four blockers, enumerated with the library source that proves each in
[`PIPELINES.md`](PIPELINES.md); two of them are design decisions rather than renames. Read that before
assuming a red build is a regression.

The previous GitHub Actions pipeline and the five bash scripts it composed (`detect-affected-apps.sh`,
`generate-build-metadata.sh`, `set-image-variables.sh`, `deploy-preview.sh`, `get-deployment-urls.sh`) were
deleted with `.github/workflows/`. Their per-app selective-build behaviour has **no equivalent** in the CNP
pipeline, which builds one image per component — see [`PIPELINES.md`](PIPELINES.md), which records that
mismatch and the rest of the work outstanding before a deploy can go green.

### Infrastructure Components

**Per-Preview Resources**:
- PostgreSQL database: `{release-name}`
- Kubernetes namespace: `{team-name}`
- Ingress hosts: `{team}-{release}-{app}.preview.platform.hmcts.net`

**Shared Resources**, all provisioned by [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra)
rather than by anything in this repo:
- Azure Flexible PostgreSQL Server: `deed-poll-preview`
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
| Database | PostgreSQL |
| ORM | Prisma |
| Session store | Redis |
| Template Engine | Nunjucks |
| UI Framework | GOV.UK Frontend |
| Build Tool | Turbo |
| Bundler | Vite |
| Testing | Vitest, Playwright |
| Container | Docker (Multi-stage Alpine) |
| Orchestration | Kubernetes + Helm |
| CI/CD | Jenkins CNP (`Jenkinsfile_CNP`) |

