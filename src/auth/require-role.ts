/**
 * Area gates mounted after requireAuth and before routing. Judicial requires its explicit role;
 * Gazette requires ACCESS_GAZETTE. The API independently enforces both boundaries.
 * Refusals use the shared ForbiddenError mapping (403 with the 404 view).
 */
import { type Capability, can, DEEDPOLL_JUDICIAL, ForbiddenError, type Role } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { userFromRequest } from "./current-user.js";

export function requireRole(role: Role): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (userFromRequest(req).roles.includes(role)) {
      return next();
    }

    // The message is for the log, never for the user: `errors.ts` renders the shared "Page not found"
    // view, so a caseworker who guesses a judicial URL learns nothing about what is behind it.
    next(new ForbiddenError(`${req.originalUrl} requires the ${role} role`));
  };
}

export function requireJudicial(): RequestHandler {
  return requireRole(DEEDPOLL_JUDICIAL);
}

/** Gate an entire area before any page calls the API. */
export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    if (can(userFromRequest(req), capability)) return next();
    next(new ForbiddenError(`${req.path} requires ${capability}`));
  };
}
