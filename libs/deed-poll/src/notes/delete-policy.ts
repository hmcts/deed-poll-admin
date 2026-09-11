/**
 * Who may delete a note.
 *
 * **api enforces this; this is the presentation mirror.** `deed-poll-api`'s
 * `docs/plans/gate-note-deletion.md` restricts `DELETE /caseworker/cases/{id}/notes/{noteId}` to
 * Administrators, per the business document's split of Basic User ("cannot delete notes") from
 * Administrator. Nothing here is a control: a forged POST still reaches api and api still refuses it.
 *
 * It exists so the amend form does not offer a caseworker a button whose only outcome is a
 * `forbidden` — which this app renders as 403 on the 404 template, so a correctly-enforced rule would
 * read to the caseworker as the note having gone missing.
 *
 * A named rule rather than an `if (isAdmin)` in the page, for the same reason `privacyEditable` is one:
 * it is the single seam that moves when the role/capability refactor
 * (api's `docs/plans/role-model-generalisation.md`) replaces the one admin flag with capabilities.
 */

export function canDeleteNote(user: NoteDeletePermission): boolean {
  return user.isAdmin;
}

/** What this rule reads — a subset of `CurrentUser`, so a caller passes the one it already has. */
export interface NoteDeletePermission {
  isAdmin: boolean;
}
