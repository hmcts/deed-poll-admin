# Deployment Guide

This guide covers deployment procedures for the application, including both preview and production environments.

## Overview

The application is deployed to Azure Kubernetes Service (AKS) using Helm charts, driven by the **Jenkins CNP
pipeline** (`Jenkinsfile_CNP`). The deployment strategy differs between environments:

| Environment | Trigger | Cluster | Purpose |
|-------------|---------|---------|---------|
| Preview | Pull Request | `cft-preview-01-aks` | Isolated testing per PR |
| AAT / Production | Merge to `master` | `cft-aat-00-aks` / prod | Live application |

This repo owns **no Terraform**. The resource group, Key Vault, App Insights and Redis all live in
[`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra), and that root must have applied at least
once before anything here can deploy — nothing enforces that ordering mechanically. See
[`PIPELINES.md`](PIPELINES.md) for the pipeline itself and for the work still outstanding before a deploy can
go green.

It also owns **no database**. The Postgres that shared root provisions is `deed-poll-api`'s; this app holds no
connection string, runs no migration and serves no page without api. See
[deed-poll-api](#deed-poll-api) below for what that adds to a deploy.

## Prerequisites

### Access Requirements

- **Azure Portal**: Access to HMCTS Azure subscription
- **AKS Cluster**: kubectl credentials for target cluster
- **Container Registry**: Push access to `hmctsprod.azurecr.io`
- **Jenkins**: the pipeline authenticates as its own managed identity — no repository secrets are involved

### Tools Required

```bash
# Install required tools
brew install azure-cli kubernetes-cli helm

# Azure login
az login

# Get AKS credentials (preview example)
az aks get-credentials \
  --resource-group cft-preview-01-rg \
  --name cft-preview-01-aks \
  --admin
```

## Helm Chart Architecture

### One chart, one component

```
charts/deed-poll-admin/
├── Chart.yaml                    # The nodejs base chart, plus redis for preview only
├── values.yaml                   # The real configuration — required by helmInstall
├── values.aat.template.yaml      # AAT overrides (envsubst'd, then appended)
├── values.preview.template.yaml  # Preview overrides, one per pull request
└── .helmignore
```

Three things about that layout are load-bearing rather than tidy, and `src/deployment-chart.test.ts` pins
each of them — every one otherwise fails only on a real Jenkins run:

- **The directory is `charts/`, not `helm/`.** `Helm.HELM_RESOURCES_DIR` in `hmcts/cnp-jenkins-library` is the
  literal `charts`, and `helmInstall` throws `No Helm charts directory found at charts` before doing anything
  else. It then requires `charts/${product}-${component}/values.yaml`.
- **There is no bare `values.template.yaml`, and adding one would delete configuration.** `helmInstall` does
  `envsubst < values.template.yaml > values.yaml` — it renders that name *over* `values.yaml` rather than
  layering on top of it, so anything `values.yaml` holds that the template does not restate is silently lost:
  the vault list, `aadIdentityName`, `applicationPort`, both probe paths, every `IDAM_*` variable. A
  `values.${environment}.template.yaml` is *appended* to helm's `-f` list instead, which is what an override
  file has to do. `pcs-frontend` and `deed-poll-web` both have only that form.
- **`global.environment` is deliberately not set in any values file.** `helmInstall` passes it with `--set`,
  which beats any `-f`, and the templates are only run through `envsubst` — which expands `$VAR` and
  `${VAR}` and nothing else, so a `${VAR:-default}` would reach Helm as that literal string.

### Dependencies

| Dependency | Source | Purpose |
|------------|--------|---------|
| `nodejs` | `oci://hmctsprod.azurecr.io/helm` | The HMCTS base chart. What makes this a CNP chart |
| `redis` | `charts.bitnami.com/bitnami` | **Preview only** — `redis.enabled` is `false` everywhere else |

**No `file://` dependency and no condition gating a component of this repo's own.** The umbrella chart at
`helm/deed-poll-admin/` and its four `deed-poll-admin-{web,api,crons,postgres}` subcharts are gone:
`api` and `postgres` went with the data access layer, `crons` was a component holding one `console.log` that
was never written, and `web` is inlined here — because `az acr build … .` builds a single root `Dockerfile`
into a single `deed-poll/admin` image and `helmInstall` exposes exactly that one image as `${IMAGE_NAME}`.
An umbrella chart needs one `${*_IMAGE}` per subchart and nothing sets those. The `postgresql` subchart went
too: this app has no database, so a per-PR one has nothing to put in it. Restoring any of them starts in
`hmcts/deed-poll-api`, not here.

`redis` is the one surviving subchart and the one surviving `*.enabled` condition, and it switches an
upstream chart rather than one of ours — see [Preview Environment](#preview-environment).

## Environment Configuration

### Preview Environment

Preview environments are automatically created for each pull request:

**Naming Convention:**
- Release: `{product}-{component}-pr-{PR#}` — `deed-poll-admin-pr-123`, which is `helmInstall`'s
  `"${product}-${component}-${imageTag}"`
- Namespace: `{team}` (e.g., `deed-poll`)
- Host: `${SERVICE_FQDN}`, which the pipeline computes from `azPrivateDns.getHostName(aksServiceName)` and
  exports to the values templates. **The chart does not build a hostname out of parts**, and must not: the
  `${TEAM_NAME}` and `${ENVIRONMENT}` this used to interpolate are not exported to a template at all, and
  `TEAM_NAME` is a team *display* name looked up in `cnp-jenkins-config/team-config.yml`, not a slug

**Automatic Cleanup:**
- Environments are deleted when PRs are closed, by the platform's preview pipeline
- The `ns:`, `prd:` and `rel:` PR labels went with `.github/workflows/` — `job.pr-comment.yml` was the only
  thing that applied them and `job.helm-cleanup.yml` the only thing that read them. Nothing does either now

**An ephemeral session store per PR, which is a decision and not a default.** `deed-poll-infra` applies on
the `aat`, `demo`, `ithc`, `perftest` and `prod` branches and never in `preview`, so there is no `redis-url`
in a preview vault — and `assertRedisUrl` refuses `config/default.json`'s loopback default outside
development, so a preview pod would fail fast rather than come up sessionless. `values.preview.template.yaml`
therefore enables the `redis` subchart, standalone with no auth and no persistence, sets `REDIS_URL` to
`{{ .Release.Name }}-redis-master`, and **re-declares the vault list without `redis-url`** — which is what
makes the override take effect at all: `getPropertiesVolumeSecrets` writes every mounted secret to
`process.env` under its alias unconditionally on the mount-point path, so a mounted `redis-url` would
overwrite it and point the PR at AAT's cache.

Pointing preview at AAT's cache was the alternative, and was rejected: every open PR would share one
keyspace, so a collision or a flush in one is felt in the rest, and preview sessions would outlive the PR
inside a store nothing here can clear. Was gap 4 in [`PIPELINES.md`](PIPELINES.md); resolved 2026-09-10.

The subchart's probe budget is raised to 10s (HDPI-8155). Under Dynatrace node instrumentation the
chart-default 2s exec-probe budget leaves redis permanently Running-but-not-Ready, and a never-Ready master
is excluded from its Service endpoints. This app does not crashloop on that the way `deed-poll-web` does —
`getRedisClient` races `connect()` against `REDIS_CONNECT_TIMEOUT_MS` and serves anyway — but `redisStatus`
then reports `redis: DOWN` for ever, so the web pod is never added to its own Service either and the PR
environment answers nothing. Same cause, same fix, different symptom.

**And no database, by design.** The per-PR Postgres went with the data access layer. A preview points
`DEED_POLL_API_URL` at AAT's api instead, which means **preview writes land in AAT's data** — acceptable
while there is no live data, and stated at the value itself so it is not discovered later.

### Production Environment

Production configuration should include:

**Key Differences from Preview:**
- Its own `deed-poll-api`, not AAT's
- Proper resource limits and requests
- Horizontal pod autoscaling
- Production-grade secrets management

**Example Production Values** — note the shape: `nodejs:` at the top level, not nested under a `web:`
subchart key, because there is no subchart. Production redirect URIs are also **deliberately empty** in the
IDAM registration and must be added before any production deploy; nothing enforces that, and there is no
production hostname yet.

```yaml
# values.prod.template.yaml — appended after values.yaml, like the aat one
nodejs:
  replicas: 3
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi
```

**Do not add `PERSONA_SWITCHER_ENABLED` to a production template.** `src/deployment-chart.test.ts` fails on
any `values.*.template.yaml` that sets it `"true"` for an environment the runtime allowlist does not name, so
a production template carrying it reds the build rather than shipping. See the next section for why.

### The persona switcher's two environment variables

The persona switcher (`src/auth/persona-switcher.ts`) signs a tester in as another persona's real IDAM user,
which makes it a **privilege-escalation mechanism by design**: anyone who can reach it holds every persona it
offers. `NODE_ENV` cannot gate it — `package.json`'s `start` is `NODE_ENV=production node dist/server.js`, so
every deployed pod including AAT's and preview's runs as production — so the decision comes from the chart,
per environment, through two conditions that must both hold.

| Variable | Where it is set | Notes |
|---|---|---|
| `PERSONA_SWITCHER_ENABLED` | `"false"` in `charts/deed-poll-admin/values.yaml`, `"true"` in `values.aat.template.yaml` and `values.preview.template.yaml` | Mapped with `__format: "json"` so it arrives as a boolean and is compared `=== true`. Without that, config hands back the *string* `"false"` — which is truthy, i.e. a value meaning "off" that reads as "on". A production deploy inherits `values.yaml` plus no template, so it gets `false`. `config/production.json` restates the `false` but **cannot enforce** it: node-config applies `custom-environment-variables.json` after `{NODE_ENV}.json`, so the variable always wins |
| `ENVIRONMENT_NAME` | `charts/deed-poll-admin/values.yaml`, as `{{ .Values.global.environment }}` | Checked against `PERSONA_SWITCHER_ENVIRONMENTS` — `development`, `test`, `aat`, `preview` — so a `demo` or `prod` deploy that somehow carried the flag still gets no switcher. **`config/default.json` leaves it empty on purpose**: an unset variable must match nothing, or a deploy path that does not render it (a Flux `HelmRelease`, a hand-rolled ConfigMap, a `--set` that dropped the key) collapses two independent conditions into one. `yarn dev` and `vitest.config.ts` are the two places that name their own environment, since neither has a chart |
| `PERSONA_SWITCHER_EMAIL_DOMAIN` | Unset; defaults to `example.com` | Only the AAT path uses it, where persona users are **created on demand** through `idam-testing-support-api` (AAT's test users are swept after ~3h, so a fixed account in a values file would work until the first cleanup). A values-file override exists because no request from the devcontainer reaches AAT's IDAM, so which domains it accepts is unverified |
| `PERSONA_SWITCHER_PASSWORD` | Unset; defaults to the local fixture password | Used **only** in the seeded environments (`development`, `test`), where it has to match `scripts/seed-idam-users.mjs` — pinned by a test in `src/auth/persona-switcher.test.ts`. A created AAT user's password is generated in-process and never written down, so the AAT path adds no secret to the vault |

**AAT needs an IDAM registration change before the switcher can work there** — `password` and
`client_credentials` grant types — and until it lands every persona refuses with a reason naming that PR
rather than reaching the 500 page. See [`PIPELINES.md`](PIPELINES.md).

## deed-poll-api

**This app serves no case page without api**, and api is a separate deployable in
[`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api). There are no migrations here to run and no
database to connect to: that is api's, along with the schema and the Flyway migrations that maintain it.

### What a deploy of this app needs from api

| Item | State |
|---|---|
| **api deployed to the target environment** | **Outstanding.** api's own `docs/plans/jenkins-pipeline-cutover.md` is what makes this true; until it lands, a deployed pod's readiness probe reports DOWN and Kubernetes keeps it out of the Service. That is the intended behaviour — a pod that cannot reach api cannot serve a single case page |
| `DEED_POLL_API_URL` | Set in `charts/deed-poll-admin/values.yaml` to `http://deed-poll-api-{env}.service.core-compute-{env}.internal` — the CNP internal host of api's `charts/deed-poll-api`, cluster-internal and cleartext, not an ingress. Preview overrides it to AAT's, because api's preview deploys are per-PR hosts with no stable name |
| `DEED_POLL_API_TIMEOUT_MS` | Optional. An unset or unparseable value falls back to the adapter's own default rather than becoming `NaN`. The readiness probe does **not** use it: `HEALTH_PROBE_TIMEOUT_MS` is fixed at 2s, because a probe must answer on its own terms |
| **An S2S credential** | **Nothing to add, and adding one would be wrong.** api authenticates a *forwarded IDAM access token* and nothing else — see its `SecurityConfiguration`, an OAuth2 resource server with no `ServiceAuthorization` filter, and `openapi.json`, whose only security scheme is `bearerAuth`. The caseworker's own token, held in this app's session, is the whole credential. If api ever adds S2S, the answer is a token provider minting one per call against `service-auth-provider-api`, plus an S2S microservice name registered for **this app**; it is not a static secret in the vault. `deed-poll-web/docs/external-dependencies.md` tracks the same requirement for the other frontend |

### There is no rollback of data from here

An api change that needs reverting is reverted in api. This app holds no schema, so a rollback here is a
Helm rollback of a stateless pod — see [Rollback Procedures](#rollback-procedures).

## Secrets Management

### Azure Key Vault Integration

Secrets are injected from the `deed-poll-{env}` Key Vault, which is created by
[`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra), not by anything in this repo. The chart
mounts them as a properties volume; the Jenkins pipeline does not inject them.

```yaml
# In Helm values
keyVaults:
  deed-poll:
    secrets:
      - name: app-insights-connection-string
        alias: APPLICATION_INSIGHTS_CONNECTION_STRING
      - name: redis-url
        alias: REDIS_URL
```

### Required Secrets

Names are **per component** where sharing would be unsafe — `deed-poll-web` reads the same vault, and one
session signing key across a caseworker service and a public one would make a forged cookie portable between
them.

| Secret | Alias | Description |
|--------|-------|-------------|
| `app-insights-connection-string` | `APPLICATION_INSIGHTS_CONNECTION_STRING` | Application Insights telemetry. Shared — `deed-poll-api` is Spring Boot and reads the same entry |
| `redis-url` | `REDIS_URL` | Session store. One instance per environment shared with `deed-poll-web`, so this app prefixes its keys `admin-sess:` rather than the library default `sess:`. Written as `rediss://` against the TLS port, and `assertRedisUrl` refuses to start on a cleartext or loopback URL outside development |
| `admin-session-secret` | `SESSION_SECRET` | Session cookie signing key |
| `admin-idam-client-secret` | `IDAM_CLIENT_SECRET` | IDAM OIDC client secret. **Does not exist yet** — it comes from IDAM by hand once the client registration lands |

The chart fails to start a pod when a named secret is absent from the vault, so the last two entries are the
ones to check first when a deploy will not come up. **`postgres-url` is deliberately not in that list**: this
app holds no database credential since the api cutover, and `apps/crons` — which never held one either —
no longer exists.

### When the secrets are read, and why the order matters

`loadSecrets()` — `src/secrets.ts` — reads the mounted volume into `process.env`, and
`server.ts` awaits it **before** importing `./app.js`, dynamically:

```ts
await loadSecrets();
const { createApp } = await import("./app.js");
```

That ordering is load-bearing rather than tidy. `config` resolves `custom-environment-variables.json` once,
when it is first loaded, and caches the result — it is not a lazy read on `.get()`. ESM evaluates everything
an entrypoint statically imports before the entrypoint runs a line, so loading the secrets from inside
`createApp` was too late: `config` had already resolved every value from the placeholders in
`config/default.json`, and a pod read `redis://localhost:6379` and the checked-in session secret however
correct its vault was. `libs/deed-poll` avoids the same trap differently — `deed-poll-api.ts` reads
`process.env.DEED_POLL_API_URL` lazily, per call, rather than resolving a base URL at module scope, so it is
correct at any point in the startup sequence.

The symptom is misleading, which is what makes it worth knowing: `assertRedisUrl` crashloops the pod with an
error blaming a missing `redis-url` entry that is present. A static
`import { createApp } from "./app.js"` in `server.ts` reintroduces it, and `src/server.test.ts`
exists to fail when one does.

### Adding New Secrets

1. Add the secret to the vault in `hmcts/deed-poll-infra` — not by hand in the portal
2. Update `charts/deed-poll-admin/values.yaml`'s `keyVaults:` block to reference it — **and
   `values.preview.template.yaml`'s, which re-declares the whole list because Helm replaces a list rather
   than merging it.** `src/secrets.ts` reads the first of those out of the image to build the alias map, and
   `src/deployment-chart.test.ts` asserts the two lists stay in step
3. Update the application to read the aliased environment variable
4. Read it through `config` (add it to `config/default.json` and `custom-environment-variables.json`) or
   straight from `process.env` — either works, because `loadSecrets()` has already run. Do **not** add a
   second `getPropertiesVolumeSecrets` call inside `createApp`

## Health Checks

**Do not point liveness at `/health`.** `healthcheck()` serves `/health`, `/health/readiness` and
`/readiness` from `readinessChecks`, and only `/health/liveness` and `/liveness` from `checks` — see
`libs/cloud-native-platform/src/healthcheck/healthcheck-middleware.ts`. `src/app.ts` deliberately leaves
`checks` **empty** and puts Redis and `deed-poll-api` on readiness alone, so that a dependency outage
takes pods out of service instead of restarting them: restarting cannot fix someone else's Redis, and a
rolling restart turns a recoverable outage into a self-inflicted one. A liveness probe on `/health` would
run the readiness checks and undo all of that.

### Liveness Probe

Whether the process is answering at all. Deliberately has no checks behind it:

```yaml
livenessProbe:
  httpGet:
    path: /health/liveness
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
```

### Readiness Probe

Whether the application can serve traffic — Redis reachable, and `deed-poll-api` answering:

```yaml
readinessProbe:
  httpGet:
    path: /health/readiness
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

The Redis entry checks `isReady` and bounds the `PING` (`redisStatus` in `src/app.ts`) rather than
awaiting a bare ping. `runChecks` awaits every check with a bare `Promise.all`, so a check that does not
settle hangs the endpoint for the whole outage and reports neither Redis nor api. Kubernetes would
still take the pod out of service on the probe's own timeout, so the cost is an endpoint that tells whoever is
diagnosing the outage nothing.

The api entry is `deedPollApiStatus()` in `libs/deed-poll/src/api/deed-poll-api.ts`, and it is what replaced
the Postgres table check when the data access layer went. It hits api's unauthenticated `/health` with its own
fixed 2s timeout — deliberately not `DEED_POLL_API_TIMEOUT_MS`, for the `Promise.all` reason above — and logs
the classification (`unavailable` vs `timeout`) before collapsing to UP/DOWN, because being paged for
"readiness DOWN" with no further detail wastes most of the diagnosis. It proves reachability only: the sole
token this app holds is a caseworker's, in a session, and no session exists at probe time.

### What a Redis outage looks like

The client is created with `disableOfflineQueue: true`. Without it, node-redis *buffers* commands issued while
the client is reconnecting — `isOpen` true, `isReady` false — and the promise never settles: since
`express-session` reads the store on every request and `requireAuth` is global, an outage would present as
browsers hanging with no error page and no log line, and with an unbounded backlog of queued commands, because
the empty liveness checks mean nothing restarts the pod either. With it, a store operation during an outage
rejects immediately and the request gets the starter's 500 page.

The trade is deliberate: a sub-second reconnect (an Azure Cache failover, a patching window) now 500s the
requests in flight rather than making them wait it out. Readiness already takes the pod out of the Service for
anything longer, and a bounded error beats an unbounded wait. `src/session-store.test.ts` pins it
against a closed port, so a regression fails the suite rather than waiting for an outage to reveal itself.

## Troubleshooting

### Common Issues

#### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n {namespace}

# View pod details
kubectl describe pod {pod-name} -n {namespace}

# Check logs
kubectl logs {pod-name} -n {namespace}
```

**Common Causes:**
- Image pull errors (check registry credentials)
- Resource limits exceeded (OOMKilled)
- Health check failures
- Missing secrets or configmaps

#### Helm Release Stuck

Nothing recovers this automatically any more — the lock handling and retry logic lived in
`deploy-preview.sh`, which went with `.github/workflows/`. `helmInstall` fails the build instead, so recover
by hand:

```bash
# Check release status
helm status {release-name} -n {namespace}

# View history
helm history {release-name} -n {namespace}

# Rollback to previous version
helm rollback {release-name} {revision} -n {namespace}

# Force uninstall (last resort)
helm uninstall {release-name} -n {namespace} --no-hooks
```

#### Readiness DOWN, or every case page 500s

Almost always api. The pod logs one line per failed probe naming the classification:

```bash
# What the probe itself says
kubectl exec -it {app-pod} -n {namespace} -- \
  /bin/sh -c 'wget -qO- http://localhost:3000/health/readiness'

# Whether api is reachable from this pod at the URL this pod is using
kubectl exec -it {app-pod} -n {namespace} -- \
  /bin/sh -c 'echo $DEED_POLL_API_URL && wget -qO- $DEED_POLL_API_URL/health'

# The classification, logged by deedPollApiStatus
kubectl logs {app-pod} -n {namespace} | grep 'deed-poll-api readiness'
```

`unavailable` is api down or the URL wrong; `timeout` is api too slow, which waiting may fix. A 401 from a
case page rather than the probe is the other shape: the probe is unauthenticated, so it stays UP while every
caseworker's token is being rejected.

### Manual Deployment

If automated deployment fails:

```bash
# 1. Build the image. One image and one Dockerfile, at the repo root — the same one
#    `az acr build … .` builds.
docker build -t hmctsprod.azurecr.io/deed-poll/admin:manual .

# 2. Push to registry
docker push hmctsprod.azurecr.io/deed-poll/admin:manual

# 3. Render the environment override the way the pipeline does. Only IMAGE_NAME and
#    SERVICE_FQDN are substituted; do not set TEAM_NAME or ENVIRONMENT, neither of which
#    helmInstall exports and neither of which the chart uses.
cd charts/deed-poll-admin
helm dependency update
IMAGE_NAME=hmctsprod.azurecr.io/deed-poll/admin:manual \
SERVICE_FQDN=deed-poll-admin-staging.aat.platform.hmcts.net \
  envsubst < values.aat.template.yaml > values.aat.yaml

# 4. Deploy. values.yaml first, then the override on top — the order is the point, and
#    global.environment comes from --set because that is what the pipeline does.
helm upgrade --install {release-name} . \
  --namespace {namespace} \
  --values values.yaml \
  --values values.aat.yaml \
  --set global.environment=aat \
  --wait \
  --timeout 10m
```

## Monitoring

### Application Insights

Azure Application Insights provides:
- Request/response metrics
- Error tracking and alerting
- Performance monitoring
- Distributed tracing

### Kubernetes Monitoring

```bash
# Real-time pod metrics
kubectl top pods -n {namespace}

# Event log
kubectl get events -n {namespace} --sort-by='.lastTimestamp'

# Resource usage
kubectl describe resourcequota -n {namespace}
```

### Inspecting case data

Not from here. There is no database and no Studio: the data is api's, so inspection is api's tooling against
api's database. This was `https://{team}-{release}-postgres.preview.platform.hmcts.net`, an unauthenticated
read/write browser over applicant PII behind an ingress host, and it is not something to rebuild.

## Rollback Procedures

### Helm Rollback

```bash
# List revisions
helm history {release-name} -n {namespace}

# Rollback to specific revision
helm rollback {release-name} {revision} -n {namespace}

# Verify rollback
kubectl get pods -n {namespace}
```

### Image Rollback

If a specific image version needs to be reverted:

```bash
# Update image tag
helm upgrade {release-name} . \
  --namespace {namespace} \
  --set nodejs.image=hmctsprod.azurecr.io/deed-poll/admin:previous-tag \
  --reuse-values
```

## References

- **Pipelines**: [`PIPELINES.md`](PIPELINES.md) — the Jenkins CNP pipeline, and what is still outstanding
- **Architecture**: [`ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture
- **Shared infrastructure**: [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra) — the vault,
  Redis and App Insights this chart depends on
- **The service holding the data**: [`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api), and
  [`docs/plans/completed/02-dal-cutover-to-api.md`](plans/completed/02-dal-cutover-to-api.md) for why it
  holds it
- **Why it is split this way**:
  [`.business_context/DEED_POLL_INFRA_PLAN.md`](../.business_context/DEED_POLL_INFRA_PLAN.md)
