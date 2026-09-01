/**
 * Request/response doubles for page tests.
 *
 * Shared rather than inlined per file, for the reason `apps/api/src/express-doubles.ts` gives — and
 * this app has a sharper version of it. Phase 5 moved identity from a request header to a session, and
 * every page test that had built its own double with a `header()` function broke at once, because the
 * doubles had no `session` for the namespace helper to write to. One place to change would have been
 * one edit.
 *
 * `pageRequest({ admin: true })` is the signed-in-as-an-admin case, which is what most tests actually
 * want to express; the session shape is an implementation detail they should not have to know.
 *
 * Excluded from the build in `tsconfig.json`: it imports `vitest`, so it must not reach `dist`.
 */
import { currentUser, DEEDPOLL_ADMIN } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { vi } from "vitest";

export interface PageRequestOptions {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Signed in at all. Defaults to true, since `requireAuth` means a page only runs when someone is. */
  signedIn?: boolean;
  /** Signed in holding the privileged role. */
  admin?: boolean;
  /** Display name recorded in the audit columns. */
  name?: string;
}

export function pageRequest({ params, query, body, signedIn = true, admin = false, name }: PageRequestOptions = {}): Request {
  const user = signedIn ? currentUser(admin ? [DEEDPOLL_ADMIN] : [], name) : undefined;

  return {
    params: params ?? {},
    query: query ?? {},
    body,
    session: { deedPoll: user ? { user } : {} }
  } as unknown as Request;
}

export type ResponseDouble = Response & {
  render: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
};

export function pageResponse(): ResponseDouble {
  const res = { render: vi.fn(), redirect: vi.fn(), status: vi.fn(), locals: {} } as unknown as ResponseDouble;
  res.status.mockReturnValue(res);
  return res;
}
