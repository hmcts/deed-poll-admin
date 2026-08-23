/**
 * Resolves the caller from the request. Transport-specific by design — the domain's
 * `currentUser()` takes a resolved role list and knows nothing about how it was obtained,
 * so replacing this file is the whole of the work when IDAM arrives in Phase 5.
 *
 * **This is a stand-in, and an unsafe one.** Roles arrive in the `x-user-roles` header, so
 * anyone who can reach the service can send `x-user-roles: deedpoll-admin` and become an
 * admin. It is carried over from the prototype only so the ported handlers have something to
 * read; it is not an auth scheme.
 *
 * Because of that it is enabled only in the environments named below, and fails closed
 * everywhere else: the headers are ignored, every caller resolves to no roles, and a guarded
 * route returns 403 rather than silently granting admin to the internet.
 *
 * The allowlist is deliberately the opposite polarity to the rest of the codebase, which
 * asks `NODE_ENV === "production"` and treats everything else as development. That default-open
 * reading is fine for choosing a log level or a cache setting, and wrong for an authorisation
 * bypass: it would leave the bypass live for any value that merely is not the literal string
 * "production" — an unset variable, a Helm env override, `node dist/server.js` run outside the
 * image, or a deployed environment named something else. An allowlist requires the bypass to be
 * asked for.
 *
 * "test" is included because vitest sets NODE_ENV=test, so a test that does not care about auth
 * gets the working scheme rather than a puzzling 403.
 */
import { type CurrentUser, currentUser, type Role } from "@hmcts/deed-poll";
import type { Request } from "express";

const ROLES_HEADER = "x-user-roles";
const NAME_HEADER = "x-user-name";

/** The only environments in which the header scheme is honoured. */
const HEADER_AUTH_ENVIRONMENTS = new Set(["development", "test"]);

let hasWarned = false;

export function userFromRequest(req: Request): CurrentUser {
  if (!isHeaderAuthEnabled()) {
    warnOnce();
    return currentUser([]);
  }

  return currentUser(rolesFromHeader(req.header(ROLES_HEADER)), req.header(NAME_HEADER));
}

function isHeaderAuthEnabled(): boolean {
  return HEADER_AUTH_ENVIRONMENTS.has(process.env.NODE_ENV ?? "");
}

/**
 * A 403 with no explanation would be near-impossible to diagnose, so say why once — including
 * the value actually seen, since an unexpected or absent NODE_ENV is the likeliest cause. Once
 * rather than per request to keep a load test from filling the logs.
 */
function warnOnce(): void {
  if (hasWarned) {
    return;
  }
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
