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
import { sessionRefreshToken, sessionTokenExpiry, sessionUser, signOut, updateTokens } from "./session.js";
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

  // No expiry time or no refresh token — can't refresh. Session will expire naturally.
  if (!expiresAt || !refreshToken) {
    return next();
  }

  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = expiresAt - now;

  // Token still has time — no refresh needed yet.
  if (timeUntilExpiry > REFRESH_WINDOW_SECONDS) {
    return next();
  }

  // Token is close to expiry or already expired — attempt refresh.
  const settings = idamSettings();
  let refreshed: Awaited<ReturnType<typeof refreshTokens>>;

  try {
    refreshed = await refreshTokens(settings, refreshToken);
  } catch (error) {
    // Network error, IDAM down, or unexpected response. Log it but don't force logout — the token
    // might still be valid, and a transient error shouldn't boot everyone. The next request will
    // try again if we're still in the refresh window.
    console.error("Token refresh failed with error:", error);
    return next();
  }

  // Refresh token was revoked, expired, or IDAM refused it — force re-authentication.
  if (!refreshed) {
    console.log("Token refresh returned invalid_grant — signing out");
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // Refresh succeeded — update session with new tokens and continue.
  await updateTokens(req, refreshed.tokens);
  next();
}
