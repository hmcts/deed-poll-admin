/**
 * Request/response doubles for route tests.
 *
 * Shared rather than inlined per file — as the template's `routes/users` tests do — because
 * Phase 3 of the deed-poll migration ports 29 handlers, and 29 copies of the same
 * `mockReturnThis()` chain would be 29 places to fix when a handler starts using a response
 * method these do not stub.
 *
 * `header()` is modelled rather than a plain `headers` object because middleware reads the request
 * through `req.header(name)`, which is case-insensitive — a test that set
 * `headers["Authorization"]` against a naive double would pass while the real thing found nothing.
 *
 * The caller is attached the way `authenticate()` attaches it, not as headers. Roles used to arrive in
 * `x-user-roles`, so a double could just set that; a real bearer token cannot be minted here, and
 * pretending otherwise would test the handlers against an identity mechanism they no longer use.
 * `roles` stays a comma-separated string only because 13 test files already say
 * `roles: "deedpoll-admin"`.
 *
 * Excluded from the build in `tsconfig.json`: it imports `vitest`, so it must not reach `dist`.
 */

import { currentUser, type Role } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { vi } from "vitest";
import { setCurrentUser } from "./auth/current-user.js";

export function requestDouble({ body, params, query, roles, userName, headers }: RequestOptions = {}): Request {
  const all: Record<string, string | undefined> = { ...headers };

  const req = {
    body,
    params: params ?? {},
    query: query ?? {},
    header: (name: string) => all[name.toLowerCase()]
  } as unknown as Request;

  setCurrentUser(req, userDouble(roles, userName));

  return req;
}

/**
 * Stands in for `authenticate()` in the wiring tests, which build a real Express app over the real
 * route files to check routing rather than authentication.
 *
 * Their apps deliberately do not mount `authenticate()` — it would need a live issuer — so without this
 * every handler that reads the caller would throw. Attaching a fixed one keeps those tests about what
 * they are about. What the real middleware does is `authenticate.test.ts`'s job.
 */
export function attachUserDouble(roles?: string, userName?: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    setCurrentUser(req, userDouble(roles, userName));
    next();
  };
}

function userDouble(roles: string | undefined, userName: string | undefined) {
  const parsed = (roles ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is Role => role.length > 0);

  return currentUser(parsed, userName);
}

export function responseDouble(): ResponseDouble {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis()
  } as unknown as ResponseDouble;
}

interface RequestOptions {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  /** Comma-separated, as IDAM's `roles` claim may be. */
  roles?: string;
  userName?: string;
  /** Lowercase keys, since `header()` lowercases before looking up. */
  headers?: Record<string, string | undefined>;
}

/** The subset of Response the handlers touch, typed so assertions get the mock's methods. */
export type ResponseDouble = Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};
