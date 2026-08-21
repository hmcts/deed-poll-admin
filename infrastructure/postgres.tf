module "postgresql" {
  providers = {
    azurerm.postgres_network = azurerm.postgres_network
  }

  source        = "git::https://github.com/hmcts/terraform-module-postgresql-flexible?ref=master"
  name          = "${var.product}-${var.env}"
  env           = var.env
  product       = var.product
  component     = var.component
  business_area = "cft"
  common_tags   = var.common_tags

  # Use expanded subnet - original postgresql subnet is full
  subnet_suffix = "expanded"

  pgsql_databases = [
    {
      name = "deed-poll-admin"
    }
  ]

  pgsql_sku            = "GP_Standard_D2ds_v4"
  pgsql_version        = "16"
  pgsql_storage_mb     = 65536
  auto_grow_enabled    = true
  admin_user_object_id = var.ci_service_principal_object_id
}

resource "azurerm_key_vault_secret" "postgres_host" {
  name         = "postgres-host"
  value        = module.postgresql.fqdn
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

resource "azurerm_key_vault_secret" "postgres_user" {
  name         = "postgres-user"
  value        = module.postgresql.username
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

resource "azurerm_key_vault_secret" "postgres_password" {
  name         = "postgres-password"
  value        = module.postgresql.password
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

resource "azurerm_key_vault_secret" "postgres_port" {
  name         = "postgres-port"
  value        = "5432"
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

resource "azurerm_key_vault_secret" "postgres_url" {
  name         = "postgres-url"
  value        = "postgresql://${module.postgresql.username}:${module.postgresql.password}@${module.postgresql.fqdn}:5432/deed-poll-admin?sslmode=require"
  key_vault_id = data.azurerm_key_vault.key_vault.id
}
