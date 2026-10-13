export const REDACTED = "REDACTED";

/**
 * A URL with its query replaced by a marker, for telemetry.
 *
 * Case search runs over GET, so a query string carries applicants' names and dates of birth; the OAuth callback's
 * carries the authorisation code. Neither may persist in App Insights, outside the api's access and retention
 * controls (OWASP assessment M4). The marker tells on-call that a query existed without saying what it was.
 *
 * Not an allowlist of "safe" parameters: `page` and `sort` are not worth a parser that could keep the wrong one.
 */
export function redactUrl(url: string): string {
  const cut = url.search(/[?#]/);
  if (cut === -1) {
    return url;
  }

  const base = url.slice(0, cut);
  const hasQuery = url[cut] === "?" && url.slice(cut + 1).split("#")[0] !== "";
  return hasQuery ? `${base}?${REDACTED}` : base;
}
