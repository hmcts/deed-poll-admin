# Helm Publish Job

## Purpose

Packages the umbrella Helm chart (with all subcharts bundled) and pushes it to the OCI registry in ACR. Runs as part of the Promote stage after successful E2E tests on master.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `short-sha` | Yes | Short git SHA used as chart version suffix |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| `REGISTRY_USERNAME` | Yes | ACR username for Helm OCI registry |
| `REGISTRY_PASSWORD` | Yes | ACR password for Helm OCI registry |

## Behavior

- Logs in to the OCI registry using basic credentials (no OIDC)
- Runs `helm dependency update` on each subchart in `apps/*/helm` to resolve OCI and repo dependencies
- Builds the umbrella chart at `helm/deed-poll-admin` with all subcharts bundled
- Versions the chart as `<Chart.yaml base version>-<short-sha>` (e.g., `0.0.1-abc1234`)
- Skips push if the version already exists in the registry (idempotent on re-runs)

## Chart Structure

```
helm/deed-poll-admin/     (umbrella)
├── apps/api/helm/                    (subchart)
├── apps/web/helm/                    (subchart)
├── apps/postgres/helm/               (subchart)
├── apps/crons/helm/                  (subchart)
└── postgresql (HMCTS)                (dependency)
```

## Registry

- **Registry**: `hmctsprod.azurecr.io`
- **Chart location**: `oci://hmctsprod.azurecr.io/helm/deed-poll-admin`
- **Pull example**: `helm pull oci://hmctsprod.azurecr.io/helm/deed-poll-admin --version 0.0.1-abc1234`
