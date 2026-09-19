/**
 * Requires a named role for an area of the site, on top of `requireAuth`'s authenticated-or-not check.
 *
 * **The first role guard in this app, and it is a persona boundary rather than a privilege one.** Every
 * role rule here until now was presentational — `canDeleteWitness(user) => user.isAdmin` hides a button
 * whose only outcome would be an api 403, and says so in its own docblock. This one refuses the request,
 * because the thing being separated is not a control but a whole area: `/judicial/**` is a judge's screen,
 * and a caseworker reaching it would be shown judicial chrome for a surface api will answer 403 to on
 * every call. Hiding a link cannot achieve that, since a link is not how someone arrives at a URL.
 *
 * **It is still not the data boundary.** api gates every `/judicial/**` route on `JUDICIAL` in its own
 * domain, so a caseworker who defeated this guard would see a screen of errors, not a judge's referrals.
 * Nothing here is what keeps an application away from someone who must not read it.
 *
 * Mounted on the area in `app.ts`, after `requireAuth` and before the router, for the same reason
 * `requireAuth` is global rather than per page: a judicial page added tomorrow is gated because it is under
 * `/judicial`, not because someone remembered to decorate it. It is **additive** — it never admits anyone
 * `requireAuth` would have turned away, and it does not touch that allowlist's polarity.
 *
 * Refuses by `next(ForbiddenError)` rather than rendering here, so the refusal goes through the one mapping
 * in `src/errors.ts` that already answers 403 — and so an unauthenticated request that somehow reached this
 * (it should not; `requireAuth` runs first) fails closed as a 403 rather than falling through.
 */
import { DEEDPOLL_JUDICIAL, ForbiddenError, type Role } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { userFromRequest } from "./current-user.js";

export function requireRole(role: Role): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (userFromRequest(req).roles.includes(role)) {
      return next();
    }

    // The message is for the log, never for the user: `errors.ts` renders the shared "Page not found"
    // view, so a caseworker who guesses a judicial URL learns nothing about what is behind it.
    next(new ForbiddenError(`${req.originalUrl} requires the ${role} role`));
  };
}

export function requireJudicial(): RequestHandler {
  return requireRole(DEEDPOLL_JUDICIAL);
}
