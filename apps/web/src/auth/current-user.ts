/**
 * Resolves the caller from an Express request, for the SSR pages.
 *
 * Deliberately identical to `apps/api/src/auth/current-user.ts`: both are one-line adapters over
 * `userFromHeaders`, which holds the scheme and the fail-closed `NODE_ENV` allowlist. The
 * duplication is the adapter only, not the decision — see that function for why it lives in the
 * domain rather than being copied per app.
 *
 * The pages need this because privacy editability and the privacy banner depend on `isAdmin`.
 * Replacing this file and its twin is the whole of the work when IDAM arrives in Phase 5.
 */
import { type CurrentUser, userFromHeaders } from "@hmcts/deed-poll";
import type { Request } from "express";

export function userFromRequest(req: Request): CurrentUser {
  // `req.header` is case-insensitive, which is why it is passed rather than `req.headers`.
  return userFromHeaders((name) => req.header(name));
}
