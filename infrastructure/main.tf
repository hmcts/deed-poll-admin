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
# A second reason given when this was written — that deed-poll-admin is the only component, so there is
# no second repo for the vault to be shared with — **no longer holds.** A Spring Boot `deed-poll-api`
# in its own repo is planned (`.business_context/DEED_POLL_API_PLAN.md`), which is exactly the second
# component the usual split exists for. Reviewed on 2026-09-04 and kept here anyway, deliberately: the
# alternative is a third repo and a third Jenkins onboarding, and `deed-poll-api` can read this vault as
# a `data` source. The coupling that buys is that `deed-poll-api` cannot deploy until this root has
# applied once, and nothing enforces that ordering mechanically.
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
