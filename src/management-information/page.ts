/**
 * The management information page (plan `docs/plans/20261103-mi-dashboard-page.md`): one GET form of filters and the
 * four KPIs api publishes for them. The area is gated on `VIEW_MANAGEMENT_INFORMATION` in `app.ts`.
 *
 * The four reads are independent, so each degrades on its own to `null` and a log line, and the page says that KPI
 * could not be loaded. A 400 from any of them is the filters' fault and is shown against the form in api's words,
 * as the page's own validation is. A 401 or 403 is not a KPI's to degrade.
 */
import {
  type Caller,
  type FieldError,
  ForbiddenError,
  findMiCompletion,
  findMiReferralOutcomes,
  findMiStageDurations,
  findMiVolume,
  InvalidInputError,
  type ManagementInformationQuery,
  MI_PERIODS,
  type MiCompletion,
  type MiFilterValues,
  type MiReferralOutcomes,
  type MiStageDurations,
  type MiVolume,
  parseMiFilters,
  UnauthorizedError
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../auth/current-user.js";
import { forLog } from "../for-log.js";
import { cy, en } from "./content.js";

export const MANAGEMENT_INFORMATION_PATH = "/deed-polls/management-information";

// The form's controls in its order; an api error naming anything else is shown against the first.
const CONTROLS = ["period", "from", "to", "granularity", "includeMigrated"] as const;
const LONG_DAY = { en: dayFormat("en-GB"), cy: dayFormat("cy-GB") };

export async function showManagementInformation(req: Request, res: Response) {
  const filters = parseMiFilters(req.query as Record<string, unknown>, new Date());
  if (filters.query === null) return render(res, 400, filters.values, filters.errors, null);

  const report = await readReport(filters.query, callerFromRequest(req));
  if ("errors" in report) return render(res, 400, filters.values, report.errors, null);
  return render(res, 200, filters.values, [], report);
}

async function readReport(query: ManagementInformationQuery, caller: Caller): Promise<Report | { errors: FieldError[] }> {
  const [volume, stageDurations, referralOutcomes, completion] = await Promise.allSettled([
    findMiVolume(query, caller),
    findMiStageDurations(query, caller),
    findMiReferralOutcomes(query, caller),
    findMiCompletion(query, caller)
  ]);
  const settled = [volume, stageDurations, referralOutcomes, completion];
  for (const each of settled) {
    if (each.status === "rejected" && (each.reason instanceof UnauthorizedError || each.reason instanceof ForbiddenError)) throw each.reason;
  }
  const refused = settled.find((each) => each.status === "rejected" && each.reason instanceof InvalidInputError);
  if (refused?.status === "rejected") return { errors: apiErrors(refused.reason as InvalidInputError) };

  return {
    query,
    volume: degraded("volume", volume),
    stageDurations: degraded("stage durations", stageDurations),
    referralOutcomes: degraded("referral outcomes", referralOutcomes),
    completion: degraded("completion", completion)
  };
}

/** api names its fields as the form does; a refusal naming none, or another, still needs somewhere to point. */
function apiErrors(error: InvalidInputError): FieldError[] {
  if (error.errors.length === 0) return [{ field: CONTROLS[0], message: error.message }];
  return error.errors.map((each) => ((CONTROLS as readonly string[]).includes(each.field) ? each : { field: CONTROLS[0], message: each.message }));
}

function degraded<T>(name: string, result: PromiseSettledResult<T>): T | null {
  if (result.status === "fulfilled") return result.value;
  const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
  console.error(`management information ${name} read failed: ${forLog(message)}`);
  return null;
}

function render(res: Response, status: number, values: MiFilterValues, errors: FieldError[], report: Report | null) {
  const locale = res.locals.locale === "cy" ? "cy" : "en";
  const content = locale === "cy" ? cy : en;
  const fieldErrors = Object.fromEntries(errors.map((each) => [each.field, { text: each.message }]));
  res.status(status).render("deed-polls/management-information/index", {
    en,
    cy,
    action: MANAGEMENT_INFORMATION_PATH,
    values,
    periodItems: MI_PERIODS.map((period) => ({ value: period, text: content.periods[period], checked: values.period === period })),
    errorList: errors.map((each) => ({ text: each.message, href: `#${each.field}` })),
    fieldErrors,
    report,
    range: report
      ? {
          showing: content.rangeShowing(LONG_DAY[locale].format(utcDay(report.query.from)), LONG_DAY[locale].format(utcDay(report.query.to))),
          groupedBy: content.groupedBy[report.query.granularity],
          migrated: report.query.includeMigrated === false ? content.migratedExcluded : content.migratedIncluded
        }
      : null
  });
}

function dayFormat(locale: string): Intl.DateTimeFormat {
  // A range's days are calendar days with no zone, so they are formatted as UTC midnight to keep the day they name.
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Each KPI is api's answer, or null when its read failed and the page must say so. */
interface Report {
  query: ManagementInformationQuery;
  volume: MiVolume | null;
  stageDurations: MiStageDurations | null;
  referralOutcomes: MiReferralOutcomes | null;
  completion: MiCompletion | null;
}
