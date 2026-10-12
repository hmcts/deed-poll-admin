/**
 * Forbids every cache from storing a signed-in page.
 *
 * Case pages carry names, addresses and dates of birth, and caseworkers share court PCs. Without this, Express sends
 * no cache directive, so after sign-out the Back button or the browser's back-forward cache can show the last
 * applicant's case to the next person at the desk (OWASP assessment M2).
 *
 * **Mounted once, globally, after `requireAuth`**, for `requireAuth`'s own reason: a page added later is covered by
 * being a page, where a per-page header would be silently missing from the first one nobody remembered. After
 * `requireAuth`, so an anonymous visitor's redirect to login is untouched. Before the gates and the router, so a
 * refusal or an error page shown to a signed-in user inherits it. Public paths are the same allowlist `requireAuth`
 * uses, so the two cannot disagree about which pages are signed-in ones.
 *
 * `Pragma` is for HTTP/1.0 intermediaries only. No `Vary`, `Expires` or `private`: `no-store` already forbids
 * storing.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isPublicPath } from "./require-auth.js";

export function noStore(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isPublicPath(req.path)) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
    }
    next();
  };
}
