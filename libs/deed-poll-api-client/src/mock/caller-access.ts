/**
 * What each deed-poll role admits and grants, restated from api's `StaffArea` and `RoleCapabilities`.
 *
 * One table so that `GET /me` and the mock's Gazette and process-settings gates cannot disagree, exactly as api computes both from
 * the same rule. `caller-access.test.ts` pins its capability names against `CallerAccessResponse`'s enum, so a
 * capability api adds fails there until this table knows about it.
 */
import { CAPABILITY, type WireCallerAccess } from "../api/wire.js";

// api F1 grants `ALLOCATE_REFERRALS` with the legacy admin's set, so the Team leader and the Delivery Manager hold it too.
const LEGACY_ADMIN: readonly Capability[] = ["OVERRIDE_PRIVACY", "DELETE_NOTE", "DELETE_WITNESS", "MANAGE_SHARED_QUERIES", "REPAIR_CCD", "ALLOCATE_REFERRALS"];
// api's Team leader is the legacy admin plus management information, which the Delivery Manager inherits.
const TEAM_LEADER: readonly Capability[] = [...LEGACY_ADMIN, "VIEW_MANAGEMENT_INFORMATION"];

export const ROLE_ACCESS: Readonly<Record<string, RoleAccess>> = {
  "caseworker-deedpoll": { area: "staff", capabilities: [] },
  "caseworker-deedpoll-team-leader": { area: "staff", capabilities: TEAM_LEADER },
  "caseworker-deedpoll-delivery-manager": { area: "staff", capabilities: [...TEAM_LEADER, "ACCESS_GAZETTE", "MANAGE_PROCESS_CONFIG"] },
  // Migration-only at api: the casework grants and the queue, never the Gazette or management information.
  "caseworker-deedpoll-admin": { area: "staff", capabilities: LEGACY_ADMIN },
  "caseworker-deedpoll-judicial": { area: "judicial", capabilities: [] }
};

/** The answer for a token's roles. Unknown or malformed roles grant nothing, as api's unmapped roles do. */
export function callerAccess(claims: { roles?: unknown }): WireCallerAccess {
  const roles = Array.isArray(claims.roles) ? claims.roles.filter((role): role is string => typeof role === "string" && Object.hasOwn(ROLE_ACCESS, role)) : [];
  const grants = roles.map((role) => ROLE_ACCESS[role]);

  return {
    staff: grants.some((grant) => grant.area === "staff"),
    judicial: grants.some((grant) => grant.area === "judicial"),
    // Declaration order and no duplicates, as api promises.
    capabilities: CAPABILITY.filter((capability) => grants.some((grant) => grant.capabilities.includes(capability)))
  };
}

type Capability = (typeof CAPABILITY)[number];

interface RoleAccess {
  area: "staff" | "judicial";
  capabilities: readonly Capability[];
}
