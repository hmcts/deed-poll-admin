# Smoke Test Job

## Purpose

Performs basic health checks on deployed preview environment services to verify they are responding correctly before running full E2E tests.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `urls` | Yes | Base64-encoded JSON of deployment URLs |

## Artifacts

| Direction | Name | Description |
|-----------|------|-------------|
| - | - | No artifacts consumed or produced |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| - | - | No environment variables required |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| - | - | No secrets required |

## Outputs

| Name | Description |
|------|-------------|
| - | No outputs (pass/fail only) |

## Health Checks

The smoke test performs HTTP health checks on:

1. **Web Service** - Checks the root URL of the web application
2. **API Service** - Checks the root URL of the API

### Success Criteria

- HTTP status code between 200-399
- Response within 30 seconds

### Failure Handling

- If any service returns a 4xx or 5xx status, the job fails
- If a service URL is not found, the check is skipped with a warning

## Runner

This job runs on the `azure-nonprod` runner group which has network access to the preview environment.

## When to Use

This job runs after deployment to quickly verify services are up before investing time in full E2E tests. It catches obvious deployment failures early.
