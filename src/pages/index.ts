/**
 * The service root, which is where each persona's home is decided.
 *
 * **A redirect rather than a second copy of any list.** `/deed-polls` is the case collection's canonical URL
 * because everything nested hangs off it — `/deed-polls/:id`, `/deed-polls/:id/notes/…` — and the list's own
 * filter links are absolute (`/deed-polls?filter=…`), so rendering the list here would produce a page whose
 * every link navigates away from itself. The same is true of `/judicial/referrals`.
 *
 * This replaced the template's marketing home page, which described `hmcts/expressjs-monorepo-template`
 * rather than this service. `/` needs a handler rather than nothing: it is what anyone visiting the
 * bare hostname or a bookmarked root gets.
 *
 * Note it is *not* reached from the GOV.UK header, despite `site-header.njk` passing `serviceUrl: "/"`.
 * govuk-frontend 6 removed `serviceName` and `serviceUrl` from `govukHeader` in favour of
 * `govukServiceNavigation`, so both options are silently ignored and no service-name link is rendered.
 * See loose end 15 — when that is fixed, the header becomes a second consumer of this redirect.
 *
 * **Judicial routing, and why this file is the only place it can happen** (`referrals-admin-3` decision 2). A
 * judge's home is `/judicial/referrals`, and their role is only knowable once they have signed in — so `/` is
 * the hinge: an anonymous visitor is sent to log in and *back here*, and the persona is resolved on the second
 * pass. This costs a hop that the previous version of this file deliberately avoided by redirecting anonymous
 * visitors straight to `/deed-polls`, which is exactly the bug: it pinned the caseworker's list as the
 * `returnTo` before anyone knew who was arriving, so a judge signed in and landed on a list api answers 403 to.
 *
 * **Still on `requireAuth`'s public allowlist, and now for a second reason.** It was there so an anonymous
 * visitor's `returnTo` was resolved here rather than at `/`; it stays there because this handler now does the
 * sending itself, and a gate in front of it would send them to `/login?returnTo=%2F` — the same place, by a
 * route this file could no longer see. Nothing is disclosed either way: the redirect target does the refusing.
 */
import type { CurrentUser } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { userFromRequest } from "../auth/current-user.js";
import { sessionUser } from "../auth/session.js";

const CASE_LIST_PATH = "/deed-polls";

const JUDICIAL_POOL_PATH = "/judicial/referrals";

export const GET = async (req: Request, res: Response) => {
  // Back here after signing in, not to either home: which one is right is not knowable yet, and `/login`'s own
  // fallback is this path for the same reason.
  if (!sessionUser(req)) {
    return res.redirect(`/login?returnTo=${encodeURIComponent("/")}`);
  }

  // 302, not 301: a permanent redirect is cached hard by browsers, and the root of a service is
  // exactly the URL you might later want to point somewhere else — here it is also *per user*, which a
  // cached 301 would get wrong for the next person on a shared machine.
  res.redirect(landingPath(userFromRequest(req)));
};

/**
 * Where a signed-in user's day starts.
 *
 * **Caseworker-first for a user holding both roles** (decision 2): the caseworker surface is the richer one, where
 * the reverse would leave a caseworker on a screen with no case list.
 *
 * **What that costs, stated rather than glossed.** No navigation *into* the judicial area exists — the two
 * judicial lists have their own navigation between themselves (`referrals-admin-6`), but it renders only on pages
 * inside the area, the shared chrome renders no service-navigation, and `judicial.spec.ts` asserts the case list
 * carries no `/judicial` link — so a dual-role user reaches their pool only by typing `/judicial/referrals`. The
 * gate admits them (`requireRole` in `src/auth/require-role.ts`, pinned by its test), so this is a missing route
 * into a permitted area and not a refusal. An earlier version of this docblock claimed the judge's area was "one
 * link away", which was never true and made the default look free. Whether such a user exists is
 * `referrals-admin-3`'s flagged open question; if the business confirms one does, the answer is a link on the case
 * list rendered when `isJudicial`, not a change here.
 *
 * A user with neither role also lands on the case list. It is not a privilege — `requireAuth` has already said
 * they are signed in and api enforces what they may read — and the alternative, a chooser or a third page, would
 * be a page built for a state no role assignment produces.
 */
function landingPath(user: CurrentUser): string {
  return user.isJudicial && !user.isAdmin ? JUDICIAL_POOL_PATH : CASE_LIST_PATH;
}
