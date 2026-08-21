# Terraform Job

## Purpose

Runs Terraform plan and optionally apply against Azure infrastructure. Follows HMCTS patterns for state management using Azure Storage backend.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `environment` | Yes | - | Target environment (e.g., `aat`) |
| `subscription` | Yes | - | Azure subscription name (e.g., `DCD-CNP-DEV`) |
| `storage-account` | Yes | - | Storage account postfix (`nonprod`, `prod`) |
| `plan-only` | No | `false` | Run plan only, skip apply |
| `working-directory` | No | `infrastructure` | Directory containing Terraform files |

## Outputs

| Name | Description |
|------|-------------|
| `plan-exitcode` | Terraform plan exit code: `0` = no changes, `2` = changes detected |

## Artifacts

None

## Secrets

| Name | Required | Description |
|------|----------|-------------|
| `AZURE_CREDENTIALS_CFT_PREVIEW` | Yes | Azure Service Principal credentials (JSON) |

The Service Principal requires:
- Storage Account Key access (to read/write Terraform state)
- Contributor on target resource groups
- Key Vault Secrets Officer (to write secrets)

## Usage

**Plan only (PRs):**
```yaml
terraform:
  name: Terraform
  needs: [terraform-fmt]
  uses: ./.github/workflows/job.terraform.yml
  with:
    environment: aat
    subscription: DCD-CNP-DEV
    storage-account: nonprod
    plan-only: true
  secrets: inherit
```

**Plan and Apply (main branch):**
```yaml
terraform:
  name: Terraform
  needs: [terraform-fmt]
  uses: ./.github/workflows/job.terraform.yml
  with:
    environment: aat
    subscription: DCD-CNP-DEV
    storage-account: nonprod
    plan-only: false
  secrets: inherit
```

The job is typically called from `stage.infrastructure.yml` which handles change detection at the workflow level.

## State Storage

| Component | Pattern |
|-----------|---------|
| Storage Account | `mgmtstatestore{storage-account}` |
| Resource Group | `mgmt-state-store-{storage-account}` |
| Container | `mgmtstatestorecontainer{environment}` |
| State Key | `deed-poll-admin/{environment}/terraform.tfstate` |

The team name is extracted from the `annotations.team` field in `helm/deed-poll-admin/Chart.yaml`.

## Local Development

```bash
cd infrastructure
az login
terraform init \
  -backend-config="storage_account_name=mgmtstatestorenonprod" \
  -backend-config="container_name=mgmtstatestorecontaineraat" \
  -backend-config="resource_group_name=mgmt-state-store-nonprod" \
  -backend-config="key=deed-poll-admin/aat/terraform.tfstate"

terraform plan -var "env=aat" -var "product=deed-poll" -var "subscription=<subscription-id>"
```

## Version Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Terraform CLI | 1.14.x | Pinned in `.terraform-version` |
| AzureRM Provider | ~> 4.57 | Allows patch updates within 4.57.x |
| actions/checkout | v6 | Latest major version |
| hashicorp/setup-terraform | v3 | Latest major version |
| azure/login | v2 | Latest major version |
