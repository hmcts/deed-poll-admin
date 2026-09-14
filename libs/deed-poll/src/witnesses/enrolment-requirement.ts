/**
 * How many witnesses a case needs before it can be sent for enrolment, and how a page states the count.
 *
 * **api enforces this; this is the presentation mirror.** `DeedPollService.requireWitnessesForEnrolment`
 * (deed-poll-api at `62c76f4`) refuses any write that leaves a case carrying an enrolment date with fewer
 * than `WITNESSES_REQUIRED_FOR_ENROLMENT` witnesses. Nothing here decides whether a case is enrollable —
 * it only decides what the page says, so a caseworker learns of the shortfall while looking at witnesses
 * rather than when a save is refused. If the two ever disagree, api wins and this is the bug.
 * See `docs/plans/07-witness-count-feedback.md`, decision 2.
 */

/** Mirrors api's `DeedPollService.WITNESSES_REQUIRED_FOR_ENROLMENT`, so the number is named once here. */
export const WITNESSES_REQUIRED_FOR_ENROLMENT = 2;

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
