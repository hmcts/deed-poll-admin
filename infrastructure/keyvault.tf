# Key Vault configuration
# References an existing Key Vault created by another process

data "azurerm_key_vault" "key_vault" {
  name                = "${var.product}-${var.env}"
  resource_group_name = data.azurerm_resource_group.shared.name
}

# =============================================================================
# EXAMPLE: Creating a Key Vault (uncomment if you need to create one)
# =============================================================================
#
# The required variables (tenant_id, ci_service_principal_object_id) are already
# defined in variables.tf and auto-derived from Azure credentials in CI.
#
# module "key_vault" {
#   source              = "git@github.com:hmcts/cnp-module-key-vault?ref=master"
#   product             = var.product
#   env                 = var.env
#   tenant_id           = var.tenant_id
#   object_id           = var.ci_service_principal_object_id
#   resource_group_name = data.azurerm_resource_group.rg.name
#
#   # Set to your team's AAD group name for access
#   product_group_name      = "dcd_${var.product}"
#   common_tags             = var.common_tags
#   create_managed_identity = true
# }
#
# Then reference the Key Vault ID as: module.key_vault.key_vault_id
# Instead of: data.azurerm_key_vault.key_vault.id
