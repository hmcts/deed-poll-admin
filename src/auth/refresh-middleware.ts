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
 *
 * **It is also where the caller's access is kept current.** Each successful refresh asks api's `GET /me` with the
 * new token, so a changed AM assignment takes effect within one token lifetime; a failed `/me` keeps the previous
 * answer. A session holding no answer at all — one saved before this app read `/me` — is asked once on the next
 * request that does not refresh, and asked again on the one after if that fails, so nobody has to sign in again.
 *
 * **One refresh per session at a time, across every instance (review finding E01).** A refresh token may be single-use,
 * so two requests refreshing with it at once would each be answered with different tokens, and the later save would
 * replace the newer pair. So a refresh first takes the session's lease in the store (`claimRefresh`), waiting a bounded
 * time for any other holder, and then decides from the session as the store holds it **now**: a request that waited
 * usually finds the winner's tokens already installed and goes on with them, refreshing nothing. The tokens and their
 * `/me` answer are published in one save that the store refuses unless the lease is still this request's. A refusal
 * is never retried with IDAM — the refresh token may already be spent — so a lost lease fails the request instead, and
 * a session that ended meanwhile (logout elsewhere) leaves this request signed out rather than continuing on the
 * snapshot it started with.
 */
import type { NextFunction, Request, Response } from "express";
import { fetchCallerAccess } from "./caller-access.js";
import { endedElsewhere } from "./ended-elsewhere.js";
import { SessionWriteRefusedError } from "./guarded-session-store.js";
import { describeIdamError, type IdamTokens, refreshTokens } from "./idam.js";
import { securityEvent } from "./security-events.js";
import {
  claimRefresh,
  isSessionGone,
  publishRefresh,
  releaseRefresh,
  sessionAccessToken,
  sessionHoldsAccess,
  sessionRefreshToken,
  sessionSubject,
  sessionTokenExpiry,
  sessionUser,
  signOut,
  storeAccess
} from "./session.js";
import { STATUS_PATH, TIMED_OUT_PATH } from "./session-lifetime.js";
import { idamSettings } from "./settings.js";

const REFRESH_WINDOW_SECONDS = 5 * 60; // Refresh 5 minutes before expiry
/**
 * Paths that are never renewed. Revocation must never wait on renewal: a request holding the lease would otherwise
 * delay or fail a sign-out. The two lifetime paths pass `sessionLifetime` unenforced, so a session past its absolute
 * limit still reaches them, and renewing it there would issue IDAM tokens for a session that is over (review finding
 * R06). The status poll's answer and the timed-out page need nothing this middleware does.
 */
const NOT_REFRESHED_PATHS = new Set(["/logout", STATUS_PATH, TIMED_OUT_PATH]);

export async function refreshMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = sessionUser(req);
  if (!user || NOT_REFRESHED_PATHS.has(req.path)) {
    // Not signed in — nothing to refresh. `requireAuth` would have already redirected.
    return next();
  }

  const expiresAt = sessionTokenExpiry(req);
  const refreshToken = sessionRefreshToken(req);
  const now = Math.floor(Date.now() / 1000);

  // **An already-expired access token with nothing to refresh it is not a session that expires
  // naturally.** `refreshToken` is optional — IDAM only issues one for `offline_access` — and after the
  // cutover every case page presents the access token to `deed-poll-api`, which answers 401, which
  // `errors.ts` meets with a sign-in-again page rather than a redirect — an extra click, on a condition
  // that is known before any page runs. Ending it here hands the next request straight to
  // `requireAuth`, which cannot loop because the session is destroyed first. Same decision as the
  // expired-token branch in the refresh failure below.
  if (expiresAt && expiresAt - now <= 0 && !refreshToken) {
    console.warn("Access token has expired and the session holds no refresh token — signing out");
    securityEvent("auth.session.ended", req, { reason: "no_refresh_token" });
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // No expiry time or no refresh token — can't refresh. Session will expire naturally.
  if (!expiresAt || !refreshToken) {
    return continueWithAccess(req, res, next);
  }

  const timeUntilExpiry = expiresAt - now;

  // Token still has time — no refresh needed yet.
  if (timeUntilExpiry > REFRESH_WINDOW_SECONDS) {
    return continueWithAccess(req, res, next);
  }

  // A signed-in session with no recorded subject cannot have its refresh checked against anything, so
  // it is ended rather than refreshed. This is only reachable for a session established before the
  // subject was stored, which makes signing out the cheap and self-limiting answer — and the polarity
  // matches the rest of this app's auth decisions: what cannot be verified is refused.
  const subject = sessionSubject(req);
  if (!subject) {
    console.warn("Session has no recorded IDAM subject, so its refresh cannot be verified — signing out");
    securityEvent("auth.session.ended", req, { reason: "no_subject" });
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // Token is close to expiry or already expired. Only the lease holder may refresh, and only from what the store holds.
  const claim = await claimRefresh(req).catch((error: unknown) => {
    if (isSessionGone(error)) return { outcome: "missing" as const };
    throw error;
  });
  if (claim.outcome === "missing") return endedElsewhere(req, res);
  if (claim.outcome === "conflict") throw new Error("Session key holds another incarnation of this session — not refreshing");
  if (claim.outcome === "busy") {
    // Another request is still refreshing. Its result is not known, so this one goes on with what it has, which is
    // what an unreachable IDAM would leave it with — but not on a token that no longer works.
    console.warn("Token refresh is still in progress elsewhere for this session");
    // Judged after the wait, which can be ten seconds: a token that had a second left when the wait began has none now.
    if (expiresAt - Math.floor(Date.now() / 1000) > 0) return continueWithAccess(req, res, next);
    throw new Error("Token refresh is still in progress elsewhere and the access token has expired");
  }

  try {
    await refreshAsOwner(req, res, next, claim.lease);
  } finally {
    // Published, signed out or failed, the lease is no longer needed. A no-op once the publish has given it up.
    await releaseRefresh(req, claim.lease);
  }
}

/** The refresh itself, by the lease holder, from the session as just read again from the store. */
async function refreshAsOwner(req: Request, res: Response, next: NextFunction, lease: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = sessionTokenExpiry(req);
  const refreshToken = sessionRefreshToken(req);
  const subject = sessionSubject(req);
  // The request this one waited on has already renewed the session, or changed it so it is no longer renewable here.
  if (!expiresAt || !refreshToken || !subject || expiresAt - now > REFRESH_WINDOW_SECONDS) {
    return continueWithAccess(req, res, next);
  }
  const timeUntilExpiry = expiresAt - now;

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
    console.error("Token refresh failed with error:", describeIdamError(error));

    // **An access token that has already expired is a different case, and the cutover is what made it
    // one.** Every case page now presents this token to `deed-poll-api`, which answers 401, which
    // `callApi` turns into `UnauthorizedError` — and `errors.ts` can only meet that with a sign-in-again
    // page, an extra click on every expiry that a redirect from here avoids. Continuing is only
    // defensible while the token still works; once it does not, there is nothing left to continue with.
    // Signing out here cannot loop the way a redirect from the error handler would, because the session
    // is destroyed first: the next request has no user and `requireAuth` owns it.
    if (timeUntilExpiry > 0) return continueWithAccess(req, res, next);

    console.warn("Token refresh failed and the access token has expired — signing out");
    securityEvent("auth.session.ended", req, { reason: "refresh_failed_expired" });
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // Revoked, expired, refused — or a response describing a different subject. All mean this session is
  // over rather than retryable, and only the event tells them apart: a substituted subject is worth an alert.
  if (!refreshed.ok) {
    console.log("Token refresh was refused — signing out");
    securityEvent("auth.session.ended", req, { reason: refreshed.reason === "subject_mismatch" ? "subject_mismatch" : "refresh_refused" });
    await signOut(req);
    return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  }

  // Refresh succeeded — publish the new tokens, and the answer for them if api gave one, and continue.
  const access = await fetchCallerAccess(refreshed.tokens.accessToken, "refresh");
  if (!(await published(req, lease, refreshed.tokens, access))) return endedElsewhere(req, res);
  next();
}

/**
 * Whether the refresh was stored. False only when the session ended while IDAM was answering; a lost lease or a
 * store failure rejects, because then this request cannot say which tokens the session now holds.
 */
async function published(req: Request, lease: string, tokens: IdamTokens, access: Awaited<ReturnType<typeof fetchCallerAccess>>): Promise<boolean> {
  try {
    await publishRefresh(req, lease, tokens, access);
    return true;
  } catch (error) {
    if (isSessionGone(error)) return false;
    if (error instanceof SessionWriteRefusedError) console.warn(`Refreshed tokens were not stored: ${error.reason}`);
    throw error;
  }
}

/**
 * Ask `/me` for a session that holds no answer, with the token it already has, before the request goes on. A session
 * that ended while api was answering leaves this request signed out.
 */
async function continueWithAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const accessToken = sessionAccessToken(req);
  if (accessToken && !sessionHoldsAccess(req)) {
    const access = await fetchCallerAccess(accessToken, "backfill");
    try {
      if (access) await storeAccess(req, access);
    } catch (error) {
      if (isSessionGone(error)) return endedElsewhere(req, res);
      throw error;
    }
  }
  next();
}
