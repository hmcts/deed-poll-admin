import { describe, expect, it } from "vitest";
import { currentUser } from "../auth/current-user.js";
import { DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER } from "../auth/roles.js";
import { canDeleteNote } from "./delete-policy.js";

describe("notes deletion", () => {
  it.each([DEEDPOLL_TEAM_LEADER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_ADMIN])("should allow %s", (role) => {
    expect(canDeleteNote(currentUser([role]))).toBe(true);
  });
  it.each([DEEDPOLL_CASEWORKER, DEEDPOLL_JUDICIAL])("should refuse %s despite a stale privilege flag", (role) => {
    expect(canDeleteNote({ ...currentUser([role]), isAdmin: true })).toBe(false);
  });
});
