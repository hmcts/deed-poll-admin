/**
 * The management information page's words (plan `docs/plans/20261103-mi-dashboard-page.md`). New copy awaiting
 * translation, so `cy` mirrors it and `yarn welsh:check` counts it. The filter errors are api's sentences and live
 * with the parser in `@hmcts/deed-poll`, like the case form's field errors.
 */

export const en = {
  title: "Management information",
  heading: "Management information",
  intro: "Figures for the deed poll service over a period you choose. Each section ends with a download of its figures.",
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
  migratedExcluded: "Cases migrated from the previous system are not included.",
  periodRange: (start: string, end: string) => `${start} to ${end}`,
  periodHeadings: { WEEK: "Week", MONTH: "Month", QUARTER: "Quarter" },
  noCases: "No cases",
  noPeriods: "There are no periods in this range.",
  unavailable: "These figures could not be loaded. Try again shortly.",
  tableRegion: (caption: string) => `${caption}, table`,
  and: "and",
  chartUnits: { WEEK: "week", MONTH: "month", QUARTER: "quarter" },
  chartSummary: (series: string, unit: string, from: string, to: string) =>
    `Line chart of ${series} for each ${unit} from ${from} to ${to}, with every figure in the table below.`,
  chartSummaryWithGaps: (series: string, unit: string, from: string, to: string) =>
    `Line chart of ${series} for each ${unit} from ${from} to ${to}, with a gap where a ${unit} had no cases and every figure in the table below.`,
  csv: { periodStart: "Period start", periodEnd: "Period end", stage: "Stage" },
  doesNotCountSummary: "What these figures do not count",
  editedDates: "The figures use each case’s dates as they are now. Staff can edit those dates, so the figures are not a history of when a date was entered.",
  volume: {
    heading: "Cases received and open",
    description: "Cases received in each period, by type, and the cases still open at the end of it.",
    download: "Download cases received and open (CSV)",
    columns: {
      received: "Received",
      "received:Adult": "Adult",
      "received:AdultTransgender": "Adult transgender",
      "received:Minor": "Minor",
      "received:MinorTransgender": "Minor transgender",
      "received:DeedOfRelinquishment": "Deed of relinquishment",
      "received:Unknown": "Unknown type",
      openAtEnd: "Open at end"
    },
    unknownTypeNote: "A case with no type is counted as unknown type.",
    exclusions: {
      noDateReceived: "Cases with no date received, which no period can hold",
      migrated: "Migrated cases left out"
    }
  },
  stageDurations: {
    heading: "How long each stage took",
    description:
      "Calendar days from one date to the next, counted in the period the stage ended in. Each median and 95th percentile is beside the number of cases it was taken over.",
    download: "Download stage durations (CSV)",
    intervals: {
      RECEIVED_TO_READY_FOR_MASTER: "Received to ready for a Master",
      READY_TO_REFERRED: "Ready for a Master to referred",
      REFERRED_TO_DECISION: "Referred to the Master’s decision",
      SIGNATURE_REQUESTED_TO_RECEIVED: "Signature requested to signature received",
      SIGNATURE_RECEIVED_TO_ENROLED: "Signature received to enrolled"
    },
    columns: { count: "Cases", medianDays: "Median days", p95Days: "95th percentile days" },
    missingDatesNote: "A stage with either of its dates missing is not counted, and is not listed below.",
    furtherDocumentsNote:
      "There is no figure for awaiting further documents: the case records when documents were asked for, but nothing records when they arrived.",
    exclusionsHeading: "Stages left out",
    exclusionColumns: { interval: "Stage", negativeInterval: "Ending before they started", migrated: "On migrated cases" }
  },
  referralOutcomes: {
    heading: "Referral outcomes",
    description: "The Masters’ decisions in each period, and the applicants’ responses to the Masters’ directions.",
    download: "Download referral outcomes (CSV)",
    columns: {
      approved: "Approved",
      approvedUrgent: "Approved, urgent",
      rejected: "Rejected",
      rejectedUrgent: "Rejected, urgent",
      confirmed: "Applicant confirmed",
      withdrawn: "Applicant withdrew"
    },
    staffWithdrawalNote: "A referral withdrawn by staff is not counted, because nothing records the day it was withdrawn.",
    exclusions: {
      decisionDateWithoutDecision: "Referrals with a decision date but no decision",
      confirmationWithoutOutcome: "Referrals with a confirmation date but no response",
      migratedDecisions: "Decisions on migrated cases left out",
      migratedConfirmations: "Confirmations on migrated cases left out"
    }
  },
  completion: {
    heading: "Time from receipt to completion",
    description: "Cases grouped by the period they were received in, with the calendar days from receipt to enrolment or return.",
    download: "Download time to completion (CSV)",
    stillOpenWarning: "Recent intake periods look faster because their slower cases are still open.",
    columns: {
      received: "Received",
      completed: "Completed",
      enroled: "Enrolled",
      returned: "Returned",
      stillOpen: "Still open",
      timed: "Cases timed",
      medianDays: "Median days",
      p95Days: "95th percentile days"
    },
    exclusions: {
      noDateReceived: "Cases with no date received, which no intake period can hold",
      contradiction: "Cases with both a date enrolled and a date returned, counted in none of the columns",
      negativeInterval: "Cases completed before their date received, counted as completed but not in the days",
      migrated: "Migrated cases left out"
    }
  }
};

export const cy = {
  ...en,
  errorSummaryTitle: "Mae problem wedi codi"
};
