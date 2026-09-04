provider "azurerm" {
  features {
  }
  subscription_id = var.subscription
}

provider "azurerm" {
  alias           = "postgres_network"
  subscription_id = var.aks_subscription_id
  features {}
}

# Product-level resource group, holding the Key Vault and anything else shared between components.
#
# Most HMCTS products create this from a separate `{product}-shared-infrastructure` repo, and all 85 of
# those are driven by Jenkins. deed-poll has no such repo and deploys via GitHub Actions. A second
# Terraform root inside this repo is not an option either: `terraform-deploy/action.yaml` in
# cnp-githubactions-library derives the state key as `{repository name}/{environment}/terraform.tfstate`
# and ignores `working-directory`, so two roots here would share one state file and each apply would
# destroy the other's resources.
#
# deed-poll-admin is also the only component, so there is no second repo for the vault to be shared
# with — the usual reason for splitting these out does not apply. It is therefore created here.
resource "azurerm_resource_group" "shared" {
  name     = "${var.product}-${var.env}"
  location = var.location
  tags     = var.common_tags
}

# Resource group for resources managed by this terraform
resource "azurerm_resource_group" "rg" {
  name     = "${var.product}-${var.env}-${var.component}"
  location = var.location
  tags     = var.common_tags
}
