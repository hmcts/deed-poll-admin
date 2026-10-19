/** Validate configuration without putting the URL (which may contain secrets) in an error. */
export function assertApiBaseUrl(address: string): void {
  const message = "API base URL must be an absolute HTTP(S) URL without credentials, query or fragment";
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error(message);
  }

  if (!/^https?:\/\//i.test(address) || address !== address.trim() || /[\\?#]/.test(address) || url.username || url.password) {
    throw new Error(message);
  }
  // HTTP remains supported for the existing private API route. This validates URL structure, not
  // transport encryption; HTTPS enforcement awaits a verified platform route and matching certificate.
}
