# E2E Test Job

## Purpose

Runs Playwright end-to-end tests against the deployed preview environment. Tests run on Azure-hosted runners with access to the preview cluster network.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| `string` | `urls` | Yes | Base64-encoded JSON of deployment URLs |

## Artifacts

| Direction | Name | Description |
|-----------|------|-------------|
| Produced | `playwright-test-results` | Test screenshots and traces (on failure only) |
| Produced | `application-logs` | Server logs captured during test run (on failure only) |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `EXPRESSJS_MONOREPO_TEMPLATE_WEB_URL` | Auto | Web application URL for E2E tests |
| `EXPRESSJS_MONOREPO_TEMPLATE_API_URL` | Auto | API URL for E2E tests |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| - | - | No secrets required |

## Outputs

| Name | Description |
|------|-------------|
| - | No outputs (results posted to PR) |

## Runner

This job runs on the `azure-nonprod` runner group which has network access to the preview Kubernetes cluster.

## Test Configuration

- **Browser**: Chromium only (faster than full browser matrix)
- **Timeout**: 15 minutes maximum
- **Results Format**: JUnit XML for GitHub integration

## Test Reporting

Test results are published in multiple ways:

1. **GitHub Checks** - Via `dorny/test-reporter`
2. **PR Comment** - Via `EnricoMi/publish-unit-test-result-action`
3. **Artifacts** - Playwright traces and screenshots on failure

## Failure Handling

On test failure:
- Playwright test results (screenshots, traces) are uploaded
- Application logs are uploaded for debugging
- Test report is still published with failure details

## Permissions

- `contents: read` - Read repository contents
- `checks: write` - Create check runs for test results
- `pull-requests: write` - Post test result comments
- `actions: read` - Read workflow artifacts
