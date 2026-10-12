/** Migration-only: retains Team leader casework privileges, never Gazette access. */
export const DEEDPOLL_ADMIN = "caseworker-deedpoll-admin";

/**
 * The judicial role, for the judge who works the shared referral pool.
 *
 * **Not a variety of caseworker, and not a higher grade of one.** It reaches a separate api surface
 * (`/judicial/**`), keyed on the referral rather than the case, returning a deliberately narrower view of
 * an application than any caseworker sees — so the two roles are alternatives, not a ladder. A judge holds
 * none of the admin role's privileges and an admin holds none of the judge's.
 *
 * The string is the authority for both ends: api's gate is `Role.JUDICIAL("caseworker-deedpoll-judicial")`
 * and IDAM provisions the same name (`idam-access-config#995`). Import it rather than restating it —
 * `scripts/seed-idam-users.mjs` records what a copied role string cost the last time one drifted.
 */
export const DEEDPOLL_JUDICIAL = "caseworker-deedpoll-judicial";

/** Ordinary caseworkers: CCD document READ, without admin or judicial privileges. */
export const DEEDPOLL_CASEWORKER = "caseworker-deedpoll";

export const DEEDPOLL_TEAM_LEADER = "caseworker-deedpoll-team-leader";
export const DEEDPOLL_DELIVERY_MANAGER = "caseworker-deedpoll-delivery-manager";

/** All roles a request may carry. Extend as further roles are modelled. */
export type Role =
  | typeof DEEDPOLL_TEAM_LEADER
  | typeof DEEDPOLL_DELIVERY_MANAGER
  | typeof DEEDPOLL_CASEWORKER
  | typeof DEEDPOLL_ADMIN
  | typeof DEEDPOLL_JUDICIAL;
