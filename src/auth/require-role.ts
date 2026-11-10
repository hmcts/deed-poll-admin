/**
 * Area gates mounted after requireAuth and before routing. All read api's stored `GET /me` answer, never a role:
 * Judicial requires `judicial`, the caseworker area requires `staff`, and each capability area its capability. The API
 * independently enforces every one of these boundaries.
 * Refusals use the shared ForbiddenError mapping (403 with the 404 view), which records them as `authz.denied`.
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
    // view, so a caseworker who guesses a judicial URL learns nothing about what is behind it — only, from the 403
    // status, that the area exists and is closed to them (R14). The route and not `originalUrl`, whose query
    // string can carry a search.
    next(new ForbiddenError(`${req.method} ${req.baseUrl}${req.path} requires judicial access`, { reason: "role" }));
  };
}

/**
 * The caseworker area, `/deed-polls/**` (OWASP plan 01 Task 8). It needs `staff` in api's answer, so a judge who holds
 * only the judicial role is refused every case page here rather than by a stream of api 403s. api's `/caseworker/**`
 * staff gate enforces the same boundary; this is the UI half. Refused the same way as `requireJudicial`.
 */
export function requireStaff(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (staffAccess(userFromRequest(req)).staff) {
      return next();
    }

    next(new ForbiddenError(`${req.method} ${req.baseUrl}${req.path} requires staff access`, { reason: "role" }));
  };
}

/** Gate an entire area before any page calls the API. */
export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    if (can(userFromRequest(req), capability)) return next();
    next(new ForbiddenError(`${req.method} ${req.baseUrl}${req.path} requires ${capability}`, { reason: "role", requiredCapability: capability }));
  };
}
