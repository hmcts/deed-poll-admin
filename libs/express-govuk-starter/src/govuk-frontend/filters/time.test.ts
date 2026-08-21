import { describe, expect, it } from "vitest";
import { timeFilter } from "./time.js";

describe("timeFilter", () => {
  it("should format time in 24-hour format", () => {
    const date = new Date("2024-03-15T14:30:00");
    expect(timeFilter(date)).toBe("14:30");
  });

  it("should format morning times correctly", () => {
    const date = new Date("2024-03-15T09:05:00");
    expect(timeFilter(date)).toBe("09:05");
  });

  it("should format midnight correctly", () => {
    const date = new Date("2024-03-15T00:00:00");
    expect(timeFilter(date)).toBe("00:00");
  });

  it("should format noon correctly", () => {
    const date = new Date("2024-03-15T12:00:00");
    expect(timeFilter(date)).toBe("12:00");
  });

  it("should handle string dates", () => {
    expect(timeFilter("2024-03-15T14:30:00")).toBe("14:30");
    expect(timeFilter("2024-03-15T09:05:00")).toBe("09:05");
  });

  it("should handle ISO date strings with timezone", () => {
    const date = "2024-03-15T14:30:00Z";
    const result = timeFilter(date);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("should return empty string for invalid values", () => {
    expect(timeFilter(null as unknown as Date)).toBe("");
    expect(timeFilter(undefined as unknown as Date)).toBe("");
    expect(timeFilter("")).toBe("");
  });

  it("should format single digit hours and minutes with leading zeros", () => {
    const date = new Date("2024-03-15T01:01:00");
    expect(timeFilter(date)).toBe("01:01");
  });

  it("should handle late evening times", () => {
    const date = new Date("2024-03-15T23:59:00");
    expect(timeFilter(date)).toBe("23:59");
  });
});
