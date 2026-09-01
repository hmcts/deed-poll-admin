/**
 * The header-based stand-in for authentication, shared by both apps.
 *
 * **This is a stand-in, and an unsafe one.** Roles arrive in the `x-user-roles` header, so anyone
 * who can reach the service can send `x-user-roles: deedpoll-admin` and become an admin. It exists
 * only so the ported handlers and pages have something to read; it is not an auth scheme, and
 * Phase 5 replaces it with IDAM.
 *
 * Because of that it is enabled only in the environments named below, and fails closed everywhere
 * else: the headers are ignored, every caller resolves to no roles, and a guarded route returns 403
 * rather than silently granting admin to the internet.
 *
 * **The allowlist is deliberately the opposite polarity to the rest of the codebase**, which asks
 * `NODE_ENV === "production"` and treats everything else as development. That default-open reading
 * is fine for choosing a log level and wrong for an authorisation bypass: it would leave the bypass
 * live for any value that merely is not the literal string "production" — an unset variable, a Helm
 * env override, `node dist/server.js` run outside the image, or a deployed environment named `aat`.
 * An allowlist requires the bypass to be asked for. Do not "correct" this to match the codebase.
 *
 * "test" is included because vitest sets NODE_ENV=test, so a test that does not care about auth gets
 * the working scheme rather than a puzzling 403.
 *
 * **Why this lives in the domain rather than in each app.** It reads request headers, which is a
 * transport concern, and the first version of it was app-local in `apps/api` for exactly that
 * reason. Phase 4 made `apps/web` need the same thing, and duplicating it would have meant two
 * copies of the fail-closed decision above, free to drift apart — precisely what the warning not to
 * "correct" the polarity is guarding against. Taking a header-getter rather than a `Request` keeps
 * this file framework-free, so the domain still has no Express dependency and each app supplies a
 * one-line adapter.
 */
import { type CurrentUser, currentUser } from "./current-user.js";
import type { Role } from "./roles.js";

const ROLES_HEADER = "x-user-roles";
const NAME_HEADER = "x-user-name";

/** The only environments in which the header scheme is honoured. */
export const HEADER_AUTH_ENVIRONMENTS = new Set(["development", "test"]);

/** Reads one request header by name, case-insensitively. Express's `req.header` satisfies this. */
export type HeaderReader = (name: string) => string | undefined;

let hasWarned = false;

/** Resolve the caller from request headers, or to no roles at all outside the allowed environments. */
export function userFromHeaders(getHeader: HeaderReader): CurrentUser {
  if (!isHeaderAuthEnabled()) {
    warnOnce();
    return currentUser([]);
  }

  return currentUser(rolesFromHeader(getHeader(ROLES_HEADER)), getHeader(NAME_HEADER));
}

/** Test seam: the warning is emitted once per process, which would otherwise leak between tests. */
export function resetHeaderAuthWarning(): void {
  hasWarned = false;
}

function isHeaderAuthEnabled(): boolean {
  return HEADER_AUTH_ENVIRONMENTS.has(process.env.NODE_ENV ?? "");
}

/**
 * A 403 with no explanation would be near-impossible to diagnose, so say why once — including the
 * value actually seen, since an unexpected or absent NODE_ENV is the likeliest cause. Once rather
 * than per request, to keep a load test from filling the logs.
 */
function warnOnce(): void {
  if (hasWarned) return;
  hasWarned = true;
  console.error(
    `Header-based auth (${ROLES_HEADER}) is enabled only when NODE_ENV is one of ${[...HEADER_AUTH_ENVIRONMENTS].join(", ")}, but it is ${JSON.stringify(process.env.NODE_ENV)}. Every caller therefore has no roles and guarded routes will return 403. Real authentication is Phase 5 of the deed-poll migration.`
  );
}

/** Roles arrive as a comma-separated list, e.g. `x-user-roles: deedpoll-admin,other`. */
function rolesFromHeader(header: string | undefined): Role[] {
  return (header ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is Role => role.length > 0);
}
