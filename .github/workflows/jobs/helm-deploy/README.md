# Helm Deploy Job

## Purpose

Deploys the application to Azure Kubernetes Service (AKS) using Helm. Supports multiple environments (preview and AAT) with environment-specific configuration.

## Helm Global Values

HMCTS-specific global values are automatically set by the `helm-deploy` action. See the [helm-deploy action documentation](https://github.com/hmcts/cnp-githubactions-library/tree/main/helm-deploy) for details.

Key values:
- **`global.environment`**: Always `aat` for non-production deployments. Used by charts to construct Azure resource names like KeyVault.
- **`global.tags.*`**: Azure resource tags for billing/reporting (teamName, applicationName, builtFrom, businessArea, environment).

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `change-id` | Yes | PR number or change identifier |
| `string` | `timestamp` | Yes | Build timestamp for image tagging |
| `string` | `short-sha` | Yes | Short git SHA for image tagging |
| `string` | `affected-apps` | Yes | JSON array of affected apps (can be empty `[]`) |
| `string` | `helm-apps` | Yes | JSON array of all Helm apps |
| `string` | `environment` | No | Deployment environment (`preview` or `aat`), default: `preview` |

## Outputs

| Name | Description |
|------|-------------|
| `urls` | Base64-encoded JSON object with deployment URLs |
| `release-name` | Helm release name |
| `namespace` | Kubernetes namespace |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| `AZURE_CREDENTIALS_CFT_PREVIEW` | For preview | Azure credentials for CFT preview |
| `AZURE_CREDENTIALS_CFT_AAT` | For AAT | Azure credentials for CFT AAT |
| `REGISTRY_USERNAME` | Yes | ACR username for Helm chart registry |
| `REGISTRY_PASSWORD` | Yes | ACR password for Helm chart registry |

## Environment Configuration

| Aspect | Preview | AAT |
|--------|---------|-----|
| Cluster | `cft-preview-00-aks` | `cft-aat-00-aks` |
| Resource Group | `cft-preview-00-rg` | `cft-aat-00-rg` |
| Release Name | `{app}-pr-{PR#}` | `{app}-staging` |
| Values Template | `values.preview.template.yaml` | None (base values) |

## Permissions

- `contents: read` - Read repository contents
- `id-token: write` - Required for Azure OIDC authentication
- `pull-requests: write` - Add labels and comments to PR
