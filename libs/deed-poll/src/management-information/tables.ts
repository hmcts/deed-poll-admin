/**
 * The management information tables (plan `docs/plans/completed/20261103-mi-dashboard-page.md`, decisions A5 to A7), as data
 * with no words: each column is a key the page names in its own language, and each cell is api's number or null.
 * The page's tables and the CSV downloads are both drawn from these, so a download holds exactly the table's rows.
 *
 * Nothing is computed here beyond picking api's figures out of its answer. A null percentile is api's "no cases",
 * which is not zero days, so it stays null for the page to say so and for the CSV to leave empty.
 */
import { MI_STAGE_INTERVAL, type MiStageInterval } from "@hmcts/deed-poll-api-client";
import { DeedPollType } from "../deed-poll/enums/option-sets.js";
import type { MiCompletion, MiReferralOutcomes, MiStageDurations, MiVolume } from "./service.js";

const TYPES = Object.values(DeedPollType);

/** K1: cases received, by type, then the caseload open at each period's end. */
export function volumeTable(volume: MiVolume): MiTable {
  return {
    columns: [count("received"), ...TYPES.map((type) => count(`received:${type}`)), count("openAtEnd")],
    rows: volume.periods.map((period) => ({
      start: period.start,
      end: period.end,
      cells: [period.received, ...TYPES.map((type) => period.receivedByType.find((each) => each.type === type)?.count ?? 0), period.openAtEnd]
    }))
  };
}

/** K2: one table per interval, in api's order, each percentile beside the count it was taken over. */
export function stageDurationTables(durations: MiStageDurations): MiIntervalTable[] {
  return MI_STAGE_INTERVAL.map((interval) => ({
    interval,
    columns: [count("count"), days("medianDays"), days("p95Days")],
    rows: durations.periods.map((period) => {
      const figures = period.intervals.find((each) => each.interval === interval);
      return {
        start: period.start,
        end: period.end,
        cells: [figures?.count ?? 0, figures?.medianDays ?? null, figures?.p95Days ?? null]
      };
    })
  }));
}

/** K3: the Masters' decisions, with how many were urgent, then the applicants' confirmations. Counts only. */
export function referralOutcomesTable(outcomes: MiReferralOutcomes): MiTable {
  return {
    columns: ["approved", "approvedUrgent", "rejected", "rejectedUrgent", "confirmed", "withdrawn"].map(count),
    rows: outcomes.periods.map(({ start, end, decisions, confirmations }) => ({
      start,
      end,
      cells: [
        decisions.approved.count,
        decisions.approved.urgent,
        decisions.rejected.count,
        decisions.rejected.urgent,
        confirmations.confirmed,
        confirmations.withdrawn
      ]
    }))
  };
}

/** K4: each intake cohort, with `stillOpen` immediately before the count and percentiles it qualifies (A6). */
export function completionTable(completion: MiCompletion): MiTable {
  return {
    columns: [
      count("received"),
      count("completed"),
      count("enroled"),
      count("returned"),
      count("stillOpen"),
      count("timed"),
      days("medianDays"),
      days("p95Days")
    ],
    rows: completion.cohorts.map((cohort) => ({
      start: cohort.start,
      end: cohort.end,
      cells: [
        cohort.received,
        cohort.completed,
        cohort.enroled,
        cohort.returned,
        cohort.stillOpen,
        cohort.daysToCompletion.count,
        cohort.daysToCompletion.medianDays ?? null,
        cohort.daysToCompletion.p95Days ?? null
      ]
    }))
  };
}

/**
 * What each KPI left out, as api counts it, in the order its details list them (A7). A `migrated` count is api's 0
 * whenever migrated cases are included, so it is listed only when they were left out.
 */
export function volumeExclusions({ parameters, excluded }: MiVolume): MiExclusion[] {
  return listed(parameters.includeMigrated, [
    { key: "noDateReceived", count: excluded.noDateReceived },
    { key: "migrated", count: excluded.migrated }
  ]);
}

export function stageDurationExclusions({ parameters, excluded }: MiStageDurations): MiExclusion[] {
  return listed(parameters.includeMigrated, [
    ...intervalCounts("negativeInterval", excluded.negativeInterval),
    ...intervalCounts("migrated", excluded.migrated)
  ]);
}

export function referralOutcomeExclusions({ parameters, excluded }: MiReferralOutcomes): MiExclusion[] {
  return listed(parameters.includeMigrated, [
    { key: "decisionDateWithoutDecision", count: excluded.decisionDateWithoutDecision },
    { key: "confirmationWithoutOutcome", count: excluded.confirmationWithoutOutcome },
    { key: "migratedDecisions", count: excluded.migratedDecisions },
    { key: "migratedConfirmations", count: excluded.migratedConfirmations }
  ]);
}

export function completionExclusions({ parameters, excluded }: MiCompletion): MiExclusion[] {
  return listed(parameters.includeMigrated, [
    { key: "noDateReceived", count: excluded.noDateReceived },
    { key: "contradiction", count: excluded.contradiction },
    { key: "negativeInterval", count: excluded.negativeInterval },
    { key: "migrated", count: excluded.migrated }
  ]);
}

function count(key: string): MiColumn {
  return { key, kind: "count" };
}

function days(key: string): MiColumn {
  return { key, kind: "days" };
}

// Every migrated key starts "migrated", and each is api's 0 when migrated cases were included.
function listed(includeMigrated: boolean, exclusions: MiExclusion[]): MiExclusion[] {
  return includeMigrated ? exclusions.filter((each) => !each.key.startsWith("migrated")) : exclusions;
}

/** Every interval, zeros included, in api's order, whatever order the answer listed them in. */
function intervalCounts(key: string, counts: { interval: MiStageInterval; count: number }[]): MiExclusion[] {
  return MI_STAGE_INTERVAL.map((interval) => ({ key, interval, count: counts.find((each) => each.interval === interval)?.count ?? 0 }));
}

export type MiKpi = "volume" | "stage-durations" | "referral-outcomes" | "completion";

export interface MiColumn {
  /** The page's name for the column; `received:<type>` is one deed poll type's share of `received`. */
  key: string;
  /** A count is a whole number of cases; days are a percentile, null when its bucket held no cases. */
  kind: "count" | "days";
}

export interface MiRow {
  /** The period's first and last days, inclusive, as api's `yyyy-MM-dd`. */
  start: string;
  end: string;
  cells: (number | null)[];
}

export interface MiTable {
  columns: MiColumn[];
  rows: MiRow[];
}

export interface MiIntervalTable extends MiTable {
  interval: MiStageInterval;
}

export interface MiExclusion {
  key: string;
  interval?: MiStageInterval;
  count: number;
}
