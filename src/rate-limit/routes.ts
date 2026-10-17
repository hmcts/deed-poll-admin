/**
 * Where the abuse limits apply: the four actions api limits too (OWASP plan 06, decision 7).
 *
 * Mounted on the app ahead of the page router rather than inside each page's export, because the limiter is built
 * over the Redis client `createApp` connects and a page module is imported before that exists. Ahead of the router
 * is also what puts the cap and the limiter **before `uploadSingleFile()`**: a refusal must never reach multer, or
 * the pod has already spent the memory the refusal exists to save. The cap goes first so an upload it refuses is
 * not counted against the user.
 *
 * Search counts only a non-blank `q`. Saved-query and worklist links carry `where` or `filter` in their URLs, and
 * counting those would refuse a caseworker for clicking their own dashboard.
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { createRateLimiter } from "./limiter.js";

export function mountAbuseLimits(app: Express, rateLimit: ReturnType<typeof createRateLimiter>, uploadInFlight: RequestHandler): void {
  app.get("/deed-polls", searchOnly(rateLimit("search")));
  app.post("/deed-polls/:id/emails/:template/preview", rateLimit("email-preview"));
  app.post("/deed-polls/:id/emails/:template/send", rateLimit("email-send"));
  app.post("/deed-polls/:id/documents/upload", uploadInFlight, rateLimit("upload"));
}

/** The same test the list page applies before it searches, so what is counted is what is searched. */
function searchOnly(limit: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const { q } = req.query;
    if (typeof q !== "string" || q.trim() === "") return next();
    return limit(req, res, next);
  };
}
