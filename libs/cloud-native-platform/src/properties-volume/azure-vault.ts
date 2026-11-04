import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { parseVaultsFromHelmChart, type SecretDefinition, type VaultDefinition } from "./helm-chart.js";
import type { Config } from "./properties.js";
import { deepMerge, normalizeSecretName } from "./utils.js";

export interface AzureVaultOptions {
  pathToHelmChart: string;
  vaultUriSuffix?: string;
}

const DEFAULT_VAULT_URI_SUFFIX = "aat";

/**
 * Adds secrets from Azure Key Vault to configuration object
 * Matches the API of @hmcts/properties-volume addFromAzureVault function
 *
 * Vault reads run concurrently; declaration order determines alias precedence. A read failure
 * leaves config unchanged, instead of retaining earlier vaults' partial results. The first
 * failing read is reported; other in-flight reads continue without writing to config.
 */
export async function addFromAzureVault(config: Config, options: AzureVaultOptions): Promise<void> {
  const { pathToHelmChart, vaultUriSuffix = DEFAULT_VAULT_URI_SUFFIX } = options;

  try {
    const { vaults, hasKeyVaultsKey, invalidVaultNames } = parseVaultsFromHelmChart(pathToHelmChart);

    if (!hasKeyVaultsKey) {
      console.warn("Azure Vault: No keyVaults found in Helm chart");
      return;
    }

    for (const vaultName of invalidVaultNames) {
      console.warn(`Azure Vault: Invalid vault configuration for '${vaultName}', missing secrets`);
    }

    const vaultConfigs = await Promise.all(vaults.map((vault) => processVault(vault, vaultUriSuffix)));
    const merged = vaultConfigs.reduce((result, secrets) => deepMerge(result, secrets), config);
    Object.assign(config, merged);
  } catch (error: unknown) {
    throw new Error(`Azure Key Vault: ${errorMessage(error)}`);
  }
}

async function processVault(vault: VaultDefinition, vaultUriSuffix: string): Promise<Config> {
  const { name: vaultName, secrets } = vault;

  const vaultUri = `https://${vaultName}-${vaultUriSuffix}.vault.azure.net/`;
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUri, credential);

  try {
    const secretResults = await Promise.all(secrets.map((secret) => processSecret(client, secret)));
    return Object.fromEntries(secretResults.map(({ key, value }) => [key, value]));
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (message && !message.includes(vaultName)) {
      throw new Error(`Vault '${vaultName}': ${message}`);
    }
    throw error;
  }
}

async function processSecret(client: SecretClient, secret: SecretDefinition): Promise<{ key: string; value: string }> {
  const { name: secretName } = secret;
  const configKey = secret.alias ?? normalizeSecretName(secretName);

  try {
    const secretResponse = await client.getSecret(secretName);
    if (!secretResponse.value) {
      throw new Error(`Secret ${secretName} has no value`);
    }
    return { key: configKey, value: secretResponse.value };
  } catch (error: unknown) {
    if (isPermissionDenied(error)) {
      throw new Error(`Could not load secret '${secretName}'. Check it exists and you have access to it.`);
    }
    throw new Error(`Failed to retrieve secret ${secretName}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isPermissionDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { statusCode?: number; message?: string };
  return e.statusCode === 403 || (typeof e.message === "string" && e.message.includes("does not have secrets get permission"));
}
