/**
 * Withdraw a referral — taking a case back from the judiciary.
 *
 * **POST only, and it renders nothing.** api's sub-resource names the transition and takes no body, so there
 * is nothing to validate and nothing to keep on screen: the only outcomes are "done" and "api refused", and
 * both belong on the referral's own page. A `GET` of this path is a 404 from the router, which is correct — a
 * withdrawal is not a page.
 *
 * **There is no confirmation step**, following the note and witness deletes rather than inventing a second
 * voice for the same act: the button is styled as a warning and its label says what it does. Unlike those two
 * this is also reversible in the sense that matters — the case can be referred again, which is exactly how
 * api-1 expects an open referral to be amended.
 *
 * **The 409 comes back as a message on the referral, not an error page.** api answers 409 for anything but an
 * `Open` or `Claimed` referral (api-4's `canBeWithdrawn()`), which is what a caseworker sees if somebody else
 * finished with it — or a judge directed it — while this page was open: an ordinary race, not a fault. So the
 * refusal redirects to the referral view with `?withdraw=conflict`, and that page's own copy says so above the
 * state api has just published. Redirecting rather than rendering here is what the forms' `?error=` objection
 * does not apply to: there is no input to lose, and the state on the page afterwards has to be re-read to be
 * true.
 *
 * **There is one flag and two sentences, and the *page* chooses between them.** api refuses a `Decided`
 * withdrawal differently from a terminal one — a direction has to be actioned, not taken back — and only the
 * fresh read on the referral page knows which. Sending the reason in the query instead would carry this
 * handler's copy through a redirect and be stale by the time it rendered.
 */
import { ConflictError, withdrawReferral } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";

export const POST = async (req: Request, res: Response) => {
  try {
    // Ungated: api decides who may withdraw from the token, and a second refusal here would put the authority
    // in two places. Nothing is re-read first either — the referral's state is api's to check, and a check
    // here would be stale by the time it acted on the answer.
    await withdrawReferral(req.params.id, req.params.referralId, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError) {
      return res.redirect(`${referralPath(req)}?withdraw=conflict`);
    }
    throw error;
  }

  res.redirect(`/deed-polls/${req.params.id}#referrals`);
};

function referralPath(req: Request): string {
  return `/deed-polls/${req.params.id}/referrals/${encodeURIComponent(req.params.referralId)}`;
}
