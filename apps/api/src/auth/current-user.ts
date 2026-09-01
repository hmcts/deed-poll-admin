/**
 * Resolves the caller from an Express request.
 *
 * A one-line adapter over `userFromHeaders`, which holds the actual scheme and, importantly, the
 * fail-closed `NODE_ENV` allowlist. That moved into `@hmcts/deed-poll` when `apps/web` came to need
 * the same thing in Phase 4: two copies of an authorisation bypass, each free to drift, is a worse
 * problem than a transport concern sitting in a framework-free library that takes a header-getter.
 *
 * Replacing this file, and its twin in `apps/web`, is still the whole of the work when IDAM arrives
 * in Phase 5 — the domain's `currentUser()` takes a resolved role list and knows nothing about how
 * it was obtained.
 */
import { type CurrentUser, userFromHeaders } from "@hmcts/deed-poll";
import type { Request } from "express";

export function userFromRequest(req: Request): CurrentUser {
  // `req.header` is case-insensitive, which is why it is passed rather than `req.headers`.
  return userFromHeaders((name) => req.header(name));
}
