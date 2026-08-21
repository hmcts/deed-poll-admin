import { readFileSync } from "node:fs";
import { load as yamlLoad } from "js-yaml";
import { deepSearch } from "./utils.js";

export function parseVaultsFromHelmChart(chartPath: string): ParsedHelmChart {
  const chart = yamlLoad(readFileSync(chartPath, "utf8"));
  const keyVaultsEntries = deepSearch(chart, "keyVaults");

  const vaults: VaultDefinition[] = [];
  const invalidVaultNames: string[] = [];

  for (const entry of keyVaultsEntries) {
    if (!isRecord(entry)) continue;
    for (const [name, config] of Object.entries(entry)) {
      const secrets = parseSecrets(config);
      if (secrets) {
        vaults.push({ name, secrets });
      } else {
        invalidVaultNames.push(name);
      }
    }
  }

  return { vaults, hasKeyVaultsKey: keyVaultsEntries.length > 0, invalidVaultNames };
}

function parseSecrets(vaultConfig: unknown): SecretDefinition[] | null {
  if (!isRecord(vaultConfig) || !Array.isArray(vaultConfig.secrets)) return null;
  return vaultConfig.secrets.map(parseSecret).filter((s): s is SecretDefinition => s !== null);
}

function parseSecret(secret: unknown): SecretDefinition | null {
  if (typeof secret === "string") return { name: secret };
  if (!isRecord(secret) || typeof secret.name !== "string") return null;
  return typeof secret.alias === "string" ? { name: secret.name, alias: secret.alias } : { name: secret.name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface VaultDefinition {
  name: string;
  secrets: SecretDefinition[];
}

export interface SecretDefinition {
  name: string;
  alias?: string;
}

export interface ParsedHelmChart {
  vaults: VaultDefinition[];
  hasKeyVaultsKey: boolean;
  invalidVaultNames: string[];
}
