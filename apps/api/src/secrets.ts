import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPropertiesVolumeSecrets, type Secrets } from "@hmcts-cft/cloud-native-platform";

const chartPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../helm/values.yaml");

/**
 * Put the key vault secrets in `process.env`, from the entrypoint and **before** the application graph
 * is imported.
 *
 * This was the first line of `createApp`, which does not work and fails silently. `config` resolves
 * `custom-environment-variables.json` once, when it is first loaded, and caches the result — it is not a
 * lazy read on `.get()`. ESM evaluates everything `app.ts` statically imports before `server.ts` runs a
 * single line, so a secret loaded during app creation arrived after the values had already been resolved
 * from the placeholders in `config/default.json`. `@hmcts/postgres-prisma` is the same shape one layer
 * down: it builds its pool from `DATABASE_URL` at module scope, so a deployed pod pointed at loopback and
 * failed readiness for as long as it ran.
 *
 * So the ordering *is* the mechanism: `server.ts` awaits this and only then imports `./app.js`,
 * dynamically. `apps/web/src/secrets.ts` is the same, and `apps/crons/src/index.ts` has always done it
 * this way round.
 *
 * `omit` applies only on the non-production Azure-vault path — see `properties.ts`, which returns from it
 * early when `NODE_ENV` is production. It exists so a developer running against a real vault does not have
 * the deployed database quietly replace their local one.
 */
export function loadSecrets(): Promise<Secrets> {
  return getPropertiesVolumeSecrets({ chartPath, omit: ["DATABASE_URL"] });
}
