# Terraform Format Job

## Purpose

Validates that all Terraform files are properly formatted. Fails fast if formatting issues are detected.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `working-directory` | No | `infrastructure` | Directory containing Terraform files |

## Outputs

None

## Artifacts

None

## Secrets

None required - format check runs without Azure authentication.

## Usage

```yaml
terraform-fmt:
  name: Terraform Format
  uses: ./.github/workflows/job.terraform-fmt.yml
```

The job is typically called from `stage.infrastructure.yml` which handles change detection at the workflow level.

## Local Development

```bash
cd infrastructure
terraform fmt -recursive
```

## Version Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Terraform CLI | 1.14.x | Pinned in `.terraform-version` |
| hashicorp/setup-terraform | v3 | Latest major version |
