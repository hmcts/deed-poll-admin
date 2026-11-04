/**
 * The management information downloads (plan `docs/plans/20261103-mi-dashboard-page.md`, decision A8): one route per
 * KPI, behind the page's gate, reading the page's query string and holding exactly its table's rows. Each figure is
 * api's, unformatted; a percentile keeps the count it was taken over beside it, and an empty bucket is an empty cell.
 *
 * A download has no partial state to degrade to, so a failed read is the error page. Unusable filters, whether this
 * app or api found them, redraw the page's form with the errors, as the page itself would.
 */
import {
  type Caller,
  completionTable,
  findMiCompletion,
  findMiReferralOutcomes,
  findMiStageDurations,
  findMiVolume,
  InvalidInputError,
  type ManagementInformationQuery,
  type MiKpi,
  type MiRow,
  type MiTable,
  parseMiFilters,
  referralOutcomesTable,
  stageDurationTables,
  volumeTable
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../auth/current-user.js";
import { cy, en } from "./content.js";
import { type CsvCell, toCsv } from "./csv.js";
import { apiFilterErrors, refuseFilters } from "./page.js";

export function downloadManagementInformation(kpi: MiKpi) {
  return async (req: Request, res: Response) => {
    const filters = parseMiFilters(req.query as Record<string, unknown>, new Date());
    if (filters.query === null) return refuseFilters(res, filters.values, filters.errors);

    let rows: CsvCell[][];
    try {
      rows = await readRows(kpi, filters.query, callerFromRequest(req), res.locals.locale === "cy" ? cy : en);
    } catch (error) {
      if (error instanceof InvalidInputError) return refuseFilters(res, filters.values, apiFilterErrors(error));
      throw error;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="deed-poll-mi-${kpi}-${filters.query.from}-${filters.query.to}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(toCsv(rows));
  };
}

async function readRows(kpi: MiKpi, query: ManagementInformationQuery, caller: Caller, content: Content): Promise<CsvCell[][]> {
  const period = [content.csv.periodStart, content.csv.periodEnd];
  switch (kpi) {
    case "volume":
      return tableRows(period, volumeTable(await findMiVolume(query, caller)), content.volume.columns);
    case "stage-durations": {
      const tables = stageDurationTables(await findMiStageDurations(query, caller));
      const head = [content.csv.stage, ...period, ...tables[0].columns.map((column) => content.stageDurations.columns[column.key as "count"])];
      return [head, ...tables.flatMap((table) => table.rows.map((row) => [content.stageDurations.intervals[table.interval], ...cellsOf(row)]))];
    }
    case "referral-outcomes":
      return tableRows(period, referralOutcomesTable(await findMiReferralOutcomes(query, caller)), content.referralOutcomes.columns);
    case "completion":
      return tableRows(period, completionTable(await findMiCompletion(query, caller)), content.completion.columns);
  }
}

function tableRows(period: string[], table: MiTable, headings: Record<string, string>): CsvCell[][] {
  return [[...period, ...table.columns.map((column) => headings[column.key])], ...table.rows.map(cellsOf)];
}

function cellsOf(row: MiRow): CsvCell[] {
  return [row.start, row.end, ...row.cells];
}

type Content = typeof en;
