terraform {
  backend "azurerm" {}

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.57"
    }

    # cnp-module-key-vault reads AAD groups (team-access.tf, developer-access.tf) but declares no
    # required_providers of its own, so the constraint has to live here or the version is unpinned.
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }

    # Generates the session secret in keyvault.tf.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  required_version = ">= 1.14.0"
}
