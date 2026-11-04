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
 * character is enough, because that is the only position the parser reads as the start of an authority.
 *
 * **A control character or a space is refused anywhere in the value**, because a browser strips tab, CR and LF
 * from a URL before parsing it, so `/<tab>/evil.example` would reach the parser as `//evil.example`. Today
 * `encodeurl` percent-encodes them first, but that is a property of one redirect implementation, and the check
 * should not depend on every sink keeping it. No genuine path is refused: a request target cannot carry a raw
 * space or control character (clients percent-encode them and Node answers 400), and every caller's value is a
 * request target or was built from one.
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
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || hasControlOrSpace(raw)) {
    return "/";
  }
  return raw;
}

/** C0 controls, space and DEL: what a browser strips from a URL, or a URL cannot carry raw. */
function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}
