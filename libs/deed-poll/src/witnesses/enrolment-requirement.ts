/**
 * How many witnesses a case needs before it can be sent for enrolment, how a page states the count, and
 * what an edit form warns before a save is attempted.
 *
 * **api enforces this; this is the presentation mirror.** `DeedPollService.requireWitnessesForEnrolment`
 * (deed-poll-api at `62c76f4`) refuses any write that leaves a case carrying an enrolment date with fewer
 * than `WITNESSES_REQUIRED_FOR_ENROLMENT` witnesses. Nothing here decides whether a case is enrollable —
 * it only decides what the page says, so a caseworker learns of the shortfall while looking at witnesses
 * rather than when a save is refused. If the two ever disagree, api wins and this is the bug.
 * See `docs/plans/07-witness-count-feedback.md`, decision 2.
 */
import type { TabDef } from "../deed-poll/form-fields.js";

/** Mirrors api's `DeedPollService.WITNESSES_REQUIRED_FOR_ENROLMENT`, so the number is named once here. */
export const WITNESSES_REQUIRED_FOR_ENROLMENT = 2;

/**
 * The fields api addresses the refusal to — `enrolmentDateToAddress` picks `dateEnroled` when the patch
 * sets it and `signatureReceivedDate` otherwise. A tab is warned because it carries one of these, rather
 * than because its id is in a list here: if a date moves tab, the warning moves with it.
 */
const ENROLMENT_DATE_FIELDS = ["signatureReceivedDate", "dateEnroled"];

/**
 * "1 of 2 witnesses recorded" — the shortfall, not the rule, so a caseworker reads what to do rather
 * than working it out.
 *
 * api sets no maximum, so a case can hold more witnesses than it needs, and "3 of 2" would read as a
 * defect rather than a count. Above the requirement the two numbers are stated apart instead.
 */
export function witnessCountText(recorded: number): string {
  if (recorded > WITNESSES_REQUIRED_FOR_ENROLMENT) {
    return `${recorded} witnesses recorded, ${WITNESSES_REQUIRED_FOR_ENROLMENT} required`;
  }

  return `${recorded} of ${WITNESSES_REQUIRED_FOR_ENROLMENT} witnesses recorded`;
}

/**
 * What an edit form says when the case is short of witnesses, or `null` when it has nothing to say — the
 * requirement is met, or this tab holds no enrolment date and no refusal has named one.
 *
 * **It states the case's condition, not an action the caseworker took.** api checks the rule against the
 * MERGED record, so a case that already carries an enrolment date is refused an edit to any field at all
 * while it is short — a surname will do it. Wording that said "you cannot enrol this" would be addressed
 * to an enrolment nobody attempted. See `docs/plans/07-witness-count-feedback.md`.
 *
 * The first clause is api's `ENROLMENT_WITNESSES_MESSAGE` so the proactive and reactive text cannot
 * contradict each other, differing only in writing the threshold as the constant rather than as the word
 * api spells out — the number must not be a literal here.
 *
 * `refusedFields` are the fields a rejected save's errors are addressed to, and are what makes the banner
 * reach the merged-record case. Editing a surname on a case that already carries an enrolment date is
 * refused, and api addresses that refusal to the date — a field with no control on the tab being edited,
 * so `buildErrorSummary` renders its message without a link. Without the banner there the caseworker is
 * told the count and offered no way to change it.
 */
export function enrolmentWitnessWarning(tab: TabDef, recorded: number, refusedFields: readonly string[] = []): string | null {
  if (recorded >= WITNESSES_REQUIRED_FOR_ENROLMENT) {
    return null;
  }

  // Not on every tab: the shortfall is not what a caseworker editing an address is being told about, and
  // a banner that appears everywhere is read nowhere. A refusal addressed to one of the dates is the
  // exception, because then it IS what the caseworker is being told about, whichever tab they are on.
  if (!carriesEnrolmentDate(tab) && !refusedFields.some((field) => ENROLMENT_DATE_FIELDS.includes(field))) {
    return null;
  }

  const missing = WITNESSES_REQUIRED_FOR_ENROLMENT - recorded;
  const toAdd = missing === 1 ? "1 more witness" : `${missing} more witnesses`;

  return (
    `${witnessCountText(recorded)}. A Deed Poll cannot be sent for enrolment until ` +
    `${WITNESSES_REQUIRED_FOR_ENROLMENT} witnesses have been recorded, so a case carrying an enrolment ` +
    `date cannot be saved while it is short. Add ${toAdd}.`
  );
}

function carriesEnrolmentDate(tab: TabDef): boolean {
  return tab.sections.some((section) => section.fields.some((field) => ENROLMENT_DATE_FIELDS.includes(field.name)));
}
