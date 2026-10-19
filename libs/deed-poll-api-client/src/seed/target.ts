import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The repository's gitignored `data/`, fixed from this file rather than the working directory: Yarn runs the
// script from the workspace, so a relative default used to land in `libs/deed-poll-api-client/data/` instead.
const DATA_DIRECTORY = fileURLToPath(new URL("../../../../data/", import.meta.url));
const BATCH = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Where a batch's journal lives. Confined to `data/` because the journal is written, locked and sat beside a
 * credentials file, and both arguments arrive from a command line that an agent may be composing: `--batch
 * ../../x` used to write outside it.
 */
export function seedJournalPath(environment: string, batch: string, journal?: string): string {
  if (!BATCH.test(batch)) throw new Error("--batch must be lowercase letters, digits and hyphens.");
  const filename = resolve(DATA_DIRECTORY, journal ?? `seed-${environment}-${batch}.json`);
  if (!filename.startsWith(DATA_DIRECTORY) || !filename.endsWith(".json")) {
    throw new Error(`--journal must be a .json file inside ${DATA_DIRECTORY}`);
  }
  return filename;
}

/** Explicit target selection; never inherit the app's URL or NODE_ENV. */
export function seedTarget(environment: string, address: string): { environment: string; baseUrl: string } {
  const name = environment.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name) || /(^|-)(prod|production|live)(-|$)/.test(name)) {
    throw new Error("An explicit non-production environment is required; production seeding is forbidden.");
  }
  const url = new URL(address);
  const host = url.hostname.toLowerCase();
  if (/(^|[.-])(prod|production|live)([.-]|$)/.test(host) || host.endsWith(".service.gov.uk")) {
    throw new Error("Production API hosts cannot be seeded.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const environmentInHost = host.split(/[.-]/).includes(name) || host.includes(`.${name}.`) || host.includes(`-${name}.`);
  if (!loopback && !environmentInHost) throw new Error("API hostname must identify the selected non-production environment.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (loopback || host.endsWith(".internal")))) {
    throw new Error("Use HTTPS, or HTTP only for loopback and internal service hosts.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("API URL must be an origin without credentials, path or query.");
  return { environment: name, baseUrl: url.origin };
}
