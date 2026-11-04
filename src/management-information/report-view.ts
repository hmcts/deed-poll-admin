/**
 * The management information page's four sections, in the page's language, from the word-free tables in
 * `@hmcts/deed-poll` (plan `docs/plans/20261103-mi-dashboard-page.md`, decisions A5 to A7). Each table's rows go to
 * `govukTable` as they are.
 *
 * - **A5:** a percentile column always follows the count it was taken over, and a null percentile reads "No cases",
 *   never zero.
 * - **A6:** the completion section carries its still-open sentence, and its table puts still open beside the
 *   percentiles.
 * - **A7:** every section's details list what it leaves out, with api's excluded counts.
 */
import {
  completionTable,
  type ManagementInformationQuery,
  MI_STAGE_INTERVAL,
  type MiColumn,
  type MiCompletion,
  type MiExclusion,
  type MiGranularity,
  type MiReferralOutcomes,
  type MiStageDurations,
  type MiTable,
  type MiVolume,
  miExclusions,
  referralOutcomesTable,
  stageDurationTables,
  volumeTable
} from "@hmcts/deed-poll";
import type { en } from "./content.js";

const LOCALE_TAG = { en: "en-GB", cy: "cy-GB" } as const;

export function reportView(report: Report, locale: keyof typeof LOCALE_TAG, content: Content): ReportView {
  const format = formatters(locale, content, report.query.granularity);
  return {
    volume: section("volume", content.volume, report.volume, (volume) => ({
      tables: [table(format, volumeTable(volume), content.volume.columns, content.volume.heading)],
      notes: [content.editedDates, content.volume.unknownTypeNote],
      exclusions: exclusionItems(miExclusions("volume", volume), content.volume.exclusions, format)
    })),
    stageDurations: section("stage-durations", content.stageDurations, report.stageDurations, (durations) => ({
      tables: stageDurationTables(durations).map((each) =>
        table(format, each, content.stageDurations.columns, content.stageDurations.intervals[each.interval])
      ),
      notes: [content.editedDates, content.stageDurations.missingDatesNote, content.stageDurations.furtherDocumentsNote],
      exclusions: [],
      exclusionTable: stageExclusionTable(miExclusions("stage-durations", durations), content, format)
    })),
    referralOutcomes: section("referral-outcomes", content.referralOutcomes, report.referralOutcomes, (outcomes) => ({
      tables: [table(format, referralOutcomesTable(outcomes), content.referralOutcomes.columns, content.referralOutcomes.heading)],
      notes: [content.editedDates, content.referralOutcomes.staffWithdrawalNote],
      exclusions: exclusionItems(miExclusions("referral-outcomes", outcomes), content.referralOutcomes.exclusions, format)
    })),
    completion: section("completion", content.completion, report.completion, (completion) => ({
      warning: content.completion.stillOpenWarning,
      tables: [table(format, completionTable(completion), content.completion.columns, content.completion.heading)],
      notes: [content.editedDates],
      exclusions: exclusionItems(miExclusions("completion", completion), content.completion.exclusions, format)
    }))
  };
}

function formatters(locale: keyof typeof LOCALE_TAG, content: Content, granularity: MiGranularity): Formatters {
  const count = new Intl.NumberFormat(LOCALE_TAG[locale]);
  const days = new Intl.NumberFormat(LOCALE_TAG[locale], { maximumFractionDigits: 1 });
  // A period's days are calendar days with no zone, so they are formatted as UTC midnight to keep the day they name.
  const day = new Intl.DateTimeFormat(LOCALE_TAG[locale], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return {
    content,
    periodHeading: content.periodHeadings[granularity],
    period: (start, end) => content.periodRange(day.format(new Date(`${start}T00:00:00Z`)), day.format(new Date(`${end}T00:00:00Z`))),
    cell: (column, value) => (value === null ? content.noCases : column.kind === "days" ? days.format(value) : count.format(value)),
    count: (value) => count.format(value)
  };
}

function section<T>(id: string, copy: SectionCopy, answer: T | null, build: (answer: T) => SectionBody): SectionView {
  const base = { id, heading: copy.heading, description: copy.description };
  return answer === null ? { ...base, unavailable: true } : { ...base, unavailable: false, ...build(answer) };
}

function table(format: Formatters, data: MiTable, headings: Record<string, string>, caption: string): TableView {
  return {
    caption,
    head: [{ text: format.periodHeading }, ...data.columns.map((column) => ({ text: headings[column.key], format: "numeric" }))],
    rows: data.rows.map((row) => [
      { text: format.period(row.start, row.end) },
      ...data.columns.map((column, index) => ({ text: format.cell(column, row.cells[index]), format: "numeric" }))
    ])
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

type SectionView = SectionCopy & { id: string } & ({ unavailable: true } | ({ unavailable: false } & SectionBody));

interface TableView {
  caption: string;
  head: { text: string; format?: string }[];
  rows: { text: string; format?: string }[][];
}

interface ExclusionItem {
  label: string;
  count: string;
}
