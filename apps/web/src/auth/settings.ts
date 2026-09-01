/**
 * IDAM settings, read from `config` once per call rather than captured at import time.
 *
 * Not a module-level constant because `getPropertiesVolumeSecrets()` in `app.ts` populates the
 * environment from Azure Key Vault *during* app creation, and `config` resolves
 * `custom-environment-variables.json` lazily. A constant evaluated at import would capture the
 * placeholder defaults instead of the real secrets.
 */
import config from "config";
import type { IdamConfig } from "./idam.js";

export function idamSettings(): IdamConfig {
  return {
    issuerUrl: config.get<string>("idam.issuerUrl"),
    clientId: config.get<string>("idam.clientId"),
    clientSecret: config.get<string>("idam.clientSecret"),
    redirectUri: config.get<string>("idam.redirectUri"),
    scope: config.get<string>("idam.scope")
  };
}
