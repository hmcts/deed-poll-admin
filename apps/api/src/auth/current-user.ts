/**
 * The caller, resolved once per request and read from wherever a handler needs it.
 *
 * This used to be a one-line adapter over `userFromHeaders`, which read `x-user-roles` off the request
 * — so `userFromRequest` could be synchronous and every handler could just call it. Validating a real
 * bearer token cannot be: it means a signature check against a fetched JWKS and a userinfo lookup.
 *
 * Rather than make all six call sites async, `authenticate()` resolves the caller once and stashes them
 * here, and `userFromRequest` stays the synchronous read it was. That keeps the resolution in one
 * place, which matters more for authentication than the indirection costs: identity is decided before
 * routing, not per handler, so a handler cannot accidentally do it differently or skip it.
 *
 * **Reading before `authenticate()` has run throws.** The alternative — returning a caller with no
 * roles — is also fail-closed, but it fails as a 403 on a route that should have worked, which reads
 * like a permissions bug and sends whoever debugs it to IDAM's role assignments. A thrown error names
 * the actual mistake.
 *
 * A symbol rather than `req.user`, because `req.user` is a de-facto convention several Express
 * middlewares write to (Passport among them) and a silent overwrite of the authenticated caller is
 * exactly the collision worth not having.
 */
import type { Caller, CurrentUser } from "@hmcts/deed-poll";
import type { Request } from "express";
import { bearerToken } from "./idam.js";

const RESOLVED_USER = Symbol("deedPollCurrentUser");

/** Record the authenticated caller on the request. Called by `authenticate()`, and by test doubles. */
export function setCurrentUser(req: Request, user: CurrentUser): void {
  (req as RequestWithUser)[RESOLVED_USER] = user;
}

export function userFromRequest(req: Request): CurrentUser {
  const user = (req as RequestWithUser)[RESOLVED_USER];

  if (!user) {
    throw new Error("No authenticated caller on the request. `authenticate()` must be mounted before any route that reads one.");
  }

  return user;
}

/**
 * The caller as `deed-poll-api` needs them: the bearer token this request arrived with, forwarded.
 *
 * Taken off the header rather than reconstructed, because it is the caller's own credential and api
 * derives its own view of them from it. Forwarding is only defensible because both services trust the
 * same IDAM issuer, and it is what keeps a case attributed to the caseworker who asked for it rather
 * than to this app.
 */
export function callerFromRequest(req: Request): Caller {
  return { accessToken: bearerToken(req.header("authorization")) };
}

type RequestWithUser = Request & { [RESOLVED_USER]?: CurrentUser };
