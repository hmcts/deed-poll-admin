# Detect Changes Job

## Purpose

Detects if files matching a specified pattern have changed between the current commit and the base branch (PRs) or previous commit (pushes). Use this to conditionally skip expensive jobs when irrelevant files change.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `paths` | Yes | - | Regex pattern for paths to check |

## Common Patterns

| Use Case | Pattern |
|----------|---------|
| Code changes | `^(yarn\\.lock\|apps/\|libs/)` |
| Infrastructure changes | `^infrastructure/` |
| Helm changes | `^helm/` |
| E2E test changes | `^e2e-tests/` |

## Outputs

| Name | Description |
|------|-------------|
| `has-changes` | `'true'` if changes detected, `'false'` otherwise |

## Secrets

None required.

## Usage

```yaml
jobs:
  detect-code-changes:
    name: Detect Code Changes
    uses: ./.github/workflows/job.detect-changes.yml
    with:
      paths: "^(yarn\\.lock|apps/|libs/)"

  detect-infra-changes:
    name: Detect Infrastructure Changes
    uses: ./.github/workflows/job.detect-changes.yml
    with:
      paths: "^infrastructure/"

  build-stage:
    name: Build
    needs: [detect-code-changes]
    if: needs.detect-code-changes.outputs.has-changes == 'true'
    uses: ./.github/workflows/stage.build.yml
    ...

  infrastructure-stage:
    name: Infrastructure
    needs: [detect-infra-changes]
    if: needs.detect-infra-changes.outputs.has-changes == 'true'
    uses: ./.github/workflows/stage.infrastructure.yml
    ...
```

## Change Detection Logic

| Event | Base Comparison |
|-------|-----------------|
| Pull Request | `origin/{base_branch}` (e.g., `origin/master`) |
| Push | Previous commit (`github.event.before`) |

## Pipeline Integration

```
workflow.preview.yml / workflow.main.yml:
├── detect-code-changes   ─┬─► build-stage (if code changes)
│                          │
└── detect-infra-changes  ─┴─► infrastructure-stage (if infra changes)
```

Both detection jobs run in parallel at the start of the workflow, allowing stages to be skipped independently based on what files changed.
