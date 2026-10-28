/**
 * Withdraw the direction this judge gave, so they can give a new one (plan decision 6).
 *
 * **A confirmation page and one write.** The `GET` says what withdrawing leaves — the referral stays claimed by this
 * judge, waiting for a new direction, and api returns it to the office for assignment if none is given in time — and
 * the `POST` makes the one call. No body: api's sub-resource names the transition and the judge comes from the token.
 *
 * **The `GET` reads the referral, the `POST` reads nothing.** The read is the caption and the guard: a judge must see
 * which application's direction they are withdrawing, and a referral with no direction of theirs is sent back to its
 * own page rather than shown a button api can only refuse. The write re-checks nothing, because api does.
 *
 * **The refusals are the direction page's** (decision 7). A 409 is a visible referral that is not this judge's
 * direction, so they go back to the referral, re-read, with a sentence naming its state; a 404 — closed, or
 * otherwise out of sight — is the "no longer available" page. Neither says who did what.
 *
 * Success lands on the referral, now `Claimed`, which offers the direction form as for any claimed referral.
 */
import { buildJudicialReferral, ConflictError, getReferral, NotFoundError, withdrawOwnDirection } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { referralPath } from "../../../../judicial-referral-path.js";

const MINE_PATH = "/judicial/referrals/mine";

const en = {
  title: "Withdraw your direction",
  heading: "Withdraw your direction",
  // Decision 6's wording, with assignment's consequence. It says what is owed and what happens if it is not given, and names no other judge.
  body: "You'll need to give a new direction. Until you do, this referral stays with you. If it isn't directed in time, it goes back to the office to be assigned again.",
  withdraw: "Withdraw direction",
  cancel: "Cancel"
};

// English content in the cy shape — see the note in ../../../deed-polls/index.ts.
const cy = { ...en };

/** The "no longer available" page's words, as `../[referralId].ts` renders them. See decision 10. */
const unavailableEn = {
  title: "This referral is no longer available",
  heading: "This referral is no longer available",
  body: "Your referrals are listed on My referrals.",
  backToMine: "Back to My referrals"
};

const unavailableCy = { ...unavailableEn };

export const GET = async (req: Request, res: Response) => {
  const { referralId } = req.params;
  // Before the read, so an unusable id is refused without asking api about it.
  const referralHref = referralPath(referralId);

  let detail: Awaited<ReturnType<typeof getReferral>>;
  try {
    detail = await getReferral(referralId, callerFromRequest(req));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;

    return unavailable(res);
  }

  const view = buildJudicialReferral(detail);

  if (!view.changeable) {
    return res.redirect(`${referralHref}?direction=notchangeable`);
  }

  res.render("judicial/referrals/direction-withdraw", {
    reference: view.application?.reference ?? "",
    withdrawHref: `${referralHref}/withdraw`,
    referralHref,
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  const { referralId } = req.params;
  // Before the write, so refusing an unusable id cannot follow one.
  const referralHref = referralPath(referralId);

  try {
    await withdrawOwnDirection(referralId, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError) {
      return res.redirect(`${referralHref}?direction=notchangeable`);
    }
    if (error instanceof NotFoundError) return unavailable(res);
    throw error;
  }

  res.redirect(`${referralHref}?direction=withdrawn`);
};

/** Decision 10's page, and the same template the referral view renders for an invisible referral. */
function unavailable(res: Response) {
  res.status(404).render("judicial/referrals/unavailable", { myReferralsPath: MINE_PATH, en: unavailableEn, cy: unavailableCy });
}
