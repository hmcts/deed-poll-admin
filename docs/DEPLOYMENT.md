# Deployment Guide

This guide covers deployment procedures for the application, including both preview and production environments.

## Overview

The application is deployed to Azure Kubernetes Service (AKS) using Helm charts, driven by the **Jenkins CNP
pipeline** (`Jenkinsfile_CNP`). The deployment strategy differs between environments:

| Environment | Trigger | Cluster | Purpose |
|-------------|---------|---------|---------|
| Preview | Pull Request | `cft-preview-01-aks` | Isolated testing per PR |
| AAT / Production | Merge to `master` | `cft-aat-00-aks` / prod | Live application |

This repo owns **no Terraform**. The resource group, Key Vault, App Insights, Redis and Postgres all live in
[`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra), and that root must have applied at least
once before anything here can deploy — nothing enforces that ordering mechanically. See
[`PIPELINES.md`](PIPELINES.md) for the pipeline itself and for the work still outstanding before a deploy can
go green.

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

### Umbrella Chart Structure

```
helm/deed-poll-admin/
├── Chart.yaml                    # Dependencies on sub-charts
├── values.template.yaml          # AAT/prod template (envsubst'd at deploy time)
├── values.preview.template.yaml  # Preview environment template
└── charts/                       # Cached dependencies
```

> The Jenkins pipeline expects this at `charts/deed-poll-admin/`, not `helm/deed-poll-admin/`, and expects a
> `values.yaml` to exist. Both gaps are recorded in [`PIPELINES.md`](PIPELINES.md).

### Sub-Charts

Each application has its own Helm chart:

```
apps/{app}/helm/
├── Chart.yaml        # Depends on HMCTS nodejs/job base charts
├── values.yaml       # Default application values
└── charts/           # Base chart dependencies
```

### Dependencies

| Dependency | Source | Purpose |
|------------|--------|---------|
| `deed-poll-admin-web` | Local (`apps/web/helm`) | Web frontend |
| `deed-poll-admin-api` | Local (`apps/api/helm`) | REST API |
| `deed-poll-admin-crons` | Local (`apps/crons/helm`) | Scheduled jobs |
| `deed-poll-admin-postgres` | Local (`apps/postgres/helm`) | Database migrations |
| `postgresql` | `oci://hmctsprod.azurecr.io/helm` | PostgreSQL database |

## Environment Configuration

### Preview Environment

Preview environments are automatically created for each pull request:

**Naming Convention:**
- Release: `{app-name}-pr-{PR#}` (e.g., `deed-poll-admin-pr-123`)
- Namespace: `{team}` (e.g., `deed-poll`)
- URLs: `https://{team}-{release}-{service}.preview.platform.hmcts.net`

**Automatic Cleanup:**
- Environments are deleted when PRs are closed
- Labels `ns:`, `prd:`, `rel:` track cleanup targets

### Production Environment

Production configuration should include:

**Key Differences from Preview:**
- Persistent database (not ephemeral)
- Proper resource limits and requests
- Horizontal pod autoscaling
- Production-grade secrets management

**Example Production Values:**
```yaml
# values.production.yaml
global:
  environment: prod
  enableKeyVaults: true
  devMode: false

web:
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

## Database Migrations

Database migrations are handled by the `postgres` application:

### Migration Process

1. **Build**: Creates Docker image with Prisma migrations
2. **Deploy**: Kubernetes Job runs `yarn db:migrate`
3. **Wait**: Helm waits for job completion before proceeding
4. **Verify**: Check migration status in Prisma Studio

### Running Migrations Manually

```bash
# From local machine with database access
yarn db:migrate

# Or apply pending migrations only
yarn db:migrate:dev

# View database
yarn db:studio
```

### Rollback Procedure

Prisma doesn't support automatic rollback. For production issues:

1. **Assess Impact**: Determine if rollback is necessary
2. **Create Fix Migration**: Generate migration to reverse changes
3. **Deploy Fix**: Run through normal deployment pipeline
4. **Verify**: Confirm data integrity

```bash
# Generate new migration to fix issues
yarn db:migrate:dev --name fix_previous_migration
```

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
      - name: postgres-url
        alias: DATABASE_URL
```

### Required Secrets

Names are **per component** where sharing would be unsafe — `deed-poll-web` reads the same vault, and one
session signing key across a caseworker service and a public one would make a forged cookie portable between
them.

| Secret | Alias | Description |
|--------|-------|-------------|
| `app-insights-connection-string` | `APPLICATION_INSIGHTS_CONNECTION_STRING` | Application Insights telemetry. Shared — `deed-poll-api` is Spring Boot and reads the same entry |
| `postgres-url` | `DATABASE_URL` | PostgreSQL connection string. Shared — one database. Still needed here because this app reads case data through Prisma until the `deed-poll-api` cutover |
| `redis-url` | `REDIS_URL` | Session store. Shared instance, separate key prefix per app |
| `admin-session-secret` | `SESSION_SECRET` | Session cookie signing key |
| `admin-idam-client-secret` | `IDAM_CLIENT_SECRET` | IDAM OIDC client secret. **Does not exist yet** — it comes from IDAM by hand once the client registration lands |

The chart fails to start a pod when a named secret is absent from the vault, so the last two entries are the
ones to check first when a deploy will not come up.

### Adding New Secrets

1. Add the secret to the vault in `hmcts/deed-poll-infra` — not by hand in the portal
2. Update the app's `helm/values.yaml` `keyVaults:` block to reference it
3. Update the application to read the aliased environment variable

## Health Checks

### Liveness Probe

Checks if the application is running:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
```

### Readiness Probe

Checks if the application can accept traffic:

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

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

The deployment scripts handle this automatically, but for manual recovery:

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

#### Database Connection Issues

```bash
# Check postgres pod
kubectl get pods -n {namespace} | grep postgres

# View connection logs
kubectl logs {postgres-pod} -n {namespace}

# Test connection from app pod
kubectl exec -it {app-pod} -n {namespace} -- \
  /bin/sh -c 'echo "SELECT 1;" | psql $DATABASE_URL'
```

### Manual Deployment

If automated deployment fails:

```bash
# 1. Build image locally
docker build -t hmctsprod.azurecr.io/deed-poll/app:manual \
  -f apps/web/Dockerfile .

# 2. Push to registry
docker push hmctsprod.azurecr.io/deed-poll/app:manual

# 3. Deploy with Helm
cd helm/deed-poll-admin
helm dependency update
ENVIRONMENT=aat TEAM_NAME=deed-poll WEB_IMAGE=manual \
  envsubst < values.template.yaml > values.yaml
helm upgrade --install {release-name} . \
  --namespace {namespace} \
  --values values.yaml \
  --set web.nodejs.image=hmctsprod.azurecr.io/deed-poll/app:manual \
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

### Prisma Studio

Access database through Prisma Studio:
- Preview: `https://{team}-{release}-postgres.preview.platform.hmcts.net`
- Production: Internal access only

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
  --set web.nodejs.image=hmctsprod.azurecr.io/deed-poll/app:previous-tag \
  --reuse-values
```

## References

- **Pipelines**: [`PIPELINES.md`](PIPELINES.md) — the Jenkins CNP pipeline, and what is still outstanding
- **Architecture**: [`ARCHITECTURE.md`](ARCHITECTURE.md) — system architecture
- **Shared infrastructure**: [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra) — the vault,
  Redis, Postgres and App Insights this chart depends on
- **Why it is split this way**:
  [`.business_context/DEED_POLL_INFRA_PLAN.md`](../.business_context/DEED_POLL_INFRA_PLAN.md)
