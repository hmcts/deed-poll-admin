# @hmcts/postgres

Prisma Studio service with database migration runner. Runs migrations on startup and provides a persistent Prisma Studio interface for database inspection.

## Purpose

This application:
1. Runs database migrations on startup
2. Provides Prisma Studio for database inspection and management
3. Hosts the base Prisma schema and all migration files
4. Deploys as a long-running service using the HMCTS `nodejs` chart
5. Accessible via ingress for viewing database contents

## Structure

```
apps/postgres/
├── prisma/
│   ├── base.prisma        # Base schema (generator + datasource only)
│   ├── schema.prisma      # Collated schema (generated during build)
│   └── migrations/         # All migration files
├── helm/
│   ├── Chart.yaml         # Uses HMCTS nodejs chart v3.2.0
│   └── values.yaml        # Configured as long-running service
├── start.sh               # Startup script: runs migrations, then the health proxy (and Studio if enabled)
├── health-server.mjs      # Health endpoints (port 5555); proxies to Studio (5556) only when enabled
└── Dockerfile             # Executes start.sh
```

### Architecture

The postgres service runs a migration step and then up to two components:
1. **Health Proxy** (port 5555): HTTP server that responds to K8s health checks. Always runs.
2. **Prisma Studio** (port 5556): Database management interface. Runs **only when
   `ENABLE_PRISMA_STUDIO=true`**; the proxy answers 404 for non-health paths otherwise.

This architecture works around the HMCTS nodejs chart v3.2.0 limitation that forces HTTP health checks.

Studio is opt-in because it is an unauthenticated read/write CRUD browser over every table — including
`deedpoll_deedpoll`, `deedpoll_witness` and `onboarding_submission`, which hold applicant names, dates of
birth and addresses — and this pod carries an ingress host. Nothing in front of it checks a user, in a
service where every other surface goes through IDAM. Enable it deliberately and temporarily, for one
environment, and turn it back off.

Local inspection does not go through this service: `yarn db:studio` runs the `studio` script in
`package.json` directly against the Compose database.

## Creating Migrations

### Local Development

```bash
# 1. Collate schemas from all modules
yarn workspace @hmcts/postgres-prisma run collate

# 2. Create a new migration
cd apps/postgres
npx prisma migrate dev --name your_migration_name

# 3. The migration will be created in prisma/migrations/
```

### Migration Naming

Use descriptive names that explain the change:
- `add_user_table`
- `add_email_to_user`
- `create_case_management_tables`

## Deployment

### How It Works

1. **Build**:
   - `yarn build` runs schema collation
   - Collated `schema.prisma` copied to `apps/postgres/dist/`
   - Docker image built with migrations, schema, and startup script

2. **Deploy**:
   - Helm deploys `apps/postgres` as a long-running service
   - On startup, `start.sh` runs `prisma migrate deploy`
   - If migrations fail, `set -e` exits the container, which restarts (per K8s restart policy)
   - If migrations succeed, the health proxy starts on port 5555

3. **Service Runtime**:
   - Health proxy runs continuously
   - Reachable via ingress (e.g., `<team>-<release>-postgres.preview.platform.hmcts.net`)
   - HTTP health checks on port 5555 (`/health/liveness`, `/health/readiness`)
   - All other requests get 404, unless `ENABLE_PRISMA_STUDIO=true`, in which case they are proxied to
     Prisma Studio on port 5556
   - Migrations run again if pod restarts

### Preview Deployments

Migrations run automatically in preview environments:
- Service deploys alongside web/API apps
- Uses same database as preview apps
- Changes detected by Turborepo
- Prisma Studio is **not** exposed. To inspect a preview database, prefer `kubectl port-forward` to the
  Postgres instance over enabling Studio on a public ingress host.

### Production Deployments

Configure via Flux/ArgoCD to:
- Enable the postgres subchart
- Set the correct image tag
- Configure DATABASE_URL via Azure Key Vault
- Leave `ENABLE_PRISMA_STUDIO` unset — an unauthenticated CRUD browser over applicant PII does not belong
  on a production ingress

## Configuration

### Helm Values

**Development/Preview** (`apps/postgres/helm/values.yaml`):
```yaml
nodejs:
  releaseNameOverride: "{{ .Release.Name }}-postgres"
  applicationPort: 5555  # Health proxy port (proxies to Studio on 5556)
  image: hmctsprod.azurecr.io/deed-poll/deed-poll-admin-postgres:latest
  ingressHost: deed-poll-admin-postgres.{{ .Values.global.environment }}.platform.hmcts.net
  # Uses default HTTP health checks provided by nodejs chart
```

### Environment Variables

The postgres service supports two methods of database configuration:

**Method 1: Individual variables** (recommended for K8s secrets):
- `POSTGRES_HOST`: Database hostname
- `POSTGRES_USER`: Database username
- `POSTGRES_PASSWORD`: Database password
- `POSTGRES_PORT`: Database port
- `POSTGRES_DATABASE`: Database name

**Method 2: Connection string**:
- `DATABASE_URL`: PostgreSQL connection string (from Azure Key Vault)

If both methods are provided, individual variables take precedence.

**Prisma Studio**:
- `ENABLE_PRISMA_STUDIO`: set to the exact string `true` to start Studio on port 5556 and proxy
  non-health requests to it. Anything else, including unset, leaves it off.

## Accessing Prisma Studio

Locally, use `yarn db:studio` — it does not go through this service.

In a deployed environment, Studio is off. Prefer `kubectl port-forward` against the Postgres instance;
that gives the same access without publishing an unauthenticated CRUD interface over applicant PII on
`*.platform.hmcts.net`.

If you genuinely need Studio in a non-production environment, set `ENABLE_PRISMA_STUDIO=true` on the
`deed-poll-admin-postgres` component, use it, and unset it again. It is then served on the component's
ingress host (e.g. `https://deed-poll-pr-123-postgres.preview.platform.hmcts.net`) with no login of its
own, so treat it as a temporary, deliberate exception rather than a standing configuration. Do not do
this in production.

## Troubleshooting

### Migration Failed

```bash
# Check pod logs
kubectl logs -n <namespace> <release-name>-postgres

# View pod status
kubectl get pods -n <namespace> -l app=<release-name>-postgres

# Describe pod for events
kubectl describe pod -n <namespace> <release-name>-postgres
```

### Manual Migration Run

```bash
# Port-forward to database
kubectl port-forward -n <namespace> service/postgres 5432:5432

# Set DATABASE_URL
export DATABASE_URL="postgresql://..."

# Run migrations locally
cd apps/postgres
npx prisma migrate deploy
```

### Reset Local Database

```bash
# WARNING: Destroys all data
yarn workspace @hmcts/postgres-prisma run collate
cd apps/postgres
npx prisma migrate reset
```

## Related

- **Schema Collation**: See `libs/postgres-prisma/README.md`
- **Prisma Client**: Exported by `@hmcts/postgres-prisma`
- **Migration Guide**: See `docs/MIGRATION.md`

## Future Improvements

Potential enhancements:
- Add authentication to Prisma Studio (currently open to anyone with ingress access)
- Run migrations as an init container and Studio as main container
- Simplify health proxy once nodejs chart supports custom probe configurations
- Implement read-only mode for production environments
