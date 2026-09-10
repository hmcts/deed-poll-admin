/**
 * Middleware to check token expiry and refresh tokens before they expire.
 *
 * Runs on every request after `requireAuth`, so it only fires for authenticated users. If the access
 * token is close to expiry and a refresh token exists, attempts to refresh silently. If the refresh
 * fails (token revoked, expired, or IDAM refuses), clears the session and redirects to login.
 *
 * **Why 5 minutes before expiry?** Refreshing at the exact moment of expiry races with requests that
 * need a valid token — the API might receive an expired token while the refresh is in flight. Refreshing
 * early ensures the token is always valid when sent. The window is a trade-off: too early wastes
 * refreshes, too late causes failures.
 */
import type { NextFunction, Request, Response } from "express";
import { refreshTokens } from "./idam.js";
import { sessionRefreshToken, sessionSubject, sessionTokenExpiry, sessionUser, signOut, updateTokens } from "./session.js";
import { idamSettings } from "./settings.js";

const REFRESH_WINDOW_SECONDS = 5 * 60; // Refresh 5 minutes before expiry

export async function refreshMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = sessionUser(req);
  if (!user) {
    // Not signed in — nothing to refresh. `requireAuth` would have already redirected.
    return next();
  }

  const expiresAt = sessionTokenExpiry(req);
  const refreshToken = sessionRefreshToken(req);
  const now = Math.floor(Date.now() / 1000);

  // **An already-expired access token with nothing to refresh it is not a session that expires
  // naturally.** `refreshToken` is optional — IDAM only issues one for `offline_access` — and after the
  // cutover every case page presents the access token to `deed-poll-api`, which answers 401, which
  // `errors.ts` deliberately renders as a 500 with no route back to `/login`. So the session would keep
  // its cookie's full `maxAge` while every page faulted. Ending it here hands the next request to
  // `requireAuth`, which cannot loop because the session is destroyed first. Same decision as the
  // expired-token branch in the refresh failure below.
  if (expiresAt && expiresAt - now <= 0 && !refreshToken) {
    console.warn("Access token has expired and the session holds no refresh token — signing out");
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // No expiry time or no refresh token — can't refresh. Session will expire naturally.
  if (!expiresAt || !refreshToken) {
    return next();
  }

  const timeUntilExpiry = expiresAt - now;

  // Token still has time — no refresh needed yet.
  if (timeUntilExpiry > REFRESH_WINDOW_SECONDS) {
    return next();
  }

  // A signed-in session with no recorded subject cannot have its refresh checked against anything, so
  // it is ended rather than refreshed. This is only reachable for a session established before the
  // subject was stored, which makes signing out the cheap and self-limiting answer — and the polarity
  // matches the rest of this app's auth decisions: what cannot be verified is refused.
  const subject = sessionSubject(req);
  if (!subject) {
    console.warn("Session has no recorded IDAM subject, so its refresh cannot be verified — signing out");
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // Token is close to expiry or already expired — attempt refresh.
  const settings = idamSettings();
  let refreshed: Awaited<ReturnType<typeof refreshTokens>>;

  try {
    refreshed = await refreshTokens(settings, refreshToken, subject);
  } catch (error) {
    // Network error, IDAM down, or unexpected response. Log it but don't force logout — the token
    // might still be valid, and a transient error shouldn't boot everyone. The next request will
    // try again if we're still in the refresh window.
    //
    // **A permanently broken refresh lands here and is indistinguishable from a blip**, which is how
    // the missing-`id_token` defect stayed hidden: every refresh threw, this logged, and the session
    // expired as though refresh were never implemented. If sessions are expiring on schedule in a
    // deployed environment, read this log line before assuming the window is wrong.
    console.error("Token refresh failed with error:", error);

    // **An access token that has already expired is a different case, and the cutover is what made it
    // one.** Every case page now presents this token to `deed-poll-api`, which answers 401, which
    // `callApi` turns into `UnauthorizedError` — and `errors.ts` deliberately does not render that, so
    // the caseworker gets a 500 on every page with no route back to `/login`. Continuing is only
    // defensible while the token still works; once it does not, there is nothing left to continue with.
    // Signing out here cannot loop the way a redirect from the error handler would, because the session
    // is destroyed first: the next request has no user and `requireAuth` owns it.
    if (timeUntilExpiry > 0) return next();

    console.warn("Token refresh failed and the access token has expired — signing out");
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // Revoked, expired, refused — or a response describing a different subject. All mean this session is
  // over rather than retryable.
  if (!refreshed) {
    console.log("Token refresh was refused — signing out");
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // Refresh succeeded — update session with new tokens and continue.
  await updateTokens(req, refreshed);
  next();
}
