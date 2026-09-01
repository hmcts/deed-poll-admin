/**
 * Request/response doubles for route tests.
 *
 * Shared rather than inlined per file — as the template's `routes/users` tests do — because
 * Phase 3 of the deed-poll migration ports 29 handlers, and 29 copies of the same
 * `mockReturnThis()` chain would be 29 places to fix when a handler starts using a response
 * method these do not stub.
 *
 * `header()` is modelled rather than a plain `headers` object because `userFromRequest` reads
 * the request through `req.header(name)`, which is case-insensitive — a test that set
 * `headers["X-User-Roles"]` against a naive double would pass while the real thing found
 * nothing.
 *
 * Excluded from the build in `tsconfig.json`: it imports `vitest`, so it must not reach `dist`.
 */

import type { Request, Response } from "express";
import { vi } from "vitest";

export function requestDouble({ body, params, query, roles, userName }: RequestOptions = {}): Request {
  const headers: Record<string, string | undefined> = {
    "x-user-roles": roles,
    "x-user-name": userName
  };

  return {
    body,
    params: params ?? {},
    query: query ?? {},
    header: (name: string) => headers[name.toLowerCase()]
  } as unknown as Request;
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
  /** Comma-separated, as the `x-user-roles` header carries them. */
  roles?: string;
  userName?: string;
}

/** The subset of Response the handlers touch, typed so assertions get the mock's methods. */
export type ResponseDouble = Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};
