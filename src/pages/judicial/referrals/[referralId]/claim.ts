/**
 * Claim a referral out of the shared pool.
 *
 * **POST only, and it renders nothing.** api's sub-resource names the transition and takes no body — the holder
 * comes from the token — so there is nothing to validate and nothing to keep on screen. A `GET` of this path is
 * a 404 from the router, which is correct: claiming is not a page.
 *
 * **Nothing is read first.** The pool is shared, so a referral that was `Open` when the page rendered may have
 * been taken since; a pre-read would be a second round trip whose answer was stale by the time it was acted on.
 * api re-checks and refuses, which is the whole of the concurrency story here (`referrals-admin-3` decision 5).
 *
 * **The two refusals divide by visibility, and they go to different places.** api checks visibility *before*
 * state, so a referral another judge has taken is a **404** — indistinguishable from withdrawn, closed and
 * never-there (decision 10) — and the judge goes back to the pool, where the next piece of work is. The **409**
 * is only reachable for a referral this judge can still see and cannot claim, which api's visibility narrows to
 * one thing: they already hold it, or they have already directed it. So a 409 goes to the *referral*, not the
 * pool: it is theirs, it is not on the pool's list any more, and "choose another referral" would send them away
 * from the work they just picked up. Neither message names a judge.
 *
 * Redirecting rather than rendering is what the forms' objection to `?error=` does not apply to: there is no
 * input to lose, and both destinations have to be re-read to be true.
 *
 * A successful claim lands on the referral, now this judge's to direct — the referral view re-reads it, so the
 * state on screen is the one api has just published rather than one assumed here.
 */
import { ConflictError, claimReferral, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

const POOL_PATH = "/judicial/referrals";

export const POST = async (req: Request, res: Response) => {
  const { referralId } = req.params;

  try {
    // Ungated beyond the area's role gate: api decides who may claim from the token, and a second refusal here
    // would put the authority in two places.
    await claimReferral(referralId, callerFromRequest(req));
  } catch (error) {
    // Visible but not claimable, which api's visibility makes exactly one thing: this judge already holds it, or
    // has already directed it. The referral is where that is legible, and the state is on it.
    if (error instanceof ConflictError) {
      return res.redirect(`${referralPath(referralId)}?claim=held`);
    }
    if (error instanceof NotFoundError) {
      return res.redirect(`${POOL_PATH}?claim=unavailable`);
    }
    throw error;
  }

  res.redirect(referralPath(referralId));
};

function referralPath(referralId: string): string {
  return `${POOL_PATH}/${encodeURIComponent(referralId)}`;
}
