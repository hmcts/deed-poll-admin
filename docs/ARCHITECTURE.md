# Architecture Overview

## Executive Summary

`deed-poll-admin` is the caseworker **and judiciary** application for HMCTS deed poll applications: a
server-rendered
Express 5.x / TypeScript app on the GOV.UK Design System, scaffolded from
[hmcts/expressjs-monorepo-template](https://github.com/hmcts/expressjs-monorepo-template).

**It is one deployable, and the repository's shape says so.** The application is the root package — `src/`
at the root, one `Dockerfile`, one chart at `charts/deed-poll-admin/`, one `Jenkinsfile_CNP` component. The
four-app monorepo it was scaffolded as is gone: `apps/api` and `apps/postgres` with the data access layer,
`apps/crons` as a component that held one `console.log`, and `apps/web` flattened into the root. See
[`plans/03-collapse-to-single-app.md`](plans/03-collapse-to-single-app.md). `libs/` is still a Yarn
workspace of seven packages, deliberately: four are template-provided, and keeping them as packages is what
makes a future template re-scaffold tractable.

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
│  │         deed-poll-admin (the root package, src/)        │     │
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
[`plans/completed/02-dal-cutover-to-api.md`](plans/completed/02-dal-cutover-to-api.md). What is left here is a
presentation layer plus one session store, and the only state this app owns is the session.

## Repository Structure

The application is the root package. Yarn Workspaces and Turborepo remain, for `libs/*` and `e2e-tests`:

```
deed-poll-admin/
├── src/                        # THE application — no apps/ directory
│   ├── pages/                  # File-based page routes (auto-discovered)
│   ├── assets/                 # SCSS/TS bundles, compiled by vite
│   ├── auth/                   # IDAM OIDC: login, session, require-auth, require-role
│   ├── locales/                # App-level translations
│   └── app.ts, server.ts       # createApp(), and the entrypoint that loads secrets first
├── config/                     # `config` defaults + custom-environment-variables
├── libs/                       # Reusable packages — the one remaining workspace
│   ├── cloud-native-platform/  # Azure integration & monitoring
│   ├── deed-poll/              # The case domain: services, validation, view models
│   ├── deed-poll-api-client/   # The adapter onto deed-poll-api, and its in-memory mock
│   ├── express-govuk-starter/  # GOV.UK Design System integration
│   ├── express-session-postgres/ # Template-provided, unused, deliberately retained
│   ├── express-session-redis/  # The session store actually wired up
│   ├── simple-router/          # File-based routing system
│   └── [feature-module]/       # Feature modules
│       └── src/
│           └── [domain]/       # Reusable functions consumed by the app
├── charts/deed-poll-admin/     # The one Helm chart, where helmInstall requires it
├── e2e-tests/                  # Playwright E2E tests, including the @smoke spec
├── Dockerfile                  # The one image the pipeline builds
└── docs/                       # Documentation
```

Two mechanical consequences of the app being the root package:

- **Turbo will not run a root-package script unless the task is named `//#<task>`**, and a root `//#build`
  would make `yarn build` invoke itself. Hence `//#build:app`, `//#test:app`, `//#dev:app`, each wrapped by
  an orchestrating `turbo <x> <x>:app`. Libraries still build first via `^build`.
- **The app's tsconfig is `tsconfig.app.json`**, not the root `tsconfig.json`, which holds the `libs/*`
  `paths` and no `include`. `vite-tsconfig-paths` matches source files against discovered tsconfig
  *projects*, and the root file is the only project covering the libraries' test files; giving it an
  `include` made library tests resolve `@hmcts/*` to `dist` while their sources resolved to `src`, so
  `vi.mock` silently stopped applying.

### File-Based Routing

The application uses Simple Router for automatic route discovery from the `src/pages/` directory:

1. **Route Discovery**: All `.ts`/`.js` files under `pages/` are scanned recursively
2. **URL Mapping**:
   - `pages/deed-polls/new.ts` → `/deed-polls/new`
   - `pages/deed-polls/(group)/page.ts` → `/deed-polls/page` (parenthetical dirs are route groups — stripped from URL)
   - `pages/deed-polls/[id]/notes/[noteId]/edit.ts` → `/deed-polls/:id/notes/:noteId/edit`
3. **HTTP Methods**: Files export named functions (`GET`, `POST`) per HTTP method
4. **Views**: Nunjucks templates co-located with controllers; `(group)` directories are added as view paths so templates remain discoverable
5. **Precedence**: `sortRoutes` registers routes with fewer parameters first, then shorter paths, then static
   segments before parameterised ones — so `pages/judicial/referrals/mine.ts` is matched before
   `pages/judicial/referrals/[referralId].ts` and `/judicial/referrals/mine` is never read as a referral id.
   A literal path alongside a sibling `[param]` needs no registration order of its own; **test the dispatch
   rather than the sort** (`src/pages/judicial/referrals/mine.test.ts` drives a real router over the real
   `src/pages` tree), because an assertion about the sorted array passes on a router that then dispatches the
   other way

## Core Components

### 1. The application (`src/`, the root package)

**Purpose**: caseworker- and judiciary-facing web application with GOV.UK Design System — two personas in one
deployable, separated by routing and a single role gate

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

**Authorization**: `requireAuth` is mounted globally with a public allowlist and decides only
authenticated-or-not. `requireJudicial()` (`src/auth/require-role.ts`) is mounted on the `/judicial` prefix in
`src/app.ts`, **after** `requireAuth`, and is the only place the app refuses a request on a role — a page under
`src/pages/judicial/` is gated by where it lives, and `src/app.test.ts` pins that from the filesystem. It
refuses with `next(new ForbiddenError(...))`; `src/errors.ts` logs it and answers 403 on the **404** view, so
the area stays non-enumerable. api gates the same routes itself, so this is the UI boundary and not the data
one.

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
- **`openapi.json` is api's published document, not a hand-written contract.** Which api commit it was taken
  from is recorded in `SPEC-PROVENANCE.md` and nowhere else, so a refresh cannot leave a stale hash behind
  here; `src/api/contract.test.ts` fails if the adapter and the spec disagree, so divergence is a bug in one of
  them rather than licence to invent
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

**Purpose**: Session storage in Redis, via `@hmcts-cft/express-session-redis` with the app's own
`GuardedSessionStore` (`src/auth/guarded-session-store.ts`) in place of `connect-redis`

**Features**:
- Express session integration
- Distributed session support, with one token refresh per session across pods (a lease in the session's hash)
- TTL-based expiration, derived from the idle/absolute session limits
- Guarded writes: every write is an atomic Lua script checked against the incarnation and revision the request
  read, so a logged-out or expired session is never recreated and an older snapshot never overwrites a newer one
  (review finding E01; contract in `CLAUDE.md` under "Session writes")
- Keyed `admin-sess-v2:<id>`, one hash per session, with no schema and no migration. Per component rather than the
  library's default `sess:`, because the shared root provisions one Redis for the product and `deed-poll-web` reads
  the same `redis-url` — a caseworker service's IDAM tokens and a public service's sessions should not share a
  keyspace. `-v2` because the guarded records are not `connect-redis`'s; see
  [`DEPLOYMENT.md`](DEPLOYMENT.md#session-writes-and-rollout)
- Cookie: the absolute session limit, `httpOnly`, `sameSite=lax`, and `Secure` outside development and test. All four stated at
  the call site in `src/app.ts`, not inherited — the library spreads caller options over its
  defaults, so a partial `cookie` silently replaces the whole default object
- Fails fast during an outage rather than queueing: the client sets `disableOfflineQueue`, so a store read
  while Redis is away returns a 500 instead of hanging until it comes back. See
  [`DEPLOYMENT.md`](DEPLOYMENT.md#what-a-redis-outage-looks-like)

Sessions are held here rather than behind `deed-poll-api` deliberately — see the comment at the store call
site in `src/app.ts` for the reasoning. `libs/express-session-postgres` is still vendored but no
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
  chartPath: path.join(__dirname, "../charts/deed-poll-admin/values.yaml")
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
// src/pages/deed-polls/[id]/index.ts
export const GET = async (req, res) => {
  const deedPoll = await findDeedPoll(req.params.id, callerFromRequest(req));
  res.render("deed-polls/[id]/index", detailView(deedPoll));
};
```

**Usage**:
```typescript
// src/app.ts
app.use(await createSimpleRouter({ path: `${__dirname}/pages` }));
```

## Helm Chart Structure

**One chart, one component, no umbrella.** `charts/deed-poll-admin/` is a single `nodejs` chart, and the
directory name is the pipeline's requirement rather than a preference — `Helm.HELM_RESOURCES_DIR` is the
literal `charts`, and `helmInstall` throws without it, then requires `charts/deed-poll-admin/values.yaml`.

```
charts/deed-poll-admin/
├── Chart.yaml                      # nodejs base chart; redis for preview only
├── values.yaml                     # The real configuration — every environment's defaults
├── values.aat.template.yaml        # AAT overrides, appended after values.yaml
├── values.preview.template.yaml    # Preview overrides, one per pull request
└── .helmignore
```

**Dependencies**: `nodejs` (the HMCTS base chart — a CNP chart depends on it by definition) and `redis`,
which is enabled in preview only. There is **no `file://` dependency and no condition gating one of this
repo's own components**: the four `deed-poll-admin-{web,api,crons,postgres}` subcharts and the `postgresql`
one are all gone. The reason is mechanical rather than aesthetic — `az acr build … .` builds a single root
`Dockerfile` into a single image and `helmInstall` exposes exactly that one as `${IMAGE_NAME}`, where an
umbrella chart needs one `${*_IMAGE}` per subchart and nothing sets those.

**Key points**, each of which fails only on a real Jenkins run and so is pinned by
`src/deployment-chart.test.ts`:
- `values.yaml` holds the real configuration, and **there is deliberately no bare `values.template.yaml`**:
  `helmInstall` renders that name *over* `values.yaml` rather than appending it, so anything `values.yaml`
  holds that such a template did not restate would be silently lost
- The ingress host is `${SERVICE_FQDN}` in AAT and preview, and
  `deed-poll-admin.{{ .Values.global.environment }}.platform.hmcts.net` elsewhere. **No hostname is built
  out of `${TEAM_NAME}` or `${ENVIRONMENT}`** — neither is exported to a values template, and `TEAM_NAME` is
  a team display name, not a slug
- `IDAM_REDIRECT_URI` is derived from the same variable as the host it must match, in the same file, so the
  two cannot drift
- Team metadata stays in `annotations.team`, which the platform reads for namespace and Slack routing

## Preview Deployment Architecture

### Overview

Automated preview environments are created for each pull request, allowing teams to test changes in isolation before merging.

### Jenkins CNP pipeline

**Trigger**: pull requests, and merges to `master`

The pipeline is `Jenkinsfile_CNP` — `withPipeline("nodejs", "deed-poll", "admin")` with an empty body. What it
is *for*: build the one image, run `yarn lint` and the test stage, deploy `charts/deed-poll-admin/` to the
`deed-poll` namespace on `cft-preview-01-aks`, then smoke-test the deployed URL and post the environment back
to the PR.

**Nothing in this repo blocks that any longer.** The four blockers that were — the chart's directory, one
image against an umbrella chart wanting two, the missing `yarn test:smoke`, and preview having no session
store — are all resolved, and the two that were design decisions were decided: one component, and an
ephemeral `redis` subchart per PR. What is left is external: `cnp-jenkins-config` onboarding, which
**hard-fails the pipeline before it builds anything** while `deed-poll` is absent from `team-config.yml`, the
IDAM client registration, and `deed-poll-api` not being deployed — which keeps the smoke gate red on purpose.
All of it is enumerated with the library source that proves each in [`PIPELINES.md`](PIPELINES.md). Read that
before assuming a red build is a regression.

The previous GitHub Actions pipeline and the five bash scripts it composed (`detect-affected-apps.sh`,
`generate-build-metadata.sh`, `set-image-variables.sh`, `deploy-preview.sh`, `get-deployment-urls.sh`) were
deleted with `.github/workflows/`. Their per-app selective-build behaviour has **no equivalent** in the CNP
pipeline, which builds one image per component — and no longer needs one, since there is one component.

### Infrastructure Components

**Per-Preview Resources**:
- Kubernetes namespace: `{team-name}`
- Ingress host: `${SERVICE_FQDN}`, computed by the pipeline. Different for every pull request, which is why
  preview sign-in is an open question with IDAM rather than something this chart can settle
- **A `redis` subchart**, standalone, no auth, no persistence, nothing outliving the PR. Enabled here and
  nowhere else
- **No database.** The per-PR Postgres went with the data access layer. A preview instead points
  `DEED_POLL_API_URL` at AAT's api, which means preview writes land in AAT's data — stated at the value in
  `charts/deed-poll-admin/values.preview.template.yaml`

**Shared Resources**, all provisioned by [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra)
rather than by anything in this repo:
- Key Vault: `deed-poll-{env}`
- AKS Cluster: `cft-preview-01-aks`
- Azure Container Registry: `hmctsprod.azurecr.io`

Redis is provisioned there too — one instance per environment, shared with `deed-poll-web` — but **only from
`aat` upwards**: the shared root applies per environment on the `aat`, `demo`, `ithc`, `perftest` and `prod`
branches, not in `preview`. That is why preview brings its own, rather than reading `redis-url` from the
vault; sharing AAT's cache across every open PR was the alternative and was rejected. See
[`DEPLOYMENT.md`](DEPLOYMENT.md#preview-environment).

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

