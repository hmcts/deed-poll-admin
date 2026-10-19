/** HTTP is only for a local mock or API during development/tests. All deployments require TLS. */
export function apiTransportPermitted(address: string, environment: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }

  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (environment === "development" || environment === "test") && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
