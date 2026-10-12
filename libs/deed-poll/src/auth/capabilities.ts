import { DEEDPOLL_ADMIN, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_TEAM_LEADER } from "./roles.js";

export const OVERRIDE_PRIVACY = "OVERRIDE_PRIVACY";
export const DELETE_NOTE = "DELETE_NOTE";
export const DELETE_WITNESS = "DELETE_WITNESS";
export const MANAGE_SHARED_QUERIES = "MANAGE_SHARED_QUERIES";
export const REPAIR_CCD = "REPAIR_CCD";
export const ACCESS_GAZETTE = "ACCESS_GAZETTE";

const TEAM_LEADER_CAPABILITIES: readonly Capability[] = Object.freeze([OVERRIDE_PRIVACY, DELETE_NOTE, DELETE_WITNESS, MANAGE_SHARED_QUERIES, REPAIR_CCD]);
const DELIVERY_MANAGER_CAPABILITIES: readonly Capability[] = Object.freeze([...TEAM_LEADER_CAPABILITIES, ACCESS_GAZETTE]);

/** Derived on use from recognised roles; never persist capabilities in a session. */
export function capabilitiesFor(roles: readonly string[]): readonly Capability[] {
  if (roles.includes(DEEDPOLL_DELIVERY_MANAGER)) return DELIVERY_MANAGER_CAPABILITIES;
  if (roles.includes(DEEDPOLL_TEAM_LEADER) || roles.includes(DEEDPOLL_ADMIN)) return TEAM_LEADER_CAPABILITIES;
  return [];
}

export function can(user: { readonly roles: readonly string[] }, capability: Capability): boolean {
  return capabilitiesFor(user.roles).includes(capability);
}

export type Capability =
  | typeof OVERRIDE_PRIVACY
  | typeof DELETE_NOTE
  | typeof DELETE_WITNESS
  | typeof MANAGE_SHARED_QUERIES
  | typeof REPAIR_CCD
  | typeof ACCESS_GAZETTE;
