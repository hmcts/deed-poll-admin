/**
 * What each deed-poll role admits and grants, restated from api's `StaffArea` and `RoleCapabilities`.
 *
 * One table so that `GET /me` and the mock's Gazette gate cannot disagree, exactly as api computes both from
 * the same rule. `caller-access.test.ts` pins its capability names against `CallerAccessResponse`'s enum, so a
 * capability api adds fails there until this table knows about it.
 */
import { CAPABILITY, type WireCallerAccess } from "../api/wire.js";

const TEAM_LEADER: readonly Capability[] = ["OVERRIDE_PRIVACY", "DELETE_NOTE", "DELETE_WITNESS", "MANAGE_SHARED_QUERIES", "REPAIR_CCD"];

export const ROLE_ACCESS: Readonly<Record<string, RoleAccess>> = {
  "caseworker-deedpoll": { area: "staff", capabilities: [] },
  "caseworker-deedpoll-team-leader": { area: "staff", capabilities: TEAM_LEADER },
  "caseworker-deedpoll-delivery-manager": { area: "staff", capabilities: [...TEAM_LEADER, "ACCESS_GAZETTE"] },
  // Migration-only at api: Team leader's grants, never the Gazette.
  "caseworker-deedpoll-admin": { area: "staff", capabilities: TEAM_LEADER },
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
