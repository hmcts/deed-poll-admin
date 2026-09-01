/**
 * IDAM settings, read from `config` once per call rather than captured at import time.
 *
 * Not a module-level constant because `getPropertiesVolumeSecrets()` in `app.ts` populates the
 * environment from Azure Key Vault *during* app creation, and `config` resolves
 * `custom-environment-variables.json` lazily. A constant evaluated at import would capture the
 * placeholder defaults instead of the real secrets.
 */
import { plainHttpPermitted } from "@hmcts/deed-poll";
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

/**
 * Refuse to start on IDAM settings that cannot work, outside development and test.
 *
 * These are the two values with a plausible-looking local default and no other way to be checked. Both
 * fail late and confusingly if wrong: **IDAM rejects a `redirect_uri` that does not match a registered
 * one exactly**, so the symptom is an error on IDAM's own page after a successful login, which reads to
 * a caseworker as "the service is broken" and to an operator as nothing at all — no request ever reaches
 * this app. An empty client secret fails one step later, at the code exchange, as a 403 from the
 * callback.
 *
 * A deployed `redirect_uri` of `http://localhost:3000/...` is the specific accident worth catching: it
 * is `config/default.json`'s value, so it applies to any environment where the Helm chart does not set
 * `IDAM_REDIRECT_URI` — which is exactly what happened when it was set in the subchart whose
 * `ingressHost` the root chart overrides.
 *
 * Same allowlist and the same reason as `assertSessionSecret` and `plainHttpPermitted`: a
 * `!== "production"` test would let all of this through in `aat` and in preview.
 */
export function assertIdamSettings(settings: IdamConfig): void {
  if (plainHttpPermitted()) return;

  const { protocol, hostname } = new URL(settings.redirectUri);

  if (hostname === "localhost" || hostname === "127.0.0.1" || protocol !== "https:") {
    throw new Error(
      `IDAM_REDIRECT_URI is ${settings.redirectUri} under NODE_ENV ${JSON.stringify(process.env.NODE_ENV)}. IDAM refuses a redirect_uri that does not match a registered one, so login would fail after the user has already authenticated. Set it to this environment's ingress host plus /oauth2/callback.`
    );
  }

  if (settings.clientSecret.trim().length === 0) {
    throw new Error(
      `IDAM_CLIENT_SECRET is empty under NODE_ENV ${JSON.stringify(process.env.NODE_ENV)}. The code exchange sends it, so every login would fail at the callback. It comes from the idam-client-secret key vault entry.`
    );
  }
}
