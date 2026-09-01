/**
 * Requires a valid IDAM access token on every request, and resolves the caller from it.
 *
 * **Mounted globally rather than per route**, which is the same decision `apps/web`'s `requireAuth`
 * makes and for the same reason: a route added tomorrow is then authenticated by default rather than
 * authenticated when someone remembers, and the failure mode of forgetting is silent. There is no
 * public-path allowlist to go with it because there are no public API routes — the healthcheck is
 * mounted ahead of this in `app.ts` and never reaches it.
 *
 * This replaces the `x-user-roles` header stand-in, which is now gone from the codebase entirely. That
 * header was an authorisation bypass in the literal sense: anyone who could reach the service could
 * send `x-user-roles: deedpoll-admin` and hard-delete any case with its children. It was restricted to
 * `NODE_ENV` development and test, so the exposure was never as bad as it sounds, but the API was
 * unusable anywhere else as a result — every caller resolved to no roles.
 *
 * An unknown path now answers 401 rather than 404, because this runs before routing. That is the right
 * way round: which paths exist is not something an unauthenticated caller needs to learn.
 */
import { type CurrentUser, UnauthorizedError } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { setCurrentUser } from "./current-user.js";
import { bearerToken, type IdamApiConfig, userFromBearerToken } from "./idam.js";

/**
 * Takes a resolver rather than calling `userFromBearerToken` directly so tests can drive the middleware
 * without an issuer, and so `idam.ts` stays testable on its own. Defaults to the real one, so wiring it
 * up cannot be forgotten at the call site.
 */
export function authenticate(config: IdamApiConfig, resolve: TokenResolver = userFromBearerToken): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req.header("authorization"));

    if (!token) {
      return next(new UnauthorizedError("An IDAM access token is required"));
    }

    try {
      setCurrentUser(req, await resolve(config, token));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export type TokenResolver = (config: IdamApiConfig, token: string) => Promise<CurrentUser>;
