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

# Shared resource group (managed by separate pipeline)
# Contains Key Vault and other shared resources
data "azurerm_resource_group" "shared" {
  name = "${var.product}-${var.env}"
}

# Resource group for resources managed by this terraform
resource "azurerm_resource_group" "rg" {
  name     = "${var.product}-${var.env}-${var.component}"
  location = var.location
  tags     = var.common_tags
}
