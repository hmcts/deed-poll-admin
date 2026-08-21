# Helm Cleanup Job

## Purpose

Deletes the staging Helm release from the AAT cluster after E2E tests complete. This ensures the staging environment is cleaned up and resources are freed.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `release-name` | Yes | Helm release name to delete |
| `string` | `namespace` | Yes | Kubernetes namespace |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| `AZURE_CREDENTIALS_CFT_AAT` | Yes | Azure service principal credentials for CFT AAT |

## Behavior

- Runs with `if: always()` to ensure cleanup happens even if tests fail
- Uses `helm uninstall` with `--wait` flag
- Tolerates missing releases (idempotent)

## Environment

- **Cluster**: `cft-aat-00-aks`
- **Resource Group**: `cft-aat-00-rg`
