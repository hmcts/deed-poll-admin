import { describe, expect, it } from "vitest";
import { currencyFilter } from "./currency.js";

describe("currencyFilter", () => {
  it("should format positive numbers as GBP currency", () => {
    expect(currencyFilter(100)).toBe("£100.00");
    expect(currencyFilter(1234.56)).toBe("£1,234.56");
    expect(currencyFilter(0.99)).toBe("£0.99");
  });

  it("should format negative numbers as GBP currency", () => {
    expect(currencyFilter(-100)).toBe("-£100.00");
    expect(currencyFilter(-1234.56)).toBe("-£1,234.56");
  });

  it("should format zero as GBP currency", () => {
    expect(currencyFilter(0)).toBe("£0.00");
  });

  it("should handle large numbers", () => {
    expect(currencyFilter(1000000)).toBe("£1,000,000.00");
    expect(currencyFilter(1234567.89)).toBe("£1,234,567.89");
  });

  it("should return empty string for non-number values", () => {
    expect(currencyFilter("test" as unknown as number)).toBe("");
    expect(currencyFilter(null as unknown as number)).toBe("");
    expect(currencyFilter(undefined as unknown as number)).toBe("");
    expect(currencyFilter({} as unknown as number)).toBe("");
  });
});
