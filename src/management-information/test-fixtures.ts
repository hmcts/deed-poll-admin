/**
 * Fixed api answers for the management information page's tests: three weeks, the first with figures, the second
 * empty (no cases, null percentiles) and the third a bucket of one case, with non-zero exclusions throughout.
 */
import type { MiCompletion, MiReferralOutcomes, MiStageDurations, MiVolume } from "@hmcts/deed-poll";

export const MI_QUERY = { from: "2026-10-06", to: "2026-11-04", granularity: "WEEK" as const, includeMigrated: true };

const WEEKS = [
  { start: "2026-10-05", end: "2026-10-11" },
  { start: "2026-10-12", end: "2026-10-18" },
  { start: "2026-10-19", end: "2026-10-25" }
];
const INTERVALS = [
  "RECEIVED_TO_READY_FOR_MASTER",
  "READY_TO_REFERRED",
  "REFERRED_TO_DECISION",
  "SIGNATURE_REQUESTED_TO_RECEIVED",
  "SIGNATURE_RECEIVED_TO_ENROLED"
] as const;

export function miVolume(parameters = MI_QUERY): MiVolume {
  return {
    parameters,
    periods: [
      {
        ...WEEKS[0],
        received: 1234,
        openAtEnd: 2048,
        receivedByType: [
          { type: "Adult", count: 1200 },
          { type: "Minor", count: 34 }
        ]
      },
      { ...WEEKS[1], received: 0, openAtEnd: 2048, receivedByType: [] },
      { ...WEEKS[2], received: 1, openAtEnd: 2049, receivedByType: [{ type: "Unknown", count: 1 }] }
    ],
    excluded: { noDateReceived: 3, migrated: parameters.includeMigrated ? 0 : 7 }
  };
}

export function miStageDurations(parameters = MI_QUERY): MiStageDurations {
  const figures = (count: number, medianDays: number | null, p95Days: number | null) => INTERVALS.map((interval) => ({ interval, count, medianDays, p95Days }));
  return {
    parameters,
    periods: [
      { ...WEEKS[0], intervals: figures(12, 3.25, 11) },
      { ...WEEKS[1], intervals: figures(0, null, null) },
      { ...WEEKS[2], intervals: figures(1, 6, 6) }
    ],
    excluded: { negativeInterval: [{ interval: "RECEIVED_TO_READY_FOR_MASTER", count: 2 }], migrated: [] }
  };
}

export function miReferralOutcomes(parameters = MI_QUERY): MiReferralOutcomes {
  const period = (approved: number, rejected: number, confirmed: number) => ({
    decisions: { approved: { count: approved, urgent: approved > 1 ? 1 : 0 }, rejected: { count: rejected, urgent: 0 } },
    confirmations: { confirmed, withdrawn: 0 }
  });
  return {
    parameters,
    periods: [
      { ...WEEKS[0], ...period(5, 2, 3) },
      { ...WEEKS[1], ...period(0, 0, 0) },
      { ...WEEKS[2], ...period(1, 0, 0) }
    ],
    excluded: { migratedDecisions: 0, migratedConfirmations: 0, decisionDateWithoutDecision: 1, confirmationWithoutOutcome: 0 }
  };
}

export function miCompletion(parameters = MI_QUERY): MiCompletion {
  return {
    parameters,
    cohorts: [
      { ...WEEKS[0], received: 10, completed: 8, enroled: 7, returned: 1, stillOpen: 2, daysToCompletion: { count: 8, medianDays: 21.5, p95Days: 40 } },
      { ...WEEKS[1], received: 0, completed: 0, enroled: 0, returned: 0, stillOpen: 0, daysToCompletion: { count: 0, medianDays: null, p95Days: null } },
      { ...WEEKS[2], received: 1, completed: 1, enroled: 1, returned: 0, stillOpen: 0, daysToCompletion: { count: 1, medianDays: 9, p95Days: 9 } }
    ],
    excluded: { noDateReceived: 3, contradiction: 1, negativeInterval: 2, migrated: 0 }
  };
}
