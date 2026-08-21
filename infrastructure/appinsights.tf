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
  key_vault_id = data.azurerm_key_vault.key_vault.id
}
