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
