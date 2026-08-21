# Test Job

## Purpose

Runs unit tests with coverage collection and SonarCloud analysis. Uses Turborepo to intelligently run tests only on changed packages for PRs while running the full suite on master for complete coverage tracking.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| - | - | - | No inputs required |

## Artifacts

| Direction | Name | Description |
|-----------|------|-------------|
| Produced | `coverage-reports-{run_id}` | Merged LCOV coverage report |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| - | - | No environment variables required |

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| `SONAR_TOKEN` | Yes | SonarCloud authentication token for code quality analysis |

## Outputs

| Name | Description |
|------|-------------|
| - | No outputs (pass/fail only, artifacts uploaded separately) |

## Workflow Steps

1. **Checkout** - Clone repository with full history for change detection
2. **Setup Node.js** - Configure Node.js using `.nvmrc` version
3. **Install dependencies** - Run `yarn install --immutable`
4. **Generate Prisma client** - Generate database client code
5. **Run unit tests** - Execute tests via Turborepo with coverage collection
6. **Merge coverage reports** - Combine coverage from all packages using `lcov-result-merger`
7. **Upload coverage artifacts** - Store coverage report for SonarCloud analysis
8. **Setup SonarCloud Project** - Configure SonarCloud (master/main only)
9. **SonarQube Scan** - Run code quality analysis

## Smart Filtering

- **Pull Requests**: Only tests packages that changed compared to base branch
- **Push to master**: Runs full test suite to ensure complete coverage data

## SonarCloud Integration

SonarCloud analysis runs on every PR and push. Project setup (creating the project in SonarCloud) only runs on master/main branches via the `setup-sonarcloud-project.sh` script located in `.github/scripts/`.
