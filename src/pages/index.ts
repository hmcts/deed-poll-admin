/**
 * The service root, which is the case list.
 *
 * **A redirect rather than a second copy of the list.** `/deed-polls` is the collection's canonical
 * URL because everything nested hangs off it — `/deed-polls/:id`, `/deed-polls/:id/notes/…` — and the
 * list's own filter links are absolute (`/deed-polls?filter=…`), so rendering the list here would
 * produce a page whose every link navigates away from itself.
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
 * **Still on `requireAuth`'s public allowlist, deliberately** — not because the case list is public, it
 * is not, but so that an anonymous visitor's `returnTo` becomes `/deed-polls` rather than `/`. Off the
 * allowlist they would sign in, come back to `/`, and be redirected again.
 */
import type { Request, Response } from "express";

export const GET = async (_req: Request, res: Response) => {
  // 302, not 301: a permanent redirect is cached hard by browsers, and the root of a service is
  // exactly the URL you might later want to point somewhere else.
  res.redirect("/deed-polls");
};
