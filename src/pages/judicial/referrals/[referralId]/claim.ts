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
 * **Both refusals go back to the pool, because that is where the next piece of work is.** A 409 means somebody
 * got there first; a 404 means the referral is not visible to this judge at all — withdrawn, closed, already
 * another judge's, or never there, and api answers all four identically on purpose (decision 10). Neither
 * message names another judge. Redirecting rather than rendering is what the forms' objection to `?error=` does
 * not apply to: there is no input to lose, and the pool has to be re-read to be true.
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
    if (error instanceof ConflictError) {
      return res.redirect(`${POOL_PATH}?claim=taken`);
    }
    if (error instanceof NotFoundError) {
      return res.redirect(`${POOL_PATH}?claim=unavailable`);
    }
    throw error;
  }

  res.redirect(`${POOL_PATH}/${encodeURIComponent(referralId)}`);
};
