# Lint Job

## Purpose

Runs code quality checks including Biome linting and Prisma schema validation. Uses Turborepo to intelligently run lint only on changed packages for PRs.

## Inputs

| Type | Name | Required | Description |
|------|------|----------|-------------|
| - | - | - | No inputs required |

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

## Workflow Steps

1. **Checkout** - Clone repository with full history for change detection
2. **Setup Node.js** - Configure Node.js using `.nvmrc` version
3. **Install dependencies** - Run `yarn install --immutable`
4. **Generate Prisma client** - Generate database client code
5. **Validate Prisma schema** - Run `prisma validate` to check schema validity
6. **Run lint** - Execute Biome linting via Turborepo with smart filtering for PRs

## Smart Filtering

- **Pull Requests**: Only lints packages that changed compared to base branch
- **Push to master**: Lints all packages
