# Build and Publish Images Job

## Purpose

Detects which applications have been affected by code changes using Turborepo, then builds and publishes Docker images for those applications to Azure Container Registry. Uses a matrix strategy to build affected apps in parallel.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `change-id` | Yes | PR number or change identifier |

## Artifacts

| Direction | Name | Description |
|-----------|------|-------------|
| Produced | Docker images | Pushed to Azure Container Registry (not GitHub artifacts) |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `CHANGE_ID` | Auto | PR number (set from `inputs.change-id`) |
| `SHORT_SHA` | Auto | Git SHA (set automatically from `github.sha`) |
| `REGISTRY` | Auto | Container registry URL (`hmctsprod.azurecr.io`) |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| `REGISTRY_LOGIN_SERVER` | Yes | Azure Container Registry login server URL |
| `REGISTRY_USERNAME` | Yes | ACR username for authentication |
| `REGISTRY_PASSWORD` | Yes | ACR password for authentication |

## Outputs

| Name | Description |
|------|-------------|
| `affected-apps` | JSON array of apps that were affected by changes |
| `helm-apps` | JSON array of all apps with Helm charts |
| `has-changes` | Boolean indicating if any apps need rebuilding |
| `timestamp` | Build timestamp (YYYYMMDDHHmmss format) |
| `short-sha` | Short git SHA (first 7 characters) |

## Internal Jobs

### detect-affected
Runs Turborepo to identify which apps have changed compared to the base branch.

### build-and-publish
Builds Docker images for each affected app using a matrix strategy. Each app is built in parallel.

## Scripts

| Script | Purpose |
|--------|---------|
| `detect-affected-apps.sh` | Uses Turborepo to identify changed apps with Dockerfiles |
| `generate-build-metadata.sh` | Extracts metadata from Helm charts for image tagging |
| `set-image-variables.sh` | Sets image tag environment variables (used by deploy stage) |

## Image Tagging Strategy

Each affected app gets two Docker image tags:

1. **SHA tag**: `pr-{PR#}-{short-sha}` - Forces pod recreation on Helm upgrade
2. **PR tag**: `pr-{PR#}` - Stable tag for the PR

Unchanged apps use the `latest` tag to avoid unnecessary image builds.

## Permissions

- `contents: read` - Read repository contents
- `id-token: write` - Required for Azure authentication
