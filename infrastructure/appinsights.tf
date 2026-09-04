# Application Insights configuration
# Creates App Insights using the HMCTS module

module "application_insights" {
  source = "git::https://github.com/hmcts/terraform-module-application-insights?ref=4.x"

  env     = var.env
  product = var.product
  name    = "${var.product}-${var.component}-appinsights"

  resource_group_name = azurerm_resource_group.rg.name

  common_tags = var.common_tags
}

# Store App Insights connection string in Key Vault
# Secret name must match Helm values (apps/*/helm/values.yaml)
resource "azurerm_key_vault_secret" "app_insights_connection_string" {
  name         = "ExpressJsAppInsightsConnectionString"
  value        = module.application_insights.connection_string
  key_vault_id = module.key_vault.key_vault_id

  # key_vault_id alone depends only on the vault, not on the access policy that lets the CI principal
  # write to it, so without this the first apply can race and fail with 403. See keyvault.tf.
  depends_on = [module.key_vault]
}
