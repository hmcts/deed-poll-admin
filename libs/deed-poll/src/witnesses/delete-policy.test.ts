import { describe, expect, it } from "vitest";
import { ACCESS_GAZETTE, DELETE_WITNESS, OVERRIDE_PRIVACY } from "../auth/capabilities.js";
import { currentUser } from "../auth/current-user.js";
import { canDeleteWitness } from "./delete-policy.js";

describe("witnesses deletion", () => {
  it("should allow a caller api grants DELETE_WITNESS", () => {
    expect(canDeleteWitness(currentUser({ staff: true, judicial: false, capabilities: [DELETE_WITNESS] }))).toBe(true);
  });

  it("should refuse a caller without DELETE_WITNESS despite a stale privilege flag", () => {
    const stale = { ...currentUser({ staff: true, judicial: true, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE] }), isAdmin: true };

    expect(canDeleteWitness(stale)).toBe(false);
  });
});
