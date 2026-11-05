import { describe, expect, it } from "vitest";
import { parseMiFilters } from "./filters.js";

// 09:30 on 4 November 2026 in London, which is GMT then.
const NOW = new Date("2026-11-04T09:30:00Z");

describe("management-information/filters", () => {
  describe("parseMiFilters", () => {
    it("should read the last 30 days weekly with migrated cases when nothing is chosen", () => {
      const filters = parseMiFilters({}, NOW);

      expect(filters.errors).toEqual([]);
      expect(filters.query).toEqual({ from: "2026-10-06", to: "2026-11-04", granularity: "WEEK", includeMigrated: true });
      expect(filters.values).toEqual({ period: "30-days", from: "", to: "", granularity: "", includeMigrated: "true" });
    });

    it.each([
      ["7-days", "2026-10-29", "WEEK"],
      ["60-days", "2026-09-06", "WEEK"],
      ["90-days", "2026-08-07", "WEEK"],
      ["year", "2025-11-05", "MONTH"]
    ])("should read the %s preset as ending today, with its own granularity", (period, from, granularity) => {
      const filters = parseMiFilters({ period }, NOW);

      expect(filters.query).toEqual({ from, to: "2026-11-04", granularity, includeMigrated: true });
    });

    it("should take today in London, not in UTC, just after midnight in summer time", () => {
      const filters = parseMiFilters({ period: "7-days" }, new Date("2026-06-30T23:30:00Z"));

      expect(filters.query).toMatchObject({ from: "2026-06-25", to: "2026-07-01" });
    });

    it("should use a granularity that was chosen over the period's own", () => {
      const filters = parseMiFilters({ period: "year", granularity: "QUARTER" }, NOW);

      expect(filters.query?.granularity).toBe("QUARTER");
      expect(filters.values.granularity).toBe("QUARTER");
    });

    it("should ignore the range controls for a preset", () => {
      const filters = parseMiFilters({ period: "7-days", from: "nonsense", to: "" }, NOW);

      expect(filters.errors).toEqual([]);
      expect(filters.query).toMatchObject({ from: "2026-10-29", to: "2026-11-04" });
      expect(filters.values).toMatchObject({ from: "nonsense", to: "" });
    });

    it("should read a custom range, weekly up to 90 days and monthly beyond", () => {
      const short = parseMiFilters({ period: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
      const long = parseMiFilters({ period: "custom", from: "2026-01-01", to: "2026-04-01" }, NOW);

      expect(short.query).toEqual({ from: "2026-01-01", to: "2026-03-31", granularity: "WEEK", includeMigrated: true });
      expect(long.query?.granularity).toBe("MONTH");
    });

    it("should leave migrated cases out when asked to", () => {
      const filters = parseMiFilters({ includeMigrated: "false" }, NOW);

      expect(filters.query?.includeMigrated).toBe(false);
      expect(filters.values.includeMigrated).toBe("false");
    });

    it("should refuse a custom range with neither day, in api's words, in the form's order", () => {
      const filters = parseMiFilters({ period: "custom", from: " ", to: "" }, NOW);

      expect(filters.query).toBeNull();
      expect(filters.errors).toEqual([
        { field: "from", message: "Enter the first day of the range." },
        { field: "to", message: "Enter the last day of the range." }
      ]);
    });

    it.each(["01/10/2026", "2026-02-30", "2026-13-01", "0000-01-01", "2026-1-01"])("should refuse %s as a malformed first day", (from) => {
      const filters = parseMiFilters({ period: "custom", from, to: "2026-11-01" }, NOW);

      expect(filters.errors).toEqual([{ field: "from", message: "Enter the first day of the range as yyyy-MM-dd." }]);
    });

    it("should accept 29 February in a leap year", () => {
      expect(parseMiFilters({ period: "custom", from: "2028-02-29", to: "2028-03-01" }, NOW).errors).toEqual([]);
    });

    it("should refuse a last day before the first", () => {
      const filters = parseMiFilters({ period: "custom", from: "2026-10-02", to: "2026-10-01" }, NOW);

      expect(filters.errors).toEqual([{ field: "to", message: "The last day of the range cannot be before the first." }]);
    });

    it("should allow exactly two years and refuse a day more", () => {
      expect(parseMiFilters({ period: "custom", from: "2024-11-04", to: "2026-11-04" }, NOW).errors).toEqual([]);
      expect(parseMiFilters({ period: "custom", from: "2024-11-04", to: "2026-11-05" }, NOW).errors).toEqual([
        { field: "to", message: "The range cannot be longer than 2 years." }
      ]);
    });

    it("should allow a short range in 9998, whose two-year limit falls in a five-digit year", () => {
      expect(parseMiFilters({ period: "custom", from: "9998-01-01", to: "9998-01-02" }, NOW).errors).toEqual([]);
      expect(parseMiFilters({ period: "custom", from: "9999-01-01", to: "9999-12-31" }, NOW).errors).toEqual([]);
    });

    it("should end two years from 29 February on the 28th, as api's plusYears does", () => {
      expect(parseMiFilters({ period: "custom", from: "2024-02-29", to: "2026-02-28" }, NOW).errors).toEqual([]);
      expect(parseMiFilters({ period: "custom", from: "2024-02-29", to: "2026-03-01" }, NOW).errors).toEqual([
        { field: "to", message: "The range cannot be longer than 2 years." }
      ]);
    });

    it("should start the last year on 1 March when today is 29 February", () => {
      const filters = parseMiFilters({ period: "year" }, new Date("2028-02-29T12:00:00Z"));

      expect(filters.query).toMatchObject({ from: "2027-03-01", to: "2028-02-29" });
    });

    it("should refuse a period, granularity or migrated answer the form does not offer", () => {
      const filters = parseMiFilters({ period: "forever", granularity: "DAY", includeMigrated: "yes" }, NOW);

      expect(filters.query).toBeNull();
      expect(filters.errors.map((error) => error.field)).toEqual(["period", "granularity", "includeMigrated"]);
      expect(filters.errors[1].message).toBe("Choose WEEK, MONTH or QUARTER.");
    });

    it("should refuse a repeated control rather than read its first value", () => {
      const filters = parseMiFilters(
        { period: ["custom", "custom"], from: ["2026-10-01"], to: "2026-10-02", granularity: ["WEEK", "MONTH"], includeMigrated: ["true", "false"] },
        NOW
      );

      expect(filters.errors.map((error) => error.field)).toEqual(["period", "granularity", "includeMigrated"]);
      expect(filters.values.period).toBe("custom");
    });

    it("should refuse a repeated first day as malformed", () => {
      const filters = parseMiFilters({ period: "custom", from: ["2026-10-01", "2026-10-02"], to: "2026-10-03" }, NOW);

      expect(filters.errors).toEqual([{ field: "from", message: "Enter the first day of the range as yyyy-MM-dd." }]);
    });
  });
});
