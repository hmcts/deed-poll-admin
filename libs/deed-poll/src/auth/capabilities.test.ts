import { CAPABILITY } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import {
  ACCESS_GAZETTE,
  callerAccessFrom,
  can,
  DELETE_NOTE,
  DELETE_WITNESS,
  holdsCallerAccess,
  MANAGE_SHARED_QUERIES,
  NO_ACCESS,
  OVERRIDE_PRIVACY,
  REPAIR_CCD,
  staffAccess
} from "./capabilities.js";
import { currentUser } from "./current-user.js";

const CASEWORK = [OVERRIDE_PRIVACY, DELETE_NOTE, DELETE_WITNESS, MANAGE_SHARED_QUERIES, REPAIR_CCD];

// What api's `GET /me` answers for each persona, restated from its RoleCapabilities.
const PERSONAS = [
  { persona: "Team leader", access: { staff: true, judicial: false, capabilities: CASEWORK } },
  { persona: "Delivery Manager", access: { staff: true, judicial: false, capabilities: [...CASEWORK, ACCESS_GAZETTE] } },
  { persona: "legacy admin", access: { staff: true, judicial: false, capabilities: CASEWORK } },
  { persona: "caseworker", access: { staff: true, judicial: false, capabilities: [] } },
  { persona: "judge", access: { staff: false, judicial: true, capabilities: [] } },
  { persona: "no-role caller", access: { staff: false, judicial: false, capabilities: [] } }
];

describe("staff capability contract", () => {
  it.each(PERSONAS)("should decide every capability for a $persona from the stored answer alone", ({ access }) => {
    const user = currentUser(access, "Staff member");

    for (const capability of CAPABILITY) expect(can(user, capability), capability).toBe(access.capabilities.includes(capability));
    expect(user.isAdmin).toBe(access.capabilities.includes(OVERRIDE_PRIVACY));
    expect(user.isJudicial).toBe(access.judicial);
    expect(staffAccess(user)).toEqual({ staff: access.staff, judicial: access.judicial });
    expect(JSON.parse(JSON.stringify(user))).toEqual(user);
    expect(user).not.toHaveProperty("roles");
  });

  it("should name every capability api publishes, so a gate cannot key on a string api never sends", () => {
    expect([...CASEWORK, ACCESS_GAZETTE]).toEqual([...CAPABILITY]);
  });
});

describe("callerAccessFrom", () => {
  it("should drop a capability this build does not know and keep the rest", () => {
    expect(callerAccessFrom({ staff: true, judicial: false, capabilities: ["MANAGE_USERS", DELETE_NOTE, 7, null] })).toEqual({
      staff: true,
      judicial: false,
      capabilities: [DELETE_NOTE]
    });
  });

  it("should put capabilities in api's declaration order without duplicates", () => {
    expect(callerAccessFrom({ staff: true, judicial: false, capabilities: [ACCESS_GAZETTE, OVERRIDE_PRIVACY, ACCESS_GAZETTE] }).capabilities).toEqual([
      OVERRIDE_PRIVACY,
      ACCESS_GAZETTE
    ]);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a string", "staff"],
    ["a roles-era stored user", { roles: ["caseworker-deedpoll-delivery-manager"], isAdmin: true, isJudicial: true, name: "A" }],
    ["staff not a boolean", { staff: "true", judicial: false, capabilities: [ACCESS_GAZETTE] }],
    ["judicial missing", { staff: true, capabilities: [ACCESS_GAZETTE] }],
    ["capabilities not an array", { staff: true, judicial: true, capabilities: ACCESS_GAZETTE }]
  ])("should fail closed to no access when the answer is %s", (_label, raw) => {
    expect(callerAccessFrom(raw)).toEqual(NO_ACCESS);
    expect(currentUser(raw)).toMatchObject({ staff: false, judicial: false, capabilities: [], isAdmin: false, isJudicial: false });
    expect(holdsCallerAccess(raw)).toBe(false);
  });

  it("should tell an answer of no access apart from no answer, so only the second is asked for again", () => {
    expect(holdsCallerAccess({ staff: false, judicial: false, capabilities: [] })).toBe(true);
    expect(holdsCallerAccess({ staff: true, judicial: false, capabilities: ["MANAGE_USERS"] })).toBe(true);
  });

  it("should not let one caller's answer alter another's", () => {
    expect(Object.isFrozen(NO_ACCESS)).toBe(true);
    expect(Object.isFrozen(NO_ACCESS.capabilities)).toBe(true);
  });
});
