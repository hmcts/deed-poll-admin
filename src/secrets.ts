import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPropertiesVolumeSecrets, type Secrets } from "@hmcts-cft/cloud-native-platform";

const chartPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../charts/deed-poll-admin/values.yaml");

/**
 * Put the key vault secrets in `process.env`, from the entrypoint and **before** the application graph
 * is imported.
 *
 * This was the first line of `createApp`, which does not work and fails silently. `config` resolves
 * `custom-environment-variables.json` **once, when it is first loaded**, and caches the result — it is
 * not a lazy read on `.get()`. `app.ts` reaches `config` through its own static imports
 * (`./auth/settings.js`), and ESM evaluates that whole graph before `server.ts` runs a single line, so
 * every secret arrived after the values had already been resolved from the placeholders in
 * `config/default.json`. A deployed pod therefore saw `redis.url` as `redis://localhost:6379` and
 * `session.secret` as the checked-in placeholder however correct its vault was, and `assertRedisUrl`
 * crashlooped it with an error blaming a `redis-url` entry that was there all along.
 *
 * So the ordering *is* the mechanism, and it has to live in the entrypoint rather than in `createApp`:
 * `server.ts` awaits this and only then imports `./app.js`, dynamically.
 *
 * `omit` applies only on the non-production Azure-vault path — see `properties.ts`, which returns from it
 * early when `NODE_ENV` is production. It exists so a developer running against a real vault does not
 * have the deployed session store quietly replace their local one. `DATABASE_URL` was the other entry
 * and is gone with the data access layer: this app has no database.
 */
export function loadSecrets(): Promise<Secrets> {
  return getPropertiesVolumeSecrets({ chartPath, omit: ["REDIS_URL"] });
}
