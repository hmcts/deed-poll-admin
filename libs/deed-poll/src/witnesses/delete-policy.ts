import { can, DELETE_WITNESS } from "../auth/capabilities.js";
import type { CurrentUser } from "../auth/current-user.js";

/** Presentation mirror; the API independently enforces the capability from the token. */
export function canDeleteWitness(user: WitnessDeletePermission): boolean {
  return can(user, DELETE_WITNESS);
}

export type WitnessDeletePermission = Pick<CurrentUser, "capabilities">;
