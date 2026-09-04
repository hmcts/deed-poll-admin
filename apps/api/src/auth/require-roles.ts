/**
 * Express replacement for the prototype's `RolesGuard`.
 *
 * The role model is unchanged — `Role` / `DEEDPOLL_ADMIN` still come from the domain, and a
 * caller still needs at least one of the listed roles. Only the mechanism changes: Nest read
 * `@Roles(...)` metadata off the handler via a `Reflector`, whereas here the requirement is
 * expressed by mounting this middleware in front of the handler. `simple-router` calls
 * `normalizeHandlers` on each method export, so a route restricts itself by exporting an
 * array:
 *
 *     export const DELETE = [requireRoles(DEEDPOLL_ADMIN), handler];
 *
 * The guard's "a route with no @Roles metadata is open" case has no equivalent to enforce:
 * an unguarded route is simply one that does not mount this. `requireRoles()` with no roles
 * is still accepted and open, so a caller building the list dynamically cannot accidentally
 * fail closed on an empty array.
 */
import { ForbiddenError, type Role } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { userFromRequest } from "./current-user.js";

export function requireRoles(...required: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (required.length === 0) {
      return next();
    }

    const { roles } = userFromRequest(req);

    if (required.some((role) => roles.includes(role))) {
      return next();
    }

    next(new ForbiddenError(`Requires one of the following roles: ${required.join(", ")}`));
  };
}
