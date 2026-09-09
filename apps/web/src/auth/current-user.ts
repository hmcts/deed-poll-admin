/**
 * The caller, for the SSR pages.
 *
 * **The header scheme is gone from this app.** It read `x-user-roles`, so anyone who could reach the
 * service could assert `deedpoll-admin`. Phase 5 replaces it with a real IDAM session, and this file
 * is the whole of the replacement — the pages call it exactly as before, so nothing downstream
 * changed. The deleted `apps/api` had the same header scheme and moved to a bearer token; the shared
 * `header-user.ts` went with it, so the bypass no longer exists anywhere.
 *
 * `requireAuth` runs before every non-public page, so a page reaching this always has a user. The
 * fallback is not a "logged out" state: it is `currentUser([])`, which holds no roles and is
 * attributed to the service account — so a bug that let an unauthenticated request through would fail
 * closed rather than silently acting as an admin.
 */
import { type Caller, type CurrentUser, currentUser } from "@hmcts/deed-poll";
import type { Request } from "express";
import { sessionAccessToken, sessionUser } from "./session.js";

export function userFromRequest(req: Request): CurrentUser {
  return sessionUser(req) ?? currentUser([]);
}

/**
 * The caller as `deed-poll-api` needs them: the session's IDAM access token, and nothing else.
 *
 * Separate from `userFromRequest` because the two answer different questions. `CurrentUser` is what
 * this app's own pages decide with — which control to disable, which tag to show. The token is what api
 * authenticates and audits by, and api derives its own view of the caller from it rather than being
 * told. Sending both would let this app assert an identity api did not verify.
 *
 * Undefined when there is no session, which api answers with a 401. That is the right failure: a page
 * reaching here unauthenticated is a bug in `requireAuth`, and a call that quietly succeeded
 * unattributed would hide it.
 */
export function callerFromRequest(req: Request): Caller {
  return { accessToken: sessionAccessToken(req) };
}
