/**
 * The caller, for the SSR pages.
 *
 * **The header scheme is gone from this app.** It read `x-user-roles`, so anyone who could reach the
 * service could assert `deedpoll-admin`. Phase 5 replaces it with a real IDAM session, and this file
 * is the whole of the replacement — the pages call it exactly as before, so nothing downstream
 * changed. `apps/api` had the same header scheme, and now takes a bearer token instead — the shared
 * `header-user.ts` is deleted, so the bypass no longer exists anywhere.
 *
 * `requireAuth` runs before every non-public page, so a page reaching this always has a user. The
 * fallback is not a "logged out" state: it is `currentUser([])`, which holds no roles and is
 * attributed to the service account — so a bug that let an unauthenticated request through would fail
 * closed rather than silently acting as an admin.
 */
import { type CurrentUser, currentUser } from "@hmcts/deed-poll";
import type { Request } from "express";
import { sessionUser } from "./session.js";

export function userFromRequest(req: Request): CurrentUser {
  return sessionUser(req) ?? currentUser([]);
}
