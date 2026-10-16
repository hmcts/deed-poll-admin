/**
 * Idle and absolute limits on a signed-in session, decided only from the timestamps held in the store.
 *
 * OWASP plan 03 (M7). Before this, a session ended only after a whole day unused: express-session slid the cookie on
 * every request, and token refresh re-issued it, so a session left open on a shared PC never ended while anyone
 * touched it once a day.
 *
 * Mounted once, globally, before `requireAuth` and `refreshMiddleware`, so a session past either limit is ended
 * before a refresh can renew it, and a page added later is covered by existing. The cookie's own expiry and the
 * client-side warning are conveniences; neither decides anything here.
 *
 * A timeout ends the session here and then at IDAM, as logout does. **Not a redirect to `/login`:** the IDAM session
 * usually outlives ours, so `/login` would sign whoever is at the PC straight back in. That looks equivalent
 * locally, where the IDAM simulator keeps no session, and is not.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { renderTimedOut } from "../pages/session-timed-out/index.js";
import { endSessionUrl } from "./idam.js";
import { isProbeOrAssetPath, isPublicPath } from "./require-auth.js";
import { safeReturnTo } from "./return-to.js";
import { securityEvent } from "./security-events.js";
import { restartAfterTimeout, sessionIdToken, sessionTimestamps, sessionUser, touchLastSeen } from "./session.js";
import { idamSettings } from "./settings.js";

export const TIMED_OUT_PATH = "/session-timed-out";
/** The timeout warning's read-only question: how long is left. Never activity, and never ends a session. */
export const STATUS_PATH = "/session/status";

/** Activity is recorded at most this often, so most requests write nothing to the store. */
const LAST_SEEN_RESOLUTION_SECONDS = 60;

/** What a timed-out user still needs: to finish signing out, and to read why they were. */
const EXEMPT_PATHS = new Set(["/logout", TIMED_OUT_PATH]);

export function sessionLifetime(limits: SessionLifetimeLimits): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (EXEMPT_PATHS.has(req.path) || isProbeOrAssetPath(req.path) || !sessionUser(req)) return next();

    const now = Math.floor(Date.now() / 1000);
    const timestamps = sessionTimestamps(req);
    // Answered, never enforced: the warning asks before declaring a timeout, and then reloads the page, which is
    // where an expired session is ended properly, through IDAM, with its destination kept.
    if (req.path === STATUS_PATH) {
      res.locals.sessionClock = timeLeft(timestamps, now, limits);
      return next();
    }

    const reason = endReason(timestamps, now, limits);
    if (reason) return endTimedOutSession(req, res, reason, limits);

    // Public pages are not activity: `/` and the footer pages can be reached by a browser left open, without a user.
    if (timestamps && !isPublicPath(req.path) && now - timestamps.lastSeenAt >= LAST_SEEN_RESOLUTION_SECONDS) {
      await touchLastSeen(req);
    }
    // For the layout's timeout warning. A convenience only: this middleware, not the browser, ends the session.
    res.locals.sessionClock = timeLeft(sessionTimestamps(req), now, limits);
    next();
  };
}

/**
 * Why this session must end, or undefined if it may go on.
 *
 * A signed-in session without both timestamps ends rather than being grandfathered: it predates the limits, or was
 * written by something that bypassed `signIn`, and either way nothing can say how old it is.
 */
function endReason(timestamps: ReturnType<typeof sessionTimestamps>, now: number, limits: SessionLifetimeLimits): EndReason | undefined {
  if (!timestamps) return "untimed";
  if (now - timestamps.authenticatedAt >= limits.absoluteSeconds) return "absolute";
  if (now - timestamps.lastSeenAt >= limits.idleSeconds) return "idle";
  return undefined;
}

/** Whole seconds left on each limit, never negative, for the timeout warning. No timestamps means none left. */
function timeLeft(timestamps: ReturnType<typeof sessionTimestamps>, now: number, limits: SessionLifetimeLimits): SessionTimeLeft {
  if (!timestamps) return { idleSeconds: limits.idleSeconds, idleRemaining: 0, absoluteRemaining: 0 };
  return {
    idleSeconds: limits.idleSeconds,
    idleRemaining: Math.max(0, timestamps.lastSeenAt + limits.idleSeconds - now),
    absoluteRemaining: Math.max(0, timestamps.authenticatedAt + limits.absoluteSeconds - now)
  };
}

async function endTimedOutSession(req: Request, res: Response, reason: EndReason, limits: SessionLifetimeLimits): Promise<void> {
  // A plain line, with no identity or token. The subject goes only in the event, which is read before the session
  // is regenerated so it carries the ended session's sid rather than the fresh one's.
  console.warn(`session ended: ${reason}`);
  securityEvent("auth.session.ended", req, { reason });

  const idToken = sessionIdToken(req);
  const away = await endSessionUrl(idamSettings(), idToken, limits.logoutPathRegistered ? TIMED_OUT_PATH : "/");

  if (req.method === "GET") {
    await restartAfterTimeout(req, safeReturnTo(req.originalUrl));
    return res.redirect(away ?? TIMED_OUT_PATH);
  }

  // Never replayed: the person at the PC may not be who submitted it. The sign-in link ends the IDAM session first,
  // for the same reason the GET route does, rather than offering `/login`.
  await restartAfterTimeout(req, undefined);
  res.status(401);
  renderTimedOut(res, { unsaved: true, signInHref: away ?? "/login" });
}

type EndReason = "idle" | "absolute" | "untimed";

/** What the timeout warning is told: the idle limit itself, and the seconds left on each limit. */
export interface SessionTimeLeft {
  idleSeconds: number;
  idleRemaining: number;
  absoluteRemaining: number;
}

export interface SessionLifetimeLimits {
  idleSeconds: number;
  absoluteSeconds: number;
  /**
   * Whether IDAM has `/session-timed-out` registered as a post-logout address for this client. Until it has, IDAM
   * refuses it, so end-session returns to `/` instead. `SESSION_TIMEOUT_LOGOUT_PATH_REGISTERED`, set after Task 10.
   */
  logoutPathRegistered: boolean;
}
