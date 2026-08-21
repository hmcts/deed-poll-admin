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
├── start.sh               # Startup script: runs migrations, health proxy, and Studio
├── health-server.mjs      # HTTP proxy for health checks (port 5555) -> Studio (port 5556)
└── Dockerfile             # Executes start.sh
```

### Architecture

The postgres service runs two components:
1. **Health Proxy** (port 5555): HTTP server that responds to K8s health checks and proxies to Studio
2. **Prisma Studio** (port 5556): Database management interface

This architecture works around the HMCTS nodejs chart v3.2.0 limitation that forces HTTP health checks.

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
   - If migrations fail, container restarts (per K8s restart policy)
   - If migrations succeed, health proxy starts on port 5555 and Prisma Studio on port 5556

3. **Service Runtime**:
   - Health proxy and Prisma Studio run continuously
   - Accessible via ingress (e.g., `<team>-<release>-postgres.preview.platform.hmcts.net`)
   - HTTP health checks on port 5555 (`/health/liveness`, `/health/readiness`)
   - All other requests proxied to Prisma Studio on port 5556
   - Migrations run again if pod restarts

### Preview Deployments

Migrations and Studio run automatically in preview environments:
- Service deploys alongside web/API apps
- Uses same database as preview apps
- Prisma Studio accessible at: `<team>-<release>-postgres.preview.platform.hmcts.net`
- Changes detected by Turborepo

### Production Deployments

Configure via Flux/ArgoCD to:
- Enable the postgres subchart
- Set the correct image tag
- Configure DATABASE_URL via Azure Key Vault
- Set appropriate ingress host for Studio access

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

## Accessing Prisma Studio

### Preview Environments

```
https://<team>-<release>-postgres.preview.platform.hmcts.net
```

For example:
```
https://deed-poll-pr-123-postgres.preview.platform.hmcts.net
```

### Production Environments

Access via the configured ingress host in your Flux/ArgoCD values.

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
