# Promote Stage

## Purpose

Promotes Docker images from `staging-{sha}` to `prod-{sha}` and `latest` tags after successful E2E tests on master. Also publishes the umbrella Helm chart to the OCI registry.

## Jobs

### Promote Images (`job.promote-images.yml`)

Retags Docker images for each affected app.

#### Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `short-sha` | Yes | Short git SHA for source image tag |
| `string` | `affected-apps` | Yes | JSON array of affected apps |
| `string` | `helm-apps` | Yes | JSON array of all Helm apps |

#### Secrets

| Name | Required | Description |
|------|----------|-------------|
| `REGISTRY_USERNAME` | Yes | ACR username for Docker registry |
| `REGISTRY_PASSWORD` | Yes | ACR password for Docker registry |

### Helm Publish (`job.helm-publish.yml`)

Packages the umbrella Helm chart (with all subcharts bundled) and pushes it to the OCI registry.

#### Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `short-sha` | Yes | Short git SHA for chart version suffix |

#### Secrets

| Name | Required | Description |
|------|----------|-------------|
| `REGISTRY_USERNAME` | Yes | ACR username for Helm OCI registry |
| `REGISTRY_PASSWORD` | Yes | ACR password for Helm OCI registry |

## Behavior

- Only runs if E2E tests pass (`needs.e2e-stage.result == 'success'`)
- Image promotion only runs for affected (rebuilt) apps; Helm publish always runs
- Uses matrix strategy to promote images in parallel
- Pulls `staging-{sha}` tag, retags to `prod-{sha}` and `latest`, pushes both
- Chart version is `<Chart.yaml base version>-<short-sha>` (e.g., `0.0.1-abc1234`)
- Skips chart push if the version already exists in the registry

## Image Tagging Flow

```
Build Stage:     staging-{sha}  (e.g., staging-abc1234)
                      |
E2E Tests:       Test against staging-{sha}
                      |
Promote Stage:   prod-{sha}   (immutable, for traceability/rollback)
                 latest        (mutable, current production)
```

## Helm Chart Flow

```
Promote Stage:   Package umbrella chart as 0.0.1-{sha}
                      |
                 Push to oci://hmctsprod.azurecr.io/helm
```

## Registry

- **Registry**: `hmctsprod.azurecr.io`
- **Image Format**: `{team}/{app-name}:{tag}`
- **Chart Format**: `oci://hmctsprod.azurecr.io/helm/deed-poll-admin:{version}`
