/**
 * The mock's management information (api plan 20261103-mi-dashboard): the four aggregate reads, with api's parameter
 * rules in api's words (`MiParameters` at api `e7ee862`) and fixed figures rather than figures computed from the
 * mock's cases. The pages draw tables, charts and CSVs from these answers, so what matters is that every shape a page
 * must handle turns up in any range of three periods or more, and that the same request always answers the same.
 *
 * - **The second period is empty** in every KPI: no cases, `count` 0 and null percentiles (api D6).
 * - **The third holds one case** in every bucket, so a median from one case is a median from one case.
 * - Every other figure is a fixed function of the period's start, scaled by its length, so a week reads the same
 *   whichever range it is asked in. The cohorts nearest the range's end keep more cases open, as real ones do.
 * - **Exclusions are non-zero**: a negative interval on received-to-ready, a completion before receipt, a
 *   contradiction, cases with no `dateReceived` and a decision date with no decision. With `includeMigrated=false` a
 *   fifth of each count moves into the `migrated` exclusions.
 *
 * Stateless, so `reset` has nothing to clear here.
 */
import { DEED_POLL_TYPE, MI_GRANULARITY, MI_STAGE_INTERVAL } from "../api/wire.js";

export const MI_KPIS = ["volume", "stage-durations", "referral-outcomes", "completion"] as const;

const MAX_SPAN_YEARS = 2;
const NO_FROM = "Enter the first day of the range.";
const NO_TO = "Enter the last day of the range.";
const CHOOSE_GRANULARITY = "Choose WEEK, MONTH or QUARTER.";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const EMPTY_PERIOD = 1;
const ONE_CASE_PERIOD = 2;
// Over all time, migrated or not, as api counts them: no period can hold them.
const NO_DATE_RECEIVED = 3;

// Weekly ranges per type, before scaling to the period's length.
const TYPE_RANGES: Readonly<Record<(typeof DEED_POLL_TYPE)[number], readonly [number, number]>> = {
  Adult: [4, 9],
  AdultTransgender: [0, 2],
  Minor: [1, 3],
  MinorTransgender: [0, 1],
  DeedOfRelinquishment: [0, 1],
  Unknown: [0, 1]
};

// Weekly counts and median days per interval: [count low, count high, median low, median high].
const INTERVAL_RANGES: Readonly<Record<(typeof MI_STAGE_INTERVAL)[number], readonly [number, number, number, number]>> = {
  RECEIVED_TO_READY_FOR_MASTER: [4, 10, 3, 12],
  READY_TO_REFERRED: [1, 4, 0, 3],
  REFERRED_TO_DECISION: [1, 4, 2, 7],
  SIGNATURE_REQUESTED_TO_RECEIVED: [3, 8, 5, 20],
  SIGNATURE_RECEIVED_TO_ENROLED: [3, 8, 1, 5]
};

// The share of a cohort still open, by how many cohorts it is from the range's end.
const STILL_OPEN_SHARE = [0.7, 0.4, 0.2];
const SETTLED_OPEN_SHARE = 0.05;

/** One read, after the mock's own gate: a 400 in api's shape, or the 200 body. */
export function managementInformation(kpi: MiKpi, query: URLSearchParams): { status: number; body: unknown } {
  const parsed = parseParameters(query);
  if ("errors" in parsed) return { status: 400, body: { error: parsed.errors[0].message, errors: parsed.errors } };
  const periods = periodsOf(parsed);
  const parameters = { from: parsed.from, to: parsed.to, granularity: parsed.granularity, includeMigrated: parsed.includeMigrated };

  switch (kpi) {
    case "volume":
      return { status: 200, body: { parameters, ...volume(periods, parsed.includeMigrated) } };
    case "stage-durations":
      return { status: 200, body: { parameters, ...stageDurations(periods, parsed.includeMigrated) } };
    case "referral-outcomes":
      return { status: 200, body: { parameters, ...referralOutcomes(periods, parsed.includeMigrated) } };
    case "completion":
      return { status: 200, body: { parameters, ...completion(periods, parsed.includeMigrated) } };
  }
}

export function isMiKpi(value: string): value is MiKpi {
  return (MI_KPIS as readonly string[]).includes(value);
}

/** api's `MiParameters.parse` then `of`: every malformed field together, and the range checks only once all parse. */
function parseParameters(query: URLSearchParams): Parameters | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const from = parseDate(query.get("from"), "from", NO_FROM, "Enter the first day of the range as yyyy-MM-dd.", errors);
  const to = parseDate(query.get("to"), "to", NO_TO, "Enter the last day of the range as yyyy-MM-dd.", errors);
  const granularity = query.get("granularity");
  const bucket = MI_GRANULARITY.find((member) => member === granularity);
  if (bucket === undefined) errors.push({ field: "granularity", message: CHOOSE_GRANULARITY });
  const includeMigrated = query.get("includeMigrated");
  if (includeMigrated !== null && includeMigrated !== "true" && includeMigrated !== "false") {
    errors.push({ field: "includeMigrated", message: "includeMigrated is true or false." });
  }
  if (errors.length > 0 || from === null || to === null || bucket === undefined) return { errors };

  if (to < from) return { errors: [{ field: "to", message: "The last day of the range cannot be before the first." }] };
  if (to > plusYears(from, MAX_SPAN_YEARS)) return { errors: [{ field: "to", message: `The range cannot be longer than ${MAX_SPAN_YEARS} years.` }] };
  return { from, to, granularity: bucket, includeMigrated: includeMigrated !== "false" };
}

/** `LocalDate.parse` with four-digit years from 1 to 9999; the text is never echoed. Blank is missing. */
function parseDate(text: string | null, field: string, missing: string, malformed: string, errors: FieldError[]): string | null {
  if (text === null || text.trim() === "") {
    errors.push({ field, message: missing });
    return null;
  }
  if (ISO_DATE.test(text) && Number(text.slice(0, 4)) >= 1 && isCalendarDate(text)) return text;
  errors.push({ field, message: malformed });
  return null;
}

function isCalendarDate(text: string): boolean {
  const [year, month, day] = text.split("-").map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/** Java's `plusYears`: 29 February lands on the 28th in a year that has no 29th. */
function plusYears(day: string, years: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const target = year + years;
  return isoDay(target, month, Math.min(date, daysInMonth(target, month)));
}

/** api's `MiParameters.periods`: every calendar period the range touches, the first and last clipped to it. */
function periodsOf({ from, to, granularity }: Parameters): Period[] {
  const periods: Period[] = [];
  for (let start = startOf(granularity, from); start <= to; start = next(granularity, start)) {
    const end = addDays(next(granularity, start), -1);
    const clippedStart = start < from ? from : start;
    const clippedEnd = end > to ? to : end;
    periods.push({ start: clippedStart, end: clippedEnd, key: start, weeks: (dayNumber(clippedEnd) - dayNumber(clippedStart) + 1) / 7 });
  }
  return periods;
}

function startOf(granularity: Granularity, day: string): string {
  const [year, month] = day.split("-").map(Number);
  if (granularity === "MONTH") return isoDay(year, month, 1);
  if (granularity === "QUARTER") return isoDay(year, Math.floor((month - 1) / 3) * 3 + 1, 1);
  // ISO week: back to Monday. getUTCDay is 0 for Sunday.
  return addDays(day, -((new Date(dayNumber(day) * DAY_MS).getUTCDay() + 6) % 7));
}

function next(granularity: Granularity, start: string): string {
  if (granularity === "WEEK") return addDays(start, 7);
  const [year, month] = start.split("-").map(Number);
  const months = month - 1 + (granularity === "MONTH" ? 1 : 3);
  return isoDay(year + Math.floor(months / 12), (months % 12) + 1, 1);
}

function volume(periods: readonly Period[], includeMigrated: boolean) {
  let migrated = includeMigrated ? 0 : 2;
  const rows = periods.map((period, index) => {
    const receivedByType = DEED_POLL_TYPE.map((type) => {
      const [low, high] = TYPE_RANGES[type];
      const all = shaped(index, period, `type:${type}`, low, high, type === "Adult" ? 1 : 0);
      migrated += all - kept(all, includeMigrated);
      return { type, count: kept(all, includeMigrated) };
    });
    const openAtEnd = kept(between(period.key, "open", 28, 46), includeMigrated);
    return { start: period.start, end: period.end, received: sum(receivedByType.map((row) => row.count)), receivedByType, openAtEnd };
  });
  return { periods: rows, excluded: { noDateReceived: NO_DATE_RECEIVED, migrated } };
}

function stageDurations(periods: readonly Period[], includeMigrated: boolean) {
  const migrated = new Map<string, number>(MI_STAGE_INTERVAL.map((interval) => [interval, 0]));
  const rows = periods.map((period, index) => ({
    start: period.start,
    end: period.end,
    intervals: MI_STAGE_INTERVAL.map((interval) => {
      const [low, high, medianLow, medianHigh] = INTERVAL_RANGES[interval];
      const all = shaped(index, period, `interval:${interval}`, low, high, 1);
      const count = kept(all, includeMigrated);
      migrated.set(interval, (migrated.get(interval) ?? 0) + all - count);
      return { interval, count, ...percentiles(count, period.key, interval, medianLow, medianHigh) };
    })
  }));
  return {
    periods: rows,
    excluded: {
      negativeInterval: MI_STAGE_INTERVAL.map((interval) => ({ interval, count: interval === "RECEIVED_TO_READY_FOR_MASTER" ? 1 : 0 })),
      migrated: MI_STAGE_INTERVAL.map((interval) => ({ interval, count: migrated.get(interval) ?? 0 }))
    }
  };
}

function referralOutcomes(periods: readonly Period[], includeMigrated: boolean) {
  let migratedDecisions = 0;
  let migratedConfirmations = 0;
  const rows = periods.map((period, index) => {
    const approvedAll = shaped(index, period, "approved", 2, 5, 1);
    const rejectedAll = shaped(index, period, "rejected", 0, 2, 0);
    const confirmedAll = shaped(index, period, "confirmed", 1, 4, 1);
    const withdrawnAll = shaped(index, period, "withdrawn", 0, 1, 0);
    const approved = kept(approvedAll, includeMigrated);
    const rejected = kept(rejectedAll, includeMigrated);
    migratedDecisions += approvedAll - approved + rejectedAll - rejected;
    const confirmed = kept(confirmedAll, includeMigrated);
    const withdrawn = kept(withdrawnAll, includeMigrated);
    migratedConfirmations += confirmedAll - confirmed + withdrawnAll - withdrawn;
    return {
      start: period.start,
      end: period.end,
      decisions: {
        approved: { count: approved, urgent: Math.min(approved, between(period.key, "approved-urgent", 0, 1)) },
        rejected: { count: rejected, urgent: Math.min(rejected, between(period.key, "rejected-urgent", 0, 1)) }
      },
      confirmations: { confirmed, withdrawn }
    };
  });
  return { periods: rows, excluded: { migratedDecisions, migratedConfirmations, decisionDateWithoutDecision: 1, confirmationWithoutOutcome: 0 } };
}

function completion(periods: readonly Period[], includeMigrated: boolean) {
  let migrated = 0;
  const cohorts = periods.map((period, index) => {
    const receivedAll = shaped(index, period, "cohort", 6, 14, 1);
    const received = kept(receivedAll, includeMigrated);
    migrated += receivedAll - received;
    const fromEnd = periods.length - 1 - index;
    const stillOpen = index === ONE_CASE_PERIOD ? 0 : Math.round(received * (STILL_OPEN_SHARE[fromEnd] ?? SETTLED_OPEN_SHARE));
    const completed = received - stillOpen;
    const returned = Math.min(completed, index === ONE_CASE_PERIOD ? 0 : between(period.key, "returned", 0, 1));
    // The first cohort holds the one completion dated before its receipt: completed, but no duration.
    const timed = index === 0 ? Math.max(completed - 1, 0) : completed;
    return {
      start: period.start,
      end: period.end,
      received,
      completed,
      enroled: completed - returned,
      returned,
      stillOpen,
      daysToCompletion: { count: timed, ...percentiles(timed, period.key, "completion", 20, 45) }
    };
  });
  return { cohorts, excluded: { noDateReceived: NO_DATE_RECEIVED, contradiction: 1, negativeInterval: 1, migrated } };
}

/** The figure for one bucket: none in the empty period, `one` in the one-case period, otherwise fixed and scaled. */
function shaped(index: number, period: Period, salt: string, low: number, high: number, one: number): number {
  if (index === EMPTY_PERIOD) return 0;
  if (index === ONE_CASE_PERIOD) return one;
  return Math.round(between(period.key, salt, low, high) * period.weeks);
}

/** A fifth of a count is migrated, and leaves the figure when migrated cases do not count. */
function kept(count: number, includeMigrated: boolean): number {
  return includeMigrated ? count : count - Math.floor(count / 5);
}

/** Null exactly when there is nothing to measure; one case is its own median and 95th percentile. */
function percentiles(count: number, key: string, salt: string, low: number, high: number): { medianDays: number | null; p95Days: number | null } {
  if (count === 0) return { medianDays: null, p95Days: null };
  // Halves, because percentile_cont interpolates between the two middle values.
  const medianDays = between(key, `${salt}:median`, low * 2, high * 2) / 2;
  if (count === 1) return { medianDays, p95Days: medianDays };
  return { medianDays, p95Days: medianDays + between(key, `${salt}:p95`, 2, 16) / 2 };
}

/** A fixed integer in [low, high] for a period and a figure, from an FNV-1a hash, so a request always answers alike. */
function between(key: string, salt: string, low: number, high: number): number {
  let hash = 0x811c9dc5;
  for (const char of `${key}:${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return low + (hash % (high - low + 1));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function addDays(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, date);
  return Math.round(utc.getTime() / DAY_MS);
}

function isoDay(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type MiKpi = (typeof MI_KPIS)[number];
type Granularity = (typeof MI_GRANULARITY)[number];

interface Parameters {
  from: string;
  to: string;
  granularity: Granularity;
  includeMigrated: boolean;
}

interface Period {
  start: string;
  end: string;
  /** The unclipped calendar start, which the figures are keyed on so a period reads alike in any range. */
  key: string;
  weeks: number;
}

interface FieldError {
  field: string;
  message: string;
}
