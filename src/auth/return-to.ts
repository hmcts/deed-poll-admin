/**
 * Where to go after signing in, restricted to a path on this site.
 *
 * `returnTo` arrives in a query string, so it is attacker-controlled. Redirecting to it unchecked
 * makes `/login?returnTo=https://evil.example` an open redirect that borrows this service's domain to
 * launder a phishing link. Only a rooted path is accepted, and `//host` is rejected too because
 * browsers read a protocol-relative URL as absolute.
 *
 * **`/\host` has to be rejected for the same reason, and a leading `/` does not exclude it.** The WHATWG URL
 * parser treats `\` as `/` in a special scheme, so a browser resolves `/\evil.example` against this origin as
 * `https://evil.example` — and nothing downstream closes the hole: `res.redirect` puts the value through
 * `encodeurl`, which leaves `\` alone (0x5C sits inside its allowed `\x3F-\x5F` range). Checking only the second
 * character is enough, because that is the only position the parser reads as the start of an authority; a tab or
 * newline smuggled in to reach it is percent-encoded by `encodeurl` and so never reaches the parser as one.
 *
 * Every caller is a sink, and the callback is the worst: `login.ts` redirects an already-signed-in user
 * immediately, and `oauth2/callback.ts` sends them to `flow.returnTo` **after** a genuine IDAM sign-in, which is
 * the moment a user is most likely to trust the page they land on. `session-lifetime.ts` also stores a timed-out
 * request's path through it.
 *
 * **The fallback is `/` and not the case list** (`referrals-admin-3` decision 2). Which home is right depends on
 * the roles in the token, which do not exist yet at the point this is read — so the fallback is the one path that
 * decides that question after sign-in (`src/pages/index.ts`). Naming `/deed-polls` here, as this did, landed a judge on
 * the caseworker's list whenever they reached `/login` without a `returnTo`.
 */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  return raw;
}
