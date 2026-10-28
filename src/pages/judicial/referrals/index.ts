/**
 * Where the shared pool used to be, and now a redirect to My referrals.
 *
 * **There is no pool since api D2.** Raising a referral assigns it to a Master, so a Master's work is the referrals
 * api lists for them on `/judicial/referrals/mine`, and nothing a judge can see is waiting to be claimed. This path
 * stays because bookmarks, old e-mails and the persona switcher's history all hold it, and a 404 there would read as
 * the judge's work having gone.
 *
 * 302, not 301, for `../../index.ts`'s reason: a permanent redirect is cached hard, and this one is free to change.
 * No query is carried over: a pool page number means nothing on My referrals.
 *
 * Gated by `requireJudicial`, mounted on `/judicial` in `app.ts`, so a caseworker is refused here rather than sent on.
 */
import type { Request, Response } from "express";

const MINE_PATH = "/judicial/referrals/mine";

export const GET = (_req: Request, res: Response) => {
  res.redirect(MINE_PATH);
};
