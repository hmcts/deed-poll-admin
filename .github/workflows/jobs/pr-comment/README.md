# PR Comment Job

## Purpose

Adds a comment to the pull request with preview environment URLs and adds cleanup labels for automated environment teardown when the PR is closed.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `change-id` | Yes | PR number or change identifier |
| `string` | `urls` | Yes | Base64-encoded JSON of deployment URLs |

## Artifacts

| Direction | Name | Description |
|-----------|------|-------------|
| - | - | No artifacts consumed or produced |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `CHANGE_ID` | Auto | PR number (set from `inputs.change-id`) |
| `TEAM_NAME` | Auto | Team name from Helm chart annotations |
| `APPLICATION_NAME` | Auto | Application name from Helm chart |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| - | - | Uses `GITHUB_TOKEN` automatically |

## Outputs

| Name | Description |
|------|-------------|
| - | No outputs |

## Scripts

| Script | Purpose |
|--------|---------|
| `get-deployment-urls.sh` | Retrieves ingress URLs from Kubernetes (used by helm-deploy job) |

## PR Labels

The following labels are added for cleanup automation:

| Label | Purpose |
|-------|---------|
| `ns:{team}` | Identifies the Kubernetes namespace |
| `prd:{team}` | Identifies the product/team |
| `rel:{app}-pr-{PR#}` | Identifies the Helm release name |

## Comment Format

The PR comment includes:
- Success header with emoji
- List of all deployed services with their URLs
- Note about automatic cleanup on PR close

## Permissions

- `pull-requests: write` - Required to add labels and comments to PR
