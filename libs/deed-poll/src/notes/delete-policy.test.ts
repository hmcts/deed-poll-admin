import { describe, expect, it } from "vitest";
import { canDeleteNote } from "./delete-policy.js";

describe("notes/delete-policy", () => {
  describe("canDeleteNote", () => {
    it("should allow deletion when the user is an administrator", () => {
      expect(canDeleteNote({ isAdmin: true })).toBe(true);
    });

    it("should refuse deletion when the user is a caseworker with no admin role", () => {
      expect(canDeleteNote({ isAdmin: false })).toBe(false);
    });
  });
});
