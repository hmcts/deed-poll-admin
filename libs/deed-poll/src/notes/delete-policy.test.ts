import { describe, expect, it } from "vitest";
import { ACCESS_GAZETTE, DELETE_NOTE, OVERRIDE_PRIVACY } from "../auth/capabilities.js";
import { currentUser } from "../auth/current-user.js";
import { canDeleteNote } from "./delete-policy.js";

describe("notes deletion", () => {
  it("should allow a caller api grants DELETE_NOTE", () => {
    expect(canDeleteNote(currentUser({ staff: true, judicial: false, capabilities: [DELETE_NOTE] }))).toBe(true);
  });

  it("should refuse a caller without DELETE_NOTE despite a stale privilege flag", () => {
    const stale = { ...currentUser({ staff: true, judicial: true, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE] }), isAdmin: true };

    expect(canDeleteNote(stale)).toBe(false);
  });
});
