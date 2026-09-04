# Outputs

output "vault_name" {
  description = "Key Vault name. Should be deed-poll-{env}, which is what the Helm charts resolve from `keyVaults: deed-poll:`"
  value       = module.key_vault.key_vault_name
}

output "vault_uri" {
  description = "Key Vault URI, for adding idam-client-secret by hand once IDAM responds"
  value       = module.key_vault.key_vault_uri
}

# `one()` rather than an index: the module's outputs are splat expressions over a counted resource, so
# they are lists that are empty unless create_managed_identity is set. one() returns null instead of
# failing if that ever changes.
output "managed_identity_client_id" {
  description = "Client ID of deed-poll-{env}-mi, the workload identity the pods read the vault with"
  value       = one(module.key_vault.managed_identity_clientid)
}

output "shared_resource_group_name" {
  value = azurerm_resource_group.shared.name
}

output "component_resource_group_name" {
  value = azurerm_resource_group.rg.name
}
