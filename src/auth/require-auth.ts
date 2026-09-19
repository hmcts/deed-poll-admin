/**
 * Requires a signed-in user for everything except an explicit allowlist.
 *
 * **Mounted once, globally, rather than per page.** Two reasons. It is 8 page files today and will be
 * more, so per-page mounting means a new page is unauthenticated until someone remembers — and the
 * failure is silent, because an unguarded page looks exactly like a guarded one that happens to work.
 * And the polarity matters: an allowlist requires a page to be *asked* to be public, which is the same
 * argument that shaped the `NODE_ENV` allowlist in `plain-http.ts`. Do not invert this to a denylist.
 *
 * A GET is redirected to `/login` remembering where it was going. Anything else gets 403 rather than a
 * redirect: replaying a POST after login would resubmit a form the user has not seen since, and for
 * the edit tab that means writing 46 fields they may not have intended.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sessionUser } from "./session.js";

/**
 * Paths reachable without signing in.
 *
 * `/login` and `/oauth2/callback` are the flow itself, so requiring auth for them would be a loop.
 * `/health` is probed by Kubernetes, which has no session. The footer pages are statutory content
 * (accessibility statement, privacy policy, cookies) that must be readable before login.
 *
 * `/` is here even though neither home behind it is public: it resolves which persona's home a
 * signed-in user gets and sends an anonymous one to `/login?returnTo=%2F` itself, which is the same
 * place this gate would send them. The entry is therefore behaviourally neutral, and it is kept so the
 * routing decision stays in one readable handler rather than being split between that handler and this
 * allowlist. Nothing is disclosed either way — the redirect target does the refusing. See
 * `src/pages/index.ts`, which owns the reasoning.
 *
 * Asset paths are matched by prefix because Vite serves them under `/@vite`, `/@fs` and `/src` in
 * development and the built bundles live under `/assets`.
 */
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/oauth2/callback",
  "/logout",
  "/accessibility-statement",
  "/contact-us",
  "/privacy-policy",
  "/terms-and-conditions",
  "/cookies"
]);

const PUBLIC_PREFIXES = ["/health", "/assets/", "/@vite", "/@fs", "/src/", "/favicon"];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isPublicPath(req.path) || sessionUser(req)) {
      return next();
    }

    if (req.method === "GET") {
      // Only the path and query are remembered, never a caller-supplied absolute URL — see
      // safeReturnTo in the login page for why.
      return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    res.status(403).render("errors/404");
  };
}
