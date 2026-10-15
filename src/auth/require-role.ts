/**
 * Area gates mounted after requireAuth and before routing. Both read api's stored `GET /me` answer, never a role:
 * Judicial requires `judicial`, Gazette requires ACCESS_GAZETTE. The API independently enforces both boundaries.
 * Refusals use the shared ForbiddenError mapping (403 with the 404 view).
 */
import { type Capability, can, ForbiddenError, staffAccess } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { userFromRequest } from "./current-user.js";

export function requireJudicial(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (staffAccess(userFromRequest(req)).judicial) {
      return next();
    }

    // The message is for the log, never for the user: `errors.ts` renders the shared "Page not found"
    // view, so a caseworker who guesses a judicial URL learns nothing about what is behind it.
    next(new ForbiddenError(`${req.originalUrl} requires judicial access`));
  };
}

/** Gate an entire area before any page calls the API. */
export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    if (can(userFromRequest(req), capability)) return next();
    next(new ForbiddenError(`${req.path} requires ${capability}`));
  };
}
