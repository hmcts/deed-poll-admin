# Cloud-Native Platform helpers for Express

HMCTS-flavoured helpers for running Express services on the cloud-native platform: Kubernetes-friendly health checks, Application Insights monitoring, and properties-volume / Azure Key Vault secret loading.

## Install

```bash
yarn add @hmcts-cft/cloud-native-platform
```

This package is published to the HMCTS Azure Artifacts `hmcts-lib` feed. Add a scope mapping to your `.npmrc`:

```
@hmcts-cft:registry=https://pkgs.dev.azure.com/hmcts/Artifacts/_packaging/hmcts-lib/npm/registry/
```

`express` is a peer dependency. `config` is also a peer dependency, required only when using `addFromAzureVault`.

## Health checks

Mount the `healthcheck` middleware to expose Kubernetes-style probes at `/health`, `/health/liveness`, and `/health/readiness` (plus the bare aliases `/liveness` and `/readiness`):

```typescript
import express from "express";
import { hc, healthcheck } from "@hmcts-cft/cloud-native-platform";

const app = express();

app.use(
  healthcheck({
    checks: {
      redis: hc.raw(() => redisConnection.ping()),
      upstream: hc.web("https://example-api.internal/health")
    }
  })
);
```

Each endpoint returns `{ status, services }` with HTTP 200 when everything reports `"UP"` or 503 otherwise. `readinessChecks` defaults to `checks` but can be supplied separately for stricter readiness gating.

### Check builders

- **`hc.up()` / `hc.down()`** — constant checks, mostly for tests.
- **`hc.web(url, timeout = 10000)`** — passes if a GET to `url` returns 2xx within `timeout` ms.
- **`hc.raw(check)`** — wraps an arbitrary check function. Returns `"DOWN"` if it throws; any non-`"DOWN"` resolution (including `void`, strings, `Promise<string>` from `redis.ping()`) counts as `"UP"`. Return `"DOWN"` explicitly to fail without throwing.

## Application Insights monitoring

`monitoringMiddleware` initialises Application Insights and tracks every request as a dependency:

```typescript
import { monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";

app.use(
  monitoringMiddleware({
    serviceName: "my-service",
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "",
    enabled: process.env.NODE_ENV === "production"
  })
);
```

If `enabled` is false (e.g. local dev) the middleware is a no-op.

### `trackException`

For route handlers that don't have a `MonitoringService` instance to hand:

```typescript
import { trackException } from "@hmcts-cft/cloud-native-platform";

try {
  await doRiskyThing();
} catch (error) {
  trackException(error as Error, { userId, area: "checkout" });
  throw error;
}
```

Calls `appInsights.defaultClient.trackException` when AI is initialised; falls back to `console.error` otherwise. Safe to call before `monitoringMiddleware` has run (it just logs).

## Properties volume / Azure Key Vault secrets

`getPropertiesVolumeSecrets` loads secrets from:

- The CSI driver mount at `/mnt/secrets` (default) in deployed environments, or
- An Azure Key Vault directly when a Helm chart path is supplied locally (non-production only).

```typescript
import { getPropertiesVolumeSecrets } from "@hmcts-cft/cloud-native-platform";

await getPropertiesVolumeSecrets({
  chartPath: "./charts/my-service/values.yaml",  // optional: enables local Azure Vault loading
  injectEnvVars: true                            // default: also writes each secret to process.env
});
```

### Mount-point layout

Secrets mounted under `/mnt/secrets/<vault-name>/<secret-name>` are loaded as `<vault-name>.<secret-name>` keys, and (if `injectEnvVars`) injected to `process.env` under either `<secret-name>` or — if a Helm `alias` is set — the alias:

```yaml
# values.yaml
keyVaults:
  my-service:
    secrets:
      - name: redis-url          # → process.env["redis-url"]
      - name: app-key            # → process.env["APP_KEY"]
        alias: APP_KEY
```

### Local Azure Key Vault loading

When `chartPath` is set and `NODE_ENV !== "production"`, the chart's `keyVaults` block is read and secrets are fetched directly from Azure using `DefaultAzureCredential`. The default vault URI is `https://<vault-name>-aat.vault.azure.net/`; override with `vaultUriSuffix`:

```typescript
await getPropertiesVolumeSecrets({
  chartPath: "./charts/my-service/values.yaml",
  vaultUriSuffix: "stg"   // default "aat"
});
```

### Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `mountPoint` | `string` | `/mnt/secrets` | Filesystem path to look for CSI-mounted secrets. |
| `chartPath` | `string` | — | Helm values file. Enables local Azure Vault loading (non-prod) and alias mapping (prod). |
| `injectEnvVars` | `boolean` | `true` | Write each secret to `process.env` as well as returning it. |
| `omit` | `string[]` | `[]` | Secret keys to skip (matched by full key or last `.`-segment). |
| `failOnError` | `boolean` | `NODE_ENV==="production"` | Throw on missing mount / failed reads instead of logging a warning. |
| `vaultUriSuffix` | `string` | `"aat"` | Suffix for the Azure Key Vault URI when loading locally. |

### `addFromAzureVault`

Lower-level: populate a `config`-shaped object directly from a Helm chart's vault definitions. Used internally by `getPropertiesVolumeSecrets` but also exposed for callers that want to feed the `config` package:

```typescript
import config from "config";
import { addFromAzureVault } from "@hmcts-cft/cloud-native-platform";

await addFromAzureVault(config, {
  pathToHelmChart: "./charts/my-service/values.yaml",
  vaultUriSuffix: "stg"
});
```
