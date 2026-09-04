variable "env" {
  description = "Environment name (e.g., aat, prod)"
  type        = string
}

variable "product" {
  description = "Product name"
  type        = string
}

variable "component" {
  # This repo is `deed-poll-admin`, and HMCTS repos are named `{product}-{component}` — so the product
  # is `deed-poll` and the component is `admin`.
  #
  # The default is load-bearing, not a fallback: `cnp-githubactions-library/terraform-deploy` passes
  # `env`, `product`, `subscription`, `aks_subscription_id`, `tenant_id`, `builtFrom` and
  # `ci_service_principal_object_id`, and **does not pass `component` at all** — it derives `product`
  # from `annotations.team` in the chart and leaves this one alone. It was still the template's
  # `expressjs`, which would have named the resource group `deed-poll-aat-expressjs` and tagged the
  # Postgres server the same way.
  description = "Component name, used for resource group naming and passed to the Postgres module"
  type        = string
  default     = "admin"
}

variable "subscription" {
  description = "Azure subscription name"
  type        = string
}

variable "aks_subscription_id" {
  description = "Azure subscription ID for AKS cluster (contains network subnets)"
  type        = string
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "uksouth"
}

variable "common_tags" {
  description = "Common tags for resources"
  type        = map(string)
  default     = {}
}

# Optional variables - auto-derived from Azure credentials in CI
# Only needed if creating resources (e.g., Key Vault)

variable "tenant_id" {
  description = "Azure AD tenant ID (auto-derived from CI credentials)"
  type        = string
  default     = null
}

variable "ci_service_principal_object_id" {
  description = "Azure AD object ID for CI/CD service principal (auto-derived from CI credentials)"
  type        = string
  default     = null
}

variable "builtFrom" {
  description = "GitHub repository URL for tagging (auto-set in CI)"
  type        = string
  default     = null
}
