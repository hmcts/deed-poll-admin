import { describe, expect, it } from "vitest";
import { ACCESS_GAZETTE, can, capabilitiesFor, DELETE_NOTE, DELETE_WITNESS, MANAGE_SHARED_QUERIES, OVERRIDE_PRIVACY, REPAIR_CCD } from "./capabilities.js";
import { userFromClaims } from "./idam-claims.js";
import { DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER } from "./roles.js";

const CASEWORK = [OVERRIDE_PRIVACY, DELETE_NOTE, DELETE_WITNESS, MANAGE_SHARED_QUERIES, REPAIR_CCD];
const MATRIX = [
  { roles: [DEEDPOLL_TEAM_LEADER], expected: CASEWORK },
  { roles: [DEEDPOLL_DELIVERY_MANAGER], expected: [...CASEWORK, ACCESS_GAZETTE] },
  { roles: [DEEDPOLL_ADMIN], expected: CASEWORK },
  { roles: [DEEDPOLL_CASEWORKER], expected: [] },
  { roles: [DEEDPOLL_JUDICIAL], expected: [] },
  { roles: [], expected: [] },
  { roles: ["unknown"], expected: [] },
  { roles: [DEEDPOLL_TEAM_LEADER, DEEDPOLL_JUDICIAL], expected: CASEWORK },
  { roles: [DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL], expected: [...CASEWORK, ACCESS_GAZETTE] },
  { roles: [DEEDPOLL_ADMIN, DEEDPOLL_DELIVERY_MANAGER], expected: [...CASEWORK, ACCESS_GAZETTE] },
  { roles: [DEEDPOLL_TEAM_LEADER, DEEDPOLL_TEAM_LEADER, "unknown"], expected: CASEWORK }
];

describe("staff capability contract", () => {
  it.each(MATRIX)("should resolve $roles without implied judicial powers", ({ roles, expected }) => {
    const user = userFromClaims({ roles, name: "Staff member" });
    expect(capabilitiesFor(user.roles)).toEqual(expected);
    expect(user.isAdmin).toBe(expected.includes(OVERRIDE_PRIVACY));
    expect(user.isJudicial).toBe(roles.includes(DEEDPOLL_JUDICIAL));
    expect(can(user, ACCESS_GAZETTE)).toBe(expected.includes(ACCESS_GAZETTE));
    expect(JSON.parse(JSON.stringify(user))).toEqual(user);
    expect(user).not.toHaveProperty("capabilities");
  });

  it("should not allow a caller to mutate another caller's grants", () => {
    expect(Object.isFrozen(capabilitiesFor([DEEDPOLL_TEAM_LEADER]))).toBe(true);
    expect(Object.isFrozen(capabilitiesFor([DEEDPOLL_DELIVERY_MANAGER]))).toBe(true);
  });
});
