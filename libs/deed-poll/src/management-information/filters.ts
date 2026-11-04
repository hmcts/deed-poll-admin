/**
 * The management information page's filters (plan `docs/plans/20261103-mi-dashboard-page.md`, decision A2): a period
 * preset or a custom range, a granularity and whether migrated cases count. One GET form, so every control arrives in
 * the query string, and the CSV routes read the same string the same way.
 *
 * The range rules and their sentences are api's (`MiParameters` at api `e7ee862`), so the page refuses in api's words
 * what api would refuse, before asking. api still checks them; its 400 is rendered the same way.
 */
import { type ManagementInformationQuery, MI_GRANULARITY, type MiGranularity } from "@hmcts/deed-poll-api-client";
import type { FieldError } from "../errors.js";

export const MI_PERIODS = ["7-days", "30-days", "60-days", "90-days", "year", "custom"] as const;
export const DEFAULT_MI_PERIOD: MiPeriod = "30-days";

const PRESET_DAYS: Readonly<Record<Exclude<MiPeriod, "year" | "custom">, number>> = {
  "7-days": 7,
  "30-days": 30,
  "60-days": 60,
  "90-days": 90
};
// Weeks up to the longest day preset, months beyond it, so the year preset reads monthly.
const LONGEST_WEEKLY_SPAN_DAYS = 90;
const MAX_SPAN_YEARS = 2;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London" });

const MESSAGES = {
  period: "Choose a period.",
  fromMissing: "Enter the first day of the range.",
  fromMalformed: "Enter the first day of the range as yyyy-MM-dd.",
  toMissing: "Enter the last day of the range.",
  toMalformed: "Enter the last day of the range as yyyy-MM-dd.",
  toBeforeFrom: "The last day of the range cannot be before the first.",
  tooLong: `The range cannot be longer than ${MAX_SPAN_YEARS} years.`,
  granularity: "Choose WEEK, MONTH or QUARTER.",
  includeMigrated: "includeMigrated is true or false."
} as const;

/**
 * Reads the filters from a query string. `query` is api's request when every control is usable, otherwise null with
 * the errors in the form's order. `values` is what to redraw, as submitted. A preset ignores the range controls, and
 * a granularity nobody chose follows the range's length.
 */
export function parseMiFilters(query: Record<string, unknown>, now: Date): MiFilters {
  const values: MiFilterValues = {
    period: textOf(query.period) ?? DEFAULT_MI_PERIOD,
    from: textOf(query.from) ?? "",
    to: textOf(query.to) ?? "",
    granularity: textOf(query.granularity) ?? "",
    includeMigrated: textOf(query.includeMigrated) ?? "true"
  };
  const errors: FieldError[] = [];

  const period = MI_PERIODS.find((member) => member === values.period && (query.period === undefined || isSingle(query.period)));
  if (period === undefined) errors.push({ field: "period", message: MESSAGES.period });
  const range = period === undefined ? null : rangeOf(period, query, now, errors);
  const chosen = MI_GRANULARITY.find((member) => member === values.granularity);
  if (query.granularity !== undefined && (chosen === undefined || !isSingle(query.granularity))) {
    errors.push({ field: "granularity", message: MESSAGES.granularity });
  }
  if (query.includeMigrated !== undefined && (!isSingle(query.includeMigrated) || !["true", "false"].includes(values.includeMigrated))) {
    errors.push({ field: "includeMigrated", message: MESSAGES.includeMigrated });
  }

  if (errors.length > 0 || range === null) return { values, errors, query: null };
  return {
    values,
    errors,
    query: { from: range.from, to: range.to, granularity: chosen ?? defaultGranularity(range), includeMigrated: values.includeMigrated !== "false" }
  };
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}

/** A repeated or bracketed name parses into an array or object, which no control on the form sends. */
function isSingle(value: unknown): boolean {
  return typeof value === "string";
}

function rangeOf(period: MiPeriod, query: Record<string, unknown>, now: Date, errors: FieldError[]): Range | null {
  const today = LONDON_DAY.format(now);
  if (period === "year") return { from: addDays(plusYears(today, -1), 1), to: today };
  if (period !== "custom") return { from: addDays(today, 1 - PRESET_DAYS[period]), to: today };

  const from = parseDate(query.from, "from", MESSAGES.fromMissing, MESSAGES.fromMalformed, errors);
  const to = parseDate(query.to, "to", MESSAGES.toMissing, MESSAGES.toMalformed, errors);
  if (from === null || to === null) return null;
  if (to < from) {
    errors.push({ field: "to", message: MESSAGES.toBeforeFrom });
    return null;
  }
  if (to > plusYears(from, MAX_SPAN_YEARS)) {
    errors.push({ field: "to", message: MESSAGES.tooLong });
    return null;
  }
  return { from, to };
}

/** api's `LocalDate.parse` with four-digit years from 1: blank is missing, anything else unparseable is malformed. */
function parseDate(value: unknown, field: string, missing: string, malformed: string, errors: FieldError[]): string | null {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    errors.push({ field, message: missing });
    return null;
  }
  if (typeof value === "string" && ISO_DATE.test(value) && Number(value.slice(0, 4)) >= 1 && isCalendarDate(value)) return value;
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

function addDays(day: string, days: number): string {
  const date = new Date(dayNumber(day) * DAY_MS + days * DAY_MS);
  return isoDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
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

function defaultGranularity({ from, to }: Range): MiGranularity {
  return dayNumber(to) - dayNumber(from) + 1 <= LONGEST_WEEKLY_SPAN_DAYS ? "WEEK" : "MONTH";
}

export type MiPeriod = (typeof MI_PERIODS)[number];

/** Each control's submitted text, to redraw the form exactly as it was sent. */
export interface MiFilterValues {
  period: string;
  from: string;
  to: string;
  /** Empty when nobody chose one, so the form checks no radio and the range's length decides. */
  granularity: string;
  includeMigrated: string;
}

export interface MiFilters {
  values: MiFilterValues;
  errors: FieldError[];
  query: ManagementInformationQuery | null;
}

interface Range {
  from: string;
  to: string;
}
