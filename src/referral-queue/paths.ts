/**
 * The referral queue's own paths (plan Fa1). The queue lists referrals across every case, so its URLs name the
 * referral and carry the case as `?case=`: api addresses a referral under its case, and the queue row is where the
 * case id comes from. The referral id goes through `pathSegment` and the case id is encoded as a query value; api
 * still answers 404 for a referral that is not under the case named.
 */
import { pathSegment } from "../path-segment.js";

export const REFERRAL_QUEUE_PATH = "/deed-polls/referrals";

/** The read-only check view of one queued referral. */
export function queueReferralPath(referralId: string, caseId: string): string {
  return `${REFERRAL_QUEUE_PATH}/${pathSegment(referralId, "Referral id")}?case=${encodeURIComponent(caseId)}`;
}

/** The reassignment of a referral already with a Master. */
export function queueReassignPath(referralId: string, caseId: string): string {
  return `${REFERRAL_QUEUE_PATH}/${pathSegment(referralId, "Referral id")}/reassign?case=${encodeURIComponent(caseId)}`;
}
