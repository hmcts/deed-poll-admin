/**
 * Mark a returned direction as actioned — the confirmation, and the post that commits api's closure.
 *
 * **There is a confirmation step here where the withdrawal has none**, and the difference is what the two acts
 * claim. Withdrawing takes a case back and can be undone by referring it again; closing is the caseworker
 * asserting that a judge's direction has been carried out and that the application has been updated to match, on
 * a referral api will then drop out of the returned-for-action worklist. api publishes no re-open, so nobody
 * comes back to check. That assertion is worth reading before it is made, which is decision 6.
 *
 * **The GET is a read and refuses to present the action for anything but `Decided`.** A referral with no
 * direction waiting has nothing to confirm, and a confirmation page whose only submit api answers 409 to would
 * be an invitation to be refused. Such a visit is redirected to the referral's own page, which offers whichever
 * control does apply and shows the fresh state that explains why this one does not — the same answer
 * `../../../queries/[queryId]/delete.ts` gives an unshared query.
 *
 * **The POST reads nothing first.** The guard above is for the caseworker, not for api: a state read here would
 * be stale by the time it acted on its answer, and api refuses anything but `Decided` itself. So the state is
 * checked where it is rendered and enforced where it is committed, and neither pretends to be the other.
 *
 * **Both outcomes land on the referral, not on this page** (post/redirect/get). Success carries a banner there
 * because that is where the closed state and the preserved direction are; the 409 carries a message there for
 * the reason `withdraw.ts` records — the state beside the refusal has to be re-read to be true. A refresh of
 * either lands on a plain GET of the referral rather than repeating the closure.
 */
import { buildReferralDetail, ConflictError, closeReferral, findDeedPoll, findReferral } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";
import { casePath } from "../../../../../case-path.js";
import { pathSegment } from "../../../../../path-segment.js";

const en = {
  title: "Confirm the direction has been actioned",
  heading: "Confirm the direction has been actioned",
  // Decision 3's label, as the referral page uses it: the case header carries a state of its own and this page
  // is about neither changing it nor reporting it.
  stateLabel: "Referral status",
  directionHeading: "Direction from the judiciary",
  decisionLabel: "Decision",
  directionsLabel: "Directions",
  gazetteLabel: "Published in the Gazette",
  decidedByLabel: "Decided by",
  decidedLabel: "Decision date",
  yes: "Yes",
  no: "No",
  // The third answer api's nullish `publishToGazette` has, said rather than collapsed onto "No" — see
  // `gazetteAnswer`.
  gazetteNotRecorded: "Not recorded",
  // Decision 6: the three things the caseworker is confirming, said before the submit rather than after it.
  confirmingIntro: "By marking this referral as actioned you are confirming that:",
  confirmingDirection: "you have carried out the judicial direction",
  confirmingUpdates: "you have made any updates the application needs, including any dates",
  confirmingWorklist: "this referral will leave the list of returned directions waiting for action",
  // True because api publishes no re-open, and the second sentence is why that is not a loss: closing records
  // that the direction was actioned, it does not undo it.
  irreversible: "You cannot undo this. The direction stays on the referral for reference.",
  confirm: "Mark direction as actioned",
  cancel: "Cancel",
  backToReferral: "Back to referral"
};

// English content in the cy shape — see the note in ../../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const href = referralHref(req);
  const caller = callerFromRequest(req);
  // Both reads are load-bearing and neither degrades: the reference names what is being confirmed, and the
  // direction is the thing being confirmed. A page missing either would be asking the caseworker to attest to
  // something it had not shown them.
  const [found, referral] = await Promise.all([findDeedPoll(req.params.id, caller), findReferral(req.params.id, req.params.referralId, caller)]);

  const view = buildReferralDetail(referral);

  // `canClose` is exactly `Decided` (`referrals-view.ts`), so this covers a referral already actioned, one
  // withdrawn, one still with the judiciary and one in a state this app cannot read.
  if (!view.canClose) return res.redirect(href);

  const content = res.locals.locale === "cy" ? cy : en;

  res.render("deed-polls/referral-close", {
    case: found,
    referral: view,
    // The boolean in this page's words, for the reason `../[referralId].ts` gives: a template ternary over a
    // nullish value prints "No" for a direction that recorded no answer.
    gazetteAnswer: gazetteAnswer(view.direction?.publishToGazette, content),
    closeHref: `${href}/close`,
    referralHref: href,
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  // Before the write, so an id that cannot be redirected to is refused rather than closed and then refused.
  const href = referralHref(req);
  try {
    // No body and no pre-read: api's sub-resource names the transition, stamps the actor from the token and
    // refuses anything but `Decided`. Ungated here for the same reason the withdrawal is — a second authority on
    // somebody else's state machine is one that can disagree with it.
    await closeReferral(req.params.id, req.params.referralId, callerFromRequest(req));
  } catch (error) {
    // Another caseworker got there first, or the referral moved on while this page was open. An ordinary race,
    // so it goes back to the referral as a message rather than to the 500 page.
    if (error instanceof ConflictError) {
      return res.redirect(`${href}?close=conflict`);
    }
    throw error;
  }

  res.redirect(`${href}?close=actioned`);
};

/**
 * The Gazette direction in words — three answers, because api's `publishToGazette` is nullish.
 *
 * The third copy of this resolution in the app (`../[referralId].ts` and
 * `../../../../judicial/referrals/[referralId].ts` are the others) and deliberately not shared: the two words
 * are each page's `en`/`cy`, and a library that answered "Yes" would be the one string Welsh could not reach.
 */
function gazetteAnswer(publishToGazette: boolean | null | undefined, content: typeof en): string {
  if (publishToGazette === true) return content.yes;
  if (publishToGazette === false) return content.no;

  return content.gazetteNotRecorded;
}

function referralHref(req: Request): string {
  return `${casePath(req.params.id)}/referrals/${pathSegment(req.params.referralId, "Referral id")}`;
}
