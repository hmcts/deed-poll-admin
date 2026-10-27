import { CAPABILITY, type Capability } from "@hmcts/deed-poll-api-client";

export const OVERRIDE_PRIVACY: Capability = "OVERRIDE_PRIVACY";
export const DELETE_NOTE: Capability = "DELETE_NOTE";
export const DELETE_WITNESS: Capability = "DELETE_WITNESS";
export const MANAGE_SHARED_QUERIES: Capability = "MANAGE_SHARED_QUERIES";
export const REPAIR_CCD: Capability = "REPAIR_CCD";
export const ACCESS_GAZETTE: Capability = "ACCESS_GAZETTE";
export const MANAGE_PROCESS_CONFIG: Capability = "MANAGE_PROCESS_CONFIG";

/** No staff area, no judicial area, no capabilities: what every missing or malformed answer reads as. */
export const NO_ACCESS: CallerAccess = Object.freeze({ staff: false, judicial: false, capabilities: Object.freeze([]) });

/**
 * api's `GET /me` answer, checked again wherever it is read rather than trusted because it was once valid.
 *
 * It lives in a session that can outlast a deploy, so a stored value may predate the shape or name a capability
 * this build does not know. An unknown capability is dropped; anything else out of shape is no access at all.
 * Kept in api's declaration order without duplicates, as api promises.
 */
export function callerAccessFrom(raw: unknown): CallerAccess {
  if (!holdsCallerAccess(raw)) return NO_ACCESS;
  const { staff, judicial, capabilities } = raw;

  return { staff, judicial, capabilities: CAPABILITY.filter((capability) => capabilities.includes(capability)) };
}

/**
 * Whether a stored value is shaped like a `/me` answer at all, unknown capability names allowed.
 *
 * The difference between "api said no access" and "api has not been asked", which `callerAccessFrom` reads alike:
 * a session saved before this shape existed is the second, and is asked rather than left with nothing.
 */
export function holdsCallerAccess(raw: unknown): raw is { staff: boolean; judicial: boolean; capabilities: unknown[] } {
  if (typeof raw !== "object" || raw === null) return false;
  const { staff, judicial, capabilities } = raw as Record<string, unknown>;
  return typeof staff === "boolean" && typeof judicial === "boolean" && Array.isArray(capabilities);
}

/** The UI policy entry point. api enforces the same capability from the token, so this decides chrome, not data. */
export function can(user: Pick<CallerAccess, "capabilities">, capability: Capability): boolean {
  return user.capabilities.includes(capability);
}

/** Which areas api admits the caller to, for a staff block built on it (OWASP plan 01 Tasks 6–8). */
export function staffAccess(user: Pick<CallerAccess, "staff" | "judicial">): StaffAccess {
  return { staff: user.staff, judicial: user.judicial };
}

export type { Capability };

export interface CallerAccess {
  staff: boolean;
  judicial: boolean;
  capabilities: readonly Capability[];
}

export interface StaffAccess {
  staff: boolean;
  judicial: boolean;
}
