import { describe, expect, it } from "vitest";
import { canDeleteWitness } from "./delete-policy.js";

describe("witnesses/delete-policy", () => {
  describe("canDeleteWitness", () => {
    it("should allow deletion when the user is an administrator", () => {
      expect(canDeleteWitness({ isAdmin: true })).toBe(true);
    });

    it("should refuse deletion when the user is a caseworker with no admin role", () => {
      expect(canDeleteWitness({ isAdmin: false })).toBe(false);
    });
  });
});
