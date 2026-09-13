/**
 * Who may delete a witness.
 *
 * **api enforces this; this is the presentation mirror.** `deed-poll-api`'s
 * `docs/plans/witness-delete.md` restricts `DELETE /caseworker/cases/{id}/witnesses/{witnessId}` to
 * Administrators — `WitnessService.removeWitness` calls `requireAnyRole(DEEDPOLL_ADMIN)` before it
 * resolves the witness, so a forged request gets a 403 whether or not the witness exists. Nothing here
 * is a control.
 *
 * It exists so the amend form does not offer a caseworker a button whose only outcome is a `forbidden`.
 *
 * A named rule rather than an `if (isAdmin)` in the page, for the same reason `canDeleteNote` is one: it
 * is the single seam that moves when the role/capability refactor (api's
 * `docs/plans/role-model-generalisation.md`) replaces the one admin flag with capabilities.
 */

export function canDeleteWitness(user: WitnessDeletePermission): boolean {
  return user.isAdmin;
}

/** What this rule reads — a subset of `CurrentUser`, so a caller passes the one it already has. */
export interface WitnessDeletePermission {
  isAdmin: boolean;
}
