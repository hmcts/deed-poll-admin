import { can, DELETE_NOTE } from "../auth/capabilities.js";
import type { CurrentUser } from "../auth/current-user.js";

/** Presentation mirror; the API independently enforces the capability from the token. */
export function canDeleteNote(user: NoteDeletePermission): boolean {
  return can(user, DELETE_NOTE);
}

export type NoteDeletePermission = Pick<CurrentUser, "roles">;
