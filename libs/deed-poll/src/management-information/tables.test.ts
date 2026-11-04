import { describe, expect, it } from "vitest";
import type { MiCompletion, MiReferralOutcomes, MiStageDurations, MiVolume } from "./service.js";
import {
  completionExclusions,
  completionTable,
  referralOutcomeExclusions,
  referralOutcomesTable,
  stageDurationExclusions,
  stageDurationTables,
  volumeExclusions,
  volumeTable
} from "./tables.js";

const PARAMETERS = { from: "2026-10-05", to: "2026-10-18", granularity: "WEEK" as const, includeMigrated: true };
const WEEK_1 = { start: "2026-10-05", end: "2026-10-11" };
const WEEK_2 = { start: "2026-10-12", end: "2026-10-18" };

describe("management-information/tables", () => {
  describe("volumeTable", () => {
    it("should give received, each type in api's declaration order and the open caseload, per period", () => {
      const volume: MiVolume = {
        parameters: PARAMETERS,
        periods: [
          {
            ...WEEK_1,
            received: 5,
            openAtEnd: 40,
            receivedByType: [
              { type: "Adult", count: 3 },
              { type: "Minor", count: 2 }
            ]
          }
        ],
        excluded: { noDateReceived: 0, migrated: 0 }
      };

      const table = volumeTable(volume);

      expect(table.columns.map((column) => column.key)).toEqual([
        "received",
        "received:Adult",
        "received:AdultTransgender",
        "received:Minor",
        "received:MinorTransgender",
        "received:DeedOfRelinquishment",
        "received:Unknown",
        "openAtEnd"
      ]);
      expect(table.rows).toEqual([{ ...WEEK_1, cells: [5, 3, 0, 2, 0, 0, 0, 40] }]);
    });

    it("should give no rows for an answer with no periods", () => {
      const table = volumeTable({ parameters: PARAMETERS, periods: [], excluded: { noDateReceived: 0, migrated: 0 } });

      expect(table.rows).toEqual([]);
    });
  });

  describe("stageDurationTables", () => {
    it("should give one table per interval, each percentile beside its count, and null for an empty bucket", () => {
      const durations: MiStageDurations = {
        parameters: PARAMETERS,
        periods: [
          { ...WEEK_1, intervals: [{ interval: "REFERRED_TO_DECISION", count: 1, medianDays: 4, p95Days: 4 }] },
          { ...WEEK_2, intervals: [{ interval: "REFERRED_TO_DECISION", count: 0, medianDays: null, p95Days: null }] }
        ],
        excluded: { negativeInterval: [], migrated: [] }
      };

      const tables = stageDurationTables(durations);

      expect(tables.map((table) => table.interval)).toEqual([
        "RECEIVED_TO_READY_FOR_MASTER",
        "READY_TO_REFERRED",
        "REFERRED_TO_DECISION",
        "SIGNATURE_REQUESTED_TO_RECEIVED",
        "SIGNATURE_RECEIVED_TO_ENROLED"
      ]);
      expect(tables[2].columns).toEqual([
        { key: "count", kind: "count" },
        { key: "medianDays", kind: "days" },
        { key: "p95Days", kind: "days" }
      ]);
      expect(tables[2].rows).toEqual([
        { ...WEEK_1, cells: [1, 4, 4] },
        { ...WEEK_2, cells: [0, null, null] }
      ]);
      expect(tables[0].rows[0].cells).toEqual([0, null, null]);
    });
  });

  describe("referralOutcomesTable", () => {
    it("should give the decisions with their urgent counts, then the confirmations", () => {
      const outcomes: MiReferralOutcomes = {
        parameters: PARAMETERS,
        periods: [
          { ...WEEK_1, decisions: { approved: { count: 6, urgent: 1 }, rejected: { count: 2, urgent: 0 } }, confirmations: { confirmed: 3, withdrawn: 1 } }
        ],
        excluded: { migratedDecisions: 0, migratedConfirmations: 0, decisionDateWithoutDecision: 0, confirmationWithoutOutcome: 0 }
      };

      const table = referralOutcomesTable(outcomes);

      expect(table.columns.map((column) => column.key)).toEqual(["approved", "approvedUrgent", "rejected", "rejectedUrgent", "confirmed", "withdrawn"]);
      expect(table.rows).toEqual([{ ...WEEK_1, cells: [6, 1, 2, 0, 3, 1] }]);
    });
  });

  describe("completionTable", () => {
    it("should put still open immediately before the count and percentiles it qualifies", () => {
      const completion: MiCompletion = {
        parameters: PARAMETERS,
        cohorts: [
          {
            ...WEEK_1,
            received: 10,
            completed: 4,
            enroled: 3,
            returned: 1,
            stillOpen: 6,
            daysToCompletion: { count: 4, medianDays: 12.5, p95Days: 20 }
          },
          { ...WEEK_2, received: 0, completed: 0, enroled: 0, returned: 0, stillOpen: 0, daysToCompletion: { count: 0, medianDays: null, p95Days: null } }
        ],
        excluded: { noDateReceived: 0, contradiction: 0, negativeInterval: 0, migrated: 0 }
      };

      const table = completionTable(completion);

      expect(table.columns.map((column) => column.key)).toEqual([
        "received",
        "completed",
        "enroled",
        "returned",
        "stillOpen",
        "timed",
        "medianDays",
        "p95Days"
      ]);
      expect(table.rows).toEqual([
        { ...WEEK_1, cells: [10, 4, 3, 1, 6, 4, 12.5, 20] },
        { ...WEEK_2, cells: [0, 0, 0, 0, 0, 0, null, null] }
      ]);
    });
  });

  describe("exclusions", () => {
    it("should list a KPI's exclusions without the migrated count when migrated cases were included", () => {
      const volume: MiVolume = { parameters: PARAMETERS, periods: [], excluded: { noDateReceived: 3, migrated: 0 } };

      expect(volumeExclusions(volume)).toEqual([{ key: "noDateReceived", count: 3 }]);
    });

    it("should list the migrated counts when migrated cases were left out", () => {
      const outcomes: MiReferralOutcomes = {
        parameters: { ...PARAMETERS, includeMigrated: false },
        periods: [],
        excluded: { migratedDecisions: 2, migratedConfirmations: 1, decisionDateWithoutDecision: 1, confirmationWithoutOutcome: 0 }
      };

      expect(referralOutcomeExclusions(outcomes)).toEqual([
        { key: "decisionDateWithoutDecision", count: 1 },
        { key: "confirmationWithoutOutcome", count: 0 },
        { key: "migratedDecisions", count: 2 },
        { key: "migratedConfirmations", count: 1 }
      ]);
    });

    it("should list every interval's negative count in api's order, zeros included", () => {
      const durations: MiStageDurations = {
        parameters: PARAMETERS,
        periods: [],
        excluded: { negativeInterval: [{ interval: "READY_TO_REFERRED", count: 2 }], migrated: [{ interval: "READY_TO_REFERRED", count: 9 }] }
      };

      const exclusions = stageDurationExclusions(durations);

      expect(exclusions).toHaveLength(5);
      expect(exclusions[0]).toEqual({ key: "negativeInterval", interval: "RECEIVED_TO_READY_FOR_MASTER", count: 0 });
      expect(exclusions[1]).toEqual({ key: "negativeInterval", interval: "READY_TO_REFERRED", count: 2 });
    });

    it("should list completion's four exclusions in its details' order", () => {
      const completion: MiCompletion = {
        parameters: { ...PARAMETERS, includeMigrated: false },
        cohorts: [],
        excluded: { noDateReceived: 3, contradiction: 1, negativeInterval: 2, migrated: 4 }
      };

      expect(completionExclusions(completion).map((each) => [each.key, each.count])).toEqual([
        ["noDateReceived", 3],
        ["contradiction", 1],
        ["negativeInterval", 2],
        ["migrated", 4]
      ]);
    });
  });
});
