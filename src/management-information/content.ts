/**
 * The management information page's words (plan `docs/plans/20261103-mi-dashboard-page.md`). New copy awaiting
 * translation, so `cy` mirrors it and `yarn welsh:check` counts it. The filter errors are api's sentences and live
 * with the parser in `@hmcts/deed-poll`, like the case form's field errors.
 */

export const en = {
  title: "Management information",
  heading: "Management information",
  intro: "Figures for the deed poll service over a period you choose. Each table is followed by a download of the same rows.",
  errorSummaryTitle: "There is a problem",
  filtersHeading: "Choose the figures",
  periodLegend: "Period",
  periods: {
    "7-days": "Last 7 days",
    "30-days": "Last 30 days",
    "60-days": "Last 60 days",
    "90-days": "Last 90 days",
    year: "Last year",
    custom: "Choose the dates"
  },
  fromLabel: "First day",
  toLabel: "Last day",
  dateHint: "For example, 2026-10-01",
  granularityLegend: "Group the figures by",
  granularityHint: "If you do not choose, periods of up to 90 days are grouped by week and longer ones by month.",
  granularities: { WEEK: "Week", MONTH: "Month", QUARTER: "Quarter" },
  includeMigratedLegend: "Include cases migrated from the previous system",
  yes: "Yes",
  no: "No",
  submit: "Show figures",
  rangeShowing: (from: string, to: string) => `Showing ${from} to ${to}`,
  groupedBy: { WEEK: "grouped by week", MONTH: "grouped by month", QUARTER: "grouped by quarter" },
  migratedIncluded: "Cases migrated from the previous system are included.",
  migratedExcluded: "Cases migrated from the previous system are not included."
};

export const cy = {
  ...en,
  errorSummaryTitle: "Mae problem wedi codi"
};
