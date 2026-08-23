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
 * Because of that it refuses to operate in production: with NODE_ENV=production the headers
 * are ignored and every caller resolves to no roles, so a guarded route returns 403 rather
 * than silently granting admin to the internet. An accidental deploy ahead of Phase 5 then
 * fails closed and loudly, instead of appearing to work.
 */
import { type CurrentUser, currentUser, type Role } from "@hmcts/deed-poll";
import type { Request } from "express";

const ROLES_HEADER = "x-user-roles";
const NAME_HEADER = "x-user-name";

let hasWarned = false;

export function userFromRequest(req: Request): CurrentUser {
  if (isHeaderAuthDisabled()) {
    warnOnce();
    return currentUser([]);
  }

  return currentUser(rolesFromHeader(req.header(ROLES_HEADER)), req.header(NAME_HEADER));
}

function isHeaderAuthDisabled(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * A 403 with no explanation would be near-impossible to diagnose, so say why once. Once
 * rather than per request to keep a load test from filling the logs.
 */
function warnOnce(): void {
  if (hasWarned) {
    return;
  }
  hasWarned = true;
  console.error(
    `Header-based auth (${ROLES_HEADER}) is disabled outside development, so every caller has no roles and guarded routes will return 403. Real authentication is Phase 5 of the deed-poll migration.`
  );
}

/** Roles arrive as a comma-separated list, e.g. `x-user-roles: deedpoll-admin,other`. */
function rolesFromHeader(header: string | undefined): Role[] {
  return (header ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is Role => role.length > 0);
}
