import { describe, expect, it } from "vitest";
import { govukErrorSummaryFilter } from "./error-summary.js";

describe("govukErrorSummaryFilter", () => {
  it("should transform errors object to error summary format", () => {
    const errors = {
      name: "Name is required",
      email: "Email is invalid"
    };

    const result = govukErrorSummaryFilter(errors);

    expect(result).toEqual([
      { text: "Name is required", href: "#name" },
      { text: "Email is invalid", href: "#email" }
    ]);
  });

  it("should handle single error", () => {
    const errors = {
      password: "Password must be at least 8 characters"
    };

    const result = govukErrorSummaryFilter(errors);

    expect(result).toEqual([{ text: "Password must be at least 8 characters", href: "#password" }]);
  });

  it("should return null for empty errors object", () => {
    expect(govukErrorSummaryFilter({})).toBeNull();
  });

  it("should return null for null errors", () => {
    expect(govukErrorSummaryFilter(null as unknown as Record<string, string>)).toBeNull();
  });

  it("should return null for undefined errors", () => {
    expect(govukErrorSummaryFilter(undefined as unknown as Record<string, string>)).toBeNull();
  });

  it("should handle field names with special characters", () => {
    const errors = {
      "user.email": "Email is required",
      "address[postcode]": "Postcode is invalid"
    };

    const result = govukErrorSummaryFilter(errors);

    expect(result).toEqual([
      { text: "Email is required", href: "#user.email" },
      { text: "Postcode is invalid", href: "#address[postcode]" }
    ]);
  });

  it("should preserve order of errors", () => {
    const errors = {
      firstName: "First name is required",
      lastName: "Last name is required",
      email: "Email is required",
      phone: "Phone is required"
    };

    const result = govukErrorSummaryFilter(errors);

    expect(result).toHaveLength(4);
    expect(result?.[0]).toEqual({ text: "First name is required", href: "#firstName" });
    expect(result?.[1]).toEqual({ text: "Last name is required", href: "#lastName" });
    expect(result?.[2]).toEqual({ text: "Email is required", href: "#email" });
    expect(result?.[3]).toEqual({ text: "Phone is required", href: "#phone" });
  });
});
