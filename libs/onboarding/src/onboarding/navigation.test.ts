import { describe, it, expect } from "vitest";
import {
  getPreviousPage,
  getNextPage,
  getChangePageRoute,
  hasBackLink,
  formatDateForDisplay,
  formatAddressForDisplay,
  formatRoleForDisplay,
  getMonthName
} from "./navigation.js";

describe("navigation helpers", () => {
  describe("getPreviousPage", () => {
    it("should return previous page in flow", () => {
      expect(getPreviousPage("name")).toBe("/onboarding/start");
      expect(getPreviousPage("date-of-birth")).toBe("/onboarding/name");
      expect(getPreviousPage("address")).toBe("/onboarding/date-of-birth");
      expect(getPreviousPage("role")).toBe("/onboarding/address");
      expect(getPreviousPage("summary")).toBe("/onboarding/role");
    });

    it("should return null for start page", () => {
      expect(getPreviousPage("start")).toBeNull();
    });
  });

  describe("getNextPage", () => {
    it("should return next page in flow", () => {
      expect(getNextPage("start")).toBe("/onboarding/name");
      expect(getNextPage("name")).toBe("/onboarding/date-of-birth");
      expect(getNextPage("date-of-birth")).toBe("/onboarding/address");
      expect(getNextPage("address")).toBe("/onboarding/role");
      expect(getNextPage("role")).toBe("/onboarding/summary");
      expect(getNextPage("summary")).toBe("/onboarding/confirmation");
    });
  });

  describe("getChangePageRoute", () => {
    it("should return correct change page routes", () => {
      expect(getChangePageRoute("name")).toBe("/onboarding/name");
      expect(getChangePageRoute("dateOfBirth")).toBe("/onboarding/date-of-birth");
      expect(getChangePageRoute("address")).toBe("/onboarding/address");
      expect(getChangePageRoute("role")).toBe("/onboarding/role");
    });

    it("should return start page for unknown field", () => {
      expect(getChangePageRoute("unknown")).toBe("/onboarding/start");
    });
  });

  describe("hasBackLink", () => {
    it("should return true for pages with back links", () => {
      expect(hasBackLink("name")).toBe(true);
      expect(hasBackLink("date-of-birth")).toBe(true);
      expect(hasBackLink("address")).toBe(true);
      expect(hasBackLink("role")).toBe(true);
      expect(hasBackLink("summary")).toBe(true);
    });

    it("should return false for pages without back links", () => {
      expect(hasBackLink("start")).toBe(false);
      expect(hasBackLink("confirmation")).toBe(false);
    });
  });

  describe("formatDateForDisplay", () => {
    it("should format date correctly", () => {
      const dateData = { day: 15, month: 6, year: 1990 };
      expect(formatDateForDisplay(dateData)).toBe("15 June 1990");
    });

    it("should handle single digit day and month", () => {
      const dateData = { day: 1, month: 1, year: 2000 };
      expect(formatDateForDisplay(dateData)).toBe("1 January 2000");
    });
  });

  describe("getMonthName", () => {
    it("should return correct month names", () => {
      expect(getMonthName(1)).toBe("January");
      expect(getMonthName(6)).toBe("June");
      expect(getMonthName(12)).toBe("December");
    });

    it("should return empty string for invalid month", () => {
      expect(getMonthName(0)).toBe("");
      expect(getMonthName(13)).toBe("");
    });
  });

  describe("formatAddressForDisplay", () => {
    it("should format complete address", () => {
      const address = {
        addressLine1: "123 Main Street",
        addressLine2: "Flat 2",
        town: "London",
        postcode: "SW1A 1AA"
      };

      const result = formatAddressForDisplay(address);
      expect(result).toEqual(["123 Main Street", "Flat 2", "London", "SW1A 1AA"]);
    });

    it("should format address without line 2", () => {
      const address = {
        addressLine1: "123 Main Street",
        town: "London",
        postcode: "SW1A 1AA"
      };

      const result = formatAddressForDisplay(address);
      expect(result).toEqual(["123 Main Street", "London", "SW1A 1AA"]);
    });
  });

  describe("formatRoleForDisplay", () => {
    it("should format predefined roles", () => {
      expect(formatRoleForDisplay({ roleType: "frontend-developer" })).toBe("Frontend Developer");
      expect(formatRoleForDisplay({ roleType: "backend-developer" })).toBe("Backend Developer");
      expect(formatRoleForDisplay({ roleType: "test-engineer" })).toBe("Test Engineer");
    });

    it("should format other role", () => {
      const role = { roleType: "other", roleOther: "Product Manager" };
      expect(formatRoleForDisplay(role)).toBe("Product Manager");
    });

    it("should handle other role without specification", () => {
      const role = { roleType: "other" };
      expect(formatRoleForDisplay(role)).toBe("Other");
    });

    it("should fall back to roleType for unknown role", () => {
      const role = { roleType: "unknown-role" };
      expect(formatRoleForDisplay(role as any)).toBe("unknown-role");
    });
  });
});
