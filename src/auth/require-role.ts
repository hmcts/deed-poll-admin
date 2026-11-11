/**
 * Area gates mounted after requireAuth and before routing. All read api's stored `GET /me` answer, never a role:
 * Judicial requires `judicial`, the caseworker area requires `staff`, and each capability area its capability. The API
 * independently enforces every one of these boundaries.
 * Refusals use the shared ForbiddenError mapping (403 with the 404 view), which records them as `authz.denied`.
 */
import { type Capability, can, ForbiddenError, staffAccess } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { userFromRequest } from "./current-user.js";
import { isPublicPath } from "./require-auth.js";

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

/**
 * Every non-public page needs api to give the caller one area or the other (OWASP plan 01 Task 7). The IDAM callback
 * already refuses such a sign-in (Task 6), so this catches a session whose access was removed after it signed in: the
 * refresh re-reads `/me` within one token lifetime, and nothing else refuses on the new answer. Mounted for every path
 * after `refreshMiddleware` and **before the persona switcher**, so an identity with no area cannot switch into one
 * that has one (OWASP M1). Refused as `no-access`, which `src/errors.ts` renders as the login flow's no-access page:
 * the caller knows who they are, and signing in again cannot help.
 */
export function requireAnyAccess(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (isPublicPath(req.path)) return next();
    const access = staffAccess(userFromRequest(req));
    if (access.staff || access.judicial) return next();

    next(new ForbiddenError(`${req.method} ${req.baseUrl}${req.path} requires staff or judicial access`, { reason: "no-access" }));
  };
}

/** Gate an entire area before any page calls the API. */
export function requireCapability(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    if (can(userFromRequest(req), capability)) return next();
    next(new ForbiddenError(`${req.method} ${req.baseUrl}${req.path} requires ${capability}`, { reason: "role", requiredCapability: capability }));
  };
}
