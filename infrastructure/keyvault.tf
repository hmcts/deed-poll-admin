# Key Vault for deed-poll, and the workload identity the pods read it with.
#
# This replaces a `data` lookup of a vault that does not exist. Nothing had ever created it, so
# `terraform plan` failed before it reached any resource in this root — see main.tf for why it is
# created here rather than in a `deed-poll-shared-infrastructure` repo.

module "key_vault" {
  # HTTPS, not the `git@github.com:` form the template's commented example suggested. GitHub Actions
  # runners have no deploy key for hmcts repos, so the SSH source cannot clone. This matches the other
  # two modules in this root. The module publishes no tags or releases, so `master` is the only ref
  # available.
  source = "git::https://github.com/hmcts/cnp-module-key-vault?ref=master"

  product             = var.product
  env                 = var.env
  resource_group_name = azurerm_resource_group.shared.name
  common_tags         = var.common_tags

  # `name` is deliberately not set. The module defaults the vault name to `{product}-{env}`, which is
  # what the Helm charts resolve: every apps/*/helm/values.yaml declares `keyVaults: deed-poll:` and the
  # CNP chart appends the environment. An override here would silently stop all four charts finding
  # their secrets.

  # Write access for the CI principal, which is what puts the secrets below and in appinsights.tf and
  # postgres.tf into the vault. terraform-deploy passes this automatically.
  object_id = var.ci_service_principal_object_id

  # Creates `deed-poll-{env}-mi` in `managed-identities-{env}-rg` and grants it Get/List on secrets via
  # the module's own implicit_managed_identity_access_policy. That identity is how the pods read the
  # vault, so this is load-bearing rather than an optional extra.
  create_managed_identity = true

  # An AAD group that has to exist already: team-access.tf looks it up by display name, and its access
  # policy is created unconditionally, so an empty value fails the apply on an invalid object_id rather
  # than being skipped. Comparable repos name a product-specific group — pt uses "DTS Property Tribunal",
  # pcs "DTS Possession Claim Service" — but there is no deed-poll equivalent yet. "DTS CFT Developers"
  # is the CFT-wide group the module already reads in developer-access.tf, so it is known to exist.
  # Narrow this to a "DTS Deed Poll" group once one has been created.
  product_group_name = "DTS CFT Developers"
}

# The session secret signs the session cookie, and from Phase 5 that cookie is what asserts a user is
# signed in and which roles they hold. It is ours to generate rather than IDAM's to issue, so there is no
# reason for it to be a manual step. random_password holds its value in state, so it is generated once
# and not rotated on each apply — rotating it would sign every live session out.
resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "azurerm_key_vault_secret" "session_secret" {
  name         = "session-secret"
  value        = random_password.session_secret.result
  key_vault_id = module.key_vault.key_vault_id

  # Referencing key_vault_id alone only depends on the vault, not on the access policy that lets the CI
  # principal write to it, so without this the first apply can race and fail with 403. The same applies
  # to every azurerm_key_vault_secret in this root.
  depends_on = [module.key_vault]
}

# `idam-client-secret` is deliberately absent. It is the confidential client's secret and comes from
# IDAM's reply to .business_context/IDAM_REGISTRATION_REQUEST.md, so there is no value to generate here.
# It has to be added to the vault by hand once IDAM responds. apps/web/helm/values.yaml requires it, and
# the chart fails on a missing secret, which is the right way round: the alternative is a client that
# cannot complete a code exchange failing silently at runtime.
