import { down, raw, up, web } from "./healthcheck/healthcheck.js";
import { configure } from "./healthcheck/healthcheck-middleware.js";

export * from "./healthcheck/healthcheck.js";
export * from "./monitoring/monitoring-middleware.js";
export * from "./monitoring/monitoring-service.js";
export * from "./monitoring/track-exception.js";
export { addFromAzureVault } from "./properties-volume/azure-vault.js";
export type { GetSecretsOptions, Secrets } from "./properties-volume/properties.js";
export { getPropertiesVolumeSecrets } from "./properties-volume/properties.js";

export const healthcheck = configure;

export const hc = {
  web,
  raw,
  up,
  down
};
