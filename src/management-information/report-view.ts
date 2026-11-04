/**
 * The management information page's four sections, in the page's language, from the word-free tables in
 * `@hmcts/deed-poll` (plan `docs/plans/completed/20261103-mi-dashboard-page.md`, decisions A5 to A7). Each table's rows go to
 * `govukTable` as they are.
 *
 * - **A5:** a percentile column always follows the count it was taken over, and a null percentile reads "No cases",
 *   never zero.
 * - **A6:** the completion section carries its still-open sentence, and its table puts still open beside the
 *   percentiles.
 * - **A7:** every section's details list what it leaves out, with api's excluded counts.
 */
import {
  completionExclusions,
  completionTable,
  type ManagementInformationQuery,
  MI_STAGE_INTERVAL,
  type MiColumn,
  type MiCompletion,
  type MiExclusion,
  type MiGranularity,
  type MiKpi,
  type MiReferralOutcomes,
  type MiStageDurations,
  type MiTable,
  type MiVolume,
  referralOutcomeExclusions,
  referralOutcomesTable,
  stageDurationExclusions,
  stageDurationTables,
  volumeExclusions,
  volumeTable
} from "@hmcts/deed-poll";
import { type LineChartGeometry, lineChart } from "./chart-geometry.js";
import type { en } from "./content.js";
import { csvHref } from "./paths.js";

const LOCALE_TAG = { en: "en-GB", cy: "cy-GB" } as const;
// What each chart draws: the table's headline figures, never more than it holds (A3).
const PERCENTILES = ["medianDays", "p95Days"];

export function reportView(report: Report, locale: keyof typeof LOCALE_TAG, content: Content): ReportView {
  const format = formatters(locale, content, report.query.granularity);
  return {
    volume: section("volume", report.query, content.volume, report.volume, (volume) => ({
      tables: [table(format, volumeTable(volume), content.volume.columns, content.volume.heading, chartOf("volume", ["received", "openAtEnd"]))],
      notes: [content.editedDates, content.volume.unknownTypeNote],
      exclusions: exclusionItems(volumeExclusions(volume), content.volume.exclusions, format)
    })),
    stageDurations: section("stage-durations", report.query, content.stageDurations, report.stageDurations, (durations) => ({
      tables: stageDurationTables(durations).map((each, index) =>
        table(
          format,
          each,
          content.stageDurations.columns,
          content.stageDurations.intervals[each.interval],
          chartOf(`stage-durations-${index + 1}`, PERCENTILES)
        )
      ),
      notes: [content.editedDates, content.stageDurations.missingDatesNote, content.stageDurations.furtherDocumentsNote],
      exclusions: [],
      exclusionTable: stageExclusionTable(stageDurationExclusions(durations), content, format)
    })),
    referralOutcomes: section("referral-outcomes", report.query, content.referralOutcomes, report.referralOutcomes, (outcomes) => ({
      tables: [
        table(
          format,
          referralOutcomesTable(outcomes),
          content.referralOutcomes.columns,
          content.referralOutcomes.heading,
          chartOf("referral-outcomes", ["approved", "rejected", "confirmed", "withdrawn"])
        )
      ],
      notes: [content.editedDates, content.referralOutcomes.staffWithdrawalNote],
      exclusions: exclusionItems(referralOutcomeExclusions(outcomes), content.referralOutcomes.exclusions, format)
    })),
    completion: section("completion", report.query, content.completion, report.completion, (completion) => ({
      warning: content.completion.stillOpenWarning,
      tables: [table(format, completionTable(completion), content.completion.columns, content.completion.heading, chartOf("completion", PERCENTILES))],
      notes: [content.editedDates],
      exclusions: exclusionItems(completionExclusions(completion), content.completion.exclusions, format)
    }))
  };
}

export function utcDay(day: string): Date {
  // A period's days are calendar days with no zone, so they are formatted as UTC midnight to keep the day they name.
  return new Date(`${day}T00:00:00Z`);
}

function formatters(locale: keyof typeof LOCALE_TAG, content: Content, granularity: MiGranularity): Formatters {
  const count = new Intl.NumberFormat(LOCALE_TAG[locale]);
  const days = new Intl.NumberFormat(LOCALE_TAG[locale], { maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat(LOCALE_TAG[locale], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const tick = new Intl.DateTimeFormat(
    LOCALE_TAG[locale],
    granularity === "WEEK" ? { day: "numeric", month: "short", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" }
  );
  return {
    content,
    unit: content.chartUnits[granularity],
    day: (value) => day.format(utcDay(value)),
    tick: (value) => tick.format(utcDay(value)),
    periodHeading: content.periodHeadings[granularity],
    period: (start, end) => content.periodRange(day.format(utcDay(start)), day.format(utcDay(end))),
    cell: (column, value) => (value === null ? content.noCases : column.kind === "days" ? days.format(value) : count.format(value)),
    count: (value) => count.format(value),
    days: (value) => days.format(value)
  };
}

function section<T>(
  id: MiKpi,
  query: ManagementInformationQuery,
  copy: SectionCopy & { download: string },
  answer: T | null,
  build: (answer: T) => SectionBody
): SectionView {
  const base = { id, heading: copy.heading, description: copy.description };
  if (answer === null) return { ...base, unavailable: true };
  return { ...base, unavailable: false, ...build(answer), download: { href: csvHref(id, query), text: copy.download } };
}

function chartOf(id: string, keys: string[]): ChartChoice {
  return { id: `${id}-chart`, keys };
}

function table(format: Formatters, data: MiTable, headings: Record<string, string>, caption: string, choice: ChartChoice): TableView {
  return {
    caption,
    chart: chart(format, data, headings, caption, choice),
    head: [{ text: format.periodHeading }, ...data.columns.map((column) => ({ text: headings[column.key], format: "numeric" }))],
    rows: data.rows.map((row) => [
      { text: format.period(row.start, row.end) },
      ...data.columns.map((column, index) => ({ text: format.cell(column, row.cells[index]), format: "numeric" }))
    ])
  };
}

/** The chart above a table, drawn from the table's own rows, or null when it would show nothing but empty periods. */
function chart(format: Formatters, data: MiTable, headings: Record<string, string>, title: string, choice: ChartChoice): ChartView | null {
  const columns = choice.keys.map((key) => data.columns.findIndex((column) => column.key === key));
  const series = columns.map((column, index) => ({ key: choice.keys[index], values: data.rows.map((row) => row.cells[column]) }));
  const geometry = lineChart(data.rows.length, series);
  if (geometry === null) return null;

  const kind = data.columns[columns[0]].kind;
  const labels = choice.keys.map((key) => headings[key]);
  const listed = labels.map((label) => label.toLowerCase());
  const seriesText = listed.length === 1 ? listed[0] : `${listed.slice(0, -1).join(", ")} ${format.content.and} ${listed.at(-1)}`;
  const first = format.day(data.rows[0].start);
  const last = format.day(data.rows[data.rows.length - 1].end);
  const hasGaps = series.some((each) => each.values.includes(null));
  return {
    id: choice.id,
    title,
    summary: (hasGaps ? format.content.chartSummaryWithGaps : format.content.chartSummary)(seriesText, format.unit, first, last),
    width: geometry.width,
    height: geometry.height,
    plot: geometry.plot,
    yTicks: geometry.yTicks.map((each) => ({ y: each.y, text: kind === "days" ? format.days(each.value) : format.count(each.value) })),
    xTicks: geometry.xTicks.map((each) => ({ x: each.x, text: format.tick(data.rows[each.index].start) })),
    series: geometry.series.map((each, index) => ({ ...each, label: each.label && { ...each.label, text: labels[index] } }))
  };
}

function exclusionItems(exclusions: MiExclusion[], labels: Record<string, string>, format: Formatters): ExclusionItem[] {
  return exclusions.map((each) => ({ label: labels[each.key], count: format.count(each.count) }));
}

/** Two counts per stage, so a table of stages rather than ten sentences; the migrated column only when it applies. */
function stageExclusionTable(exclusions: MiExclusion[], content: Content, format: Formatters): TableView {
  const copy = content.stageDurations;
  const kinds = ["negativeInterval", "migrated"].filter((key) => exclusions.some((each) => each.key === key));
  return {
    caption: copy.exclusionsHeading,
    head: [{ text: copy.exclusionColumns.interval }, ...kinds.map((key) => ({ text: copy.exclusionColumns[key as "migrated"], format: "numeric" }))],
    rows: MI_STAGE_INTERVAL.map((interval) => [
      { text: copy.intervals[interval] },
      ...kinds.map((key) => ({
        text: format.count(exclusions.find((each) => each.key === key && each.interval === interval)?.count ?? 0),
        format: "numeric"
      }))
    ])
  };
}

type Content = typeof en;

/** Each KPI is api's answer, or null when its read failed and the page must say so. */
export interface Report {
  query: ManagementInformationQuery;
  volume: MiVolume | null;
  stageDurations: MiStageDurations | null;
  referralOutcomes: MiReferralOutcomes | null;
  completion: MiCompletion | null;
}

export interface ReportView {
  volume: SectionView;
  stageDurations: SectionView;
  referralOutcomes: SectionView;
  completion: SectionView;
}

interface Formatters {
  content: Content;
  unit: string;
  day: (value: string) => string;
  tick: (value: string) => string;
  days: (value: number) => string;
  periodHeading: string;
  period: (start: string, end: string) => string;
  cell: (column: MiColumn, value: number | null) => string;
  count: (value: number) => string;
}

interface SectionCopy {
  heading: string;
  description: string;
}

interface SectionBody {
  warning?: string;
  tables: TableView[];
  notes: string[];
  exclusions: ExclusionItem[];
  exclusionTable?: TableView;
}

type SectionView = SectionCopy & { id: string } & ({ unavailable: true } | ({ unavailable: false; download: { href: string; text: string } } & SectionBody));

interface TableView {
  caption: string;
  chart?: ChartView | null;
  head: { text: string; format?: string }[];
  rows: { text: string; format?: string }[][];
}

interface ChartChoice {
  id: string;
  keys: string[];
}

interface ChartView {
  /** Unique on the page, for the SVG's title and summary ids. */
  id: string;
  title: string;
  summary: string;
  width: number;
  height: number;
  plot: LineChartGeometry["plot"];
  yTicks: { y: number; text: string }[];
  xTicks: { x: number; text: string }[];
  series: (Omit<LineChartGeometry["series"][number], "label"> & { label: { x: number; y: number; text: string } | null })[];
}

interface ExclusionItem {
  label: string;
  count: string;
}
