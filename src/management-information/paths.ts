import type { ManagementInformationQuery, MiKpi } from "@hmcts/deed-poll";

export const MANAGEMENT_INFORMATION_PATH = "/deed-polls/management-information";

/**
 * A KPI's download, for the range the page resolved rather than the preset it was asked for, so a download made
 * after midnight still holds the rows the page showed (plan `docs/plans/completed/20261103-mi-dashboard-page.md`, A8).
 */
export function csvHref(kpi: MiKpi, query: ManagementInformationQuery): string {
  const search = new URLSearchParams({
    period: "custom",
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    includeMigrated: String(query.includeMigrated !== false)
  });
  return `${MANAGEMENT_INFORMATION_PATH}/${kpi}.csv?${search}`;
}
