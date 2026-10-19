/**
 * The path of one judicial referral's page, with its id as exactly one path segment — `casePath`'s contract
 * (`./case-path.ts`) under the judicial pool's prefix.
 *
 * Fortify instance `2950F280FFBEA2323139B0FEC2DF034A` flagged the claim and direction redirects. They already
 * encoded the id once, which keeps `/`, `?` and `#` inside the segment, but encoding leaves dots alone and a
 * browser drops a `.` or `..` segment, so those would name the pool or the area's parent. See
 * `docs/plans/completed/20261019-case-id-redirect-encoding.md`, Task 5.
 *
 * Pass the id as Express gave it — already decoded — and call this before any api read or write, so a refusal
 * cannot follow one. Domain calls keep the raw id.
 */
import { NotFoundError } from "@hmcts/deed-poll";

const POOL_PATH = "/judicial/referrals";
const UNUSABLE_SEGMENTS = new Set(["", ".", ".."]);

export function referralPath(referralId: string): string {
  if (UNUSABLE_SEGMENTS.has(referralId)) {
    // Fixed, so a log of the refusal repeats nothing the request supplied.
    throw new NotFoundError("Referral id is not a usable path segment");
  }
  return `${POOL_PATH}/${encodeURIComponent(referralId)}`;
}
