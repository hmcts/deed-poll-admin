/**
 * Serve one of a referral's supporting documents to the judge who may see it.
 *
 * Same-origin for the caseworker route's reason, and relayed through the same `src/document-response.ts`, so the
 * judge's browser gets exactly the headers and the inline-render containment a caseworker's does. Every judge who
 * can see an `Open` referral may open its documents; that is api's visibility rule, read from the token, and this
 * route asks nothing about the role (the `/judicial` mount is the area's gate).
 *
 * **A 404 is the "no longer available" page, not the shared "Page not found".** api answers one 404 for a referral
 * withdrawn, closed, another judge's or never there, and for a document not on its application, so the page says
 * only what is true of all of them and names no holder.
 */
import { downloadReferralDocument, NotFoundError } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { callerFromRequest } from "../../../../../../auth/current-user.js";
import { sendDocument } from "../../../../../../document-response.js";
import { referralPath } from "../../../../../../judicial-referral-path.js";
import { pathSegment } from "../../../../../../path-segment.js";

const MINE_PATH = "/judicial/referrals/mine";

/** The "no longer available" page's words, as `../../../[referralId].ts` renders them. See decision 10. */
const unavailableEn = {
  title: "This referral is no longer available",
  heading: "This referral is no longer available",
  body: "Your referrals are listed on My referrals.",
  backToMine: "Back to My referrals"
};

const unavailableCy = { ...unavailableEn };

export const GET = async (req: Request, res: Response, next: NextFunction) => {
  const { referralId, documentId } = req.params;
  // Refused before the read, as the referral page refuses its id: the adapter encodes but leaves dots alone, and
  // a `..` would resolve to a different api path rather than a document.
  referralPath(referralId);
  pathSegment(documentId, "Document id");

  let download: Awaited<ReturnType<typeof downloadReferralDocument>>;
  try {
    download = await downloadReferralDocument(referralId, documentId, callerFromRequest(req));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;

    return res.status(404).render("judicial/referrals/unavailable", { myReferralsPath: MINE_PATH, en: unavailableEn, cy: unavailableCy });
  }

  sendDocument(download, res, next);
};
