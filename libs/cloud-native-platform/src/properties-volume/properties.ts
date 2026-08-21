import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addFromAzureVault } from "./azure-vault.js";
import { parseVaultsFromHelmChart } from "./helm-chart.js";

const DEFAULT_MOUNT_POINT = "/mnt/secrets";

export async function getPropertiesVolumeSecrets(options: GetSecretsOptions = {}): Promise<Secrets> {
  const isProd = process.env.NODE_ENV === "production";
  const { mountPoint = DEFAULT_MOUNT_POINT, failOnError = isProd, injectEnvVars = true, chartPath, omit = [], vaultUriSuffix } = options;

  const azureResult = await tryLoadFromAzureVault(chartPath, isProd, injectEnvVars, omit, failOnError, vaultUriSuffix);
  if (azureResult) {
    return azureResult;
  }

  if (!existsSync(mountPoint)) {
    return handleMissingMountPoint(mountPoint, failOnError);
  }

  const aliasMap = chartPath ? buildAliasMap(chartPath) : new Map<string, string>();
  return loadSecretsFromMountPoint(mountPoint, injectEnvVars, failOnError, aliasMap);
}

function buildAliasMap(chartPath: string): Map<string, string> {
  try {
    const aliases = parseVaultsFromHelmChart(chartPath)
      .vaults.flatMap((vault) => vault.secrets)
      .filter((secret): secret is Required<typeof secret> => secret.alias !== undefined);
    return new Map(aliases.map(({ name, alias }) => [name, alias]));
  } catch {
    return new Map();
  }
}

async function tryLoadFromAzureVault(
  chartPath: string | undefined,
  isProd: boolean,
  injectEnvVars: boolean,
  omit: string[],
  failOnError: boolean,
  vaultUriSuffix: string | undefined
): Promise<Secrets | null> {
  if (!chartPath || isProd || !existsSync(chartPath)) {
    return null;
  }

  try {
    return await loadFromAzureVault(chartPath, injectEnvVars, omit, vaultUriSuffix);
  } catch (error) {
    if (failOnError) {
      throw new Error(`Failed to load secrets from Azure Vault: ${error}`);
    }
    console.warn(`Warning: Failed to load secrets from Azure Vault: ${error}`);
    return null;
  }
}

function handleMissingMountPoint(mountPoint: string, failOnError: boolean): Secrets {
  const message = `Mount point ${mountPoint} does not exist`;
  if (failOnError) {
    throw new Error(message);
  }
  console.warn(`Warning: ${message}`);
  return {};
}

function loadSecretsFromMountPoint(mountPoint: string, injectEnvVars: boolean, failOnError: boolean, aliasMap: Map<string, string>): Secrets {
  const secrets: Secrets = {};
  const entries = readdirSync(mountPoint, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(mountPoint, entry.name);
    processEntry(entry, path, injectEnvVars, secrets, failOnError, mountPoint, aliasMap);
  }

  return secrets;
}

function processEntry(
  entry: { name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink?: () => boolean },
  path: string,
  injectEnvVars: boolean,
  secrets: Secrets,
  failOnError: boolean,
  mountPoint: string,
  aliasMap: Map<string, string>
): void {
  try {
    if (entry.isDirectory()) {
      readSecretsFromDirectory(path, entry.name, injectEnvVars, secrets, failOnError, aliasMap);
    } else if (entry.isFile() || entry.isSymbolicLink?.()) {
      const content = readSecretFile(path);
      const alias = aliasMap.get(entry.name);
      processSecret(entry.name, content, injectEnvVars, secrets, alias);
    }
  } catch (error) {
    if (failOnError) {
      throw new Error(`Failed to load secrets from ${mountPoint}: ${error}`);
    }
    console.warn(`Warning: Failed to process ${path}: ${error}`);
  }
}

async function loadFromAzureVault(chartPath: string, injectEnvVars: boolean, omit: string[], vaultUriSuffix: string | undefined): Promise<Secrets> {
  const config: Config = {};
  await addFromAzureVault(config, { pathToHelmChart: chartPath, vaultUriSuffix });

  const secrets: Secrets = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && !shouldOmit(key, omit)) {
      secrets[key] = value;
      if (injectEnvVars) {
        process.env[key] = value;
      }
    }
  }
  return secrets;
}

function readSecretsFromDirectory(
  dirPath: string,
  vaultName: string,
  injectEnvVars: boolean,
  secrets: Secrets,
  failOnError: boolean,
  aliasMap: Map<string, string>
): void {
  // Filter for files and symlinks, but exclude CSI driver internal entries (start with ..)
  const files = readdirSync(dirPath, { withFileTypes: true }).filter((f) => !f.name.startsWith("..") && (f.isFile() || f.isSymbolicLink?.()));

  for (const file of files) {
    const secretKey = `${vaultName}.${file.name}`;
    const alias = aliasMap.get(file.name);

    try {
      const content = readSecretFile(join(dirPath, file.name));
      processSecret(secretKey, content, injectEnvVars, secrets, alias);
    } catch (error) {
      if (failOnError) throw error;
      console.warn(`Warning: Failed to read ${join(dirPath, file.name)}: ${error}`);
    }
  }
}

function readSecretFile(path: string): string {
  return readFileSync(path, "utf8").trim();
}

function processSecret(key: string, value: string, injectEnvVars: boolean, secrets: Secrets, alias?: string): void {
  secrets[key] = value;
  if (injectEnvVars) {
    const envKey = alias ?? key.split(".").at(-1) ?? key;
    process.env[envKey] = value;
  }
}

function shouldOmit(key: string, omit: string[]): boolean {
  if (omit.length === 0) return false;

  const lastName = key.split(".").at(-1) ?? key;
  return omit.includes(key) || omit.includes(lastName);
}

export interface GetSecretsOptions {
  mountPoint?: string;
  failOnError?: boolean;
  injectEnvVars?: boolean;
  chartPath?: string;
  omit?: string[];
  vaultUriSuffix?: string;
}

export interface Secrets {
  [key: string]: string;
}

export interface Config {
  [key: string]: any;
}
