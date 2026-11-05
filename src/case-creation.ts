/**
 * Whether this deployment offers case creation: the case list's New case button and the form at
 * `/deed-polls/new`.
 *
 * Off in prod until the later migration phases (Steve, 2026-11-05). Migrated cases keep their Power App
 * references, and the Power App goes on allocating from its own sequence, so a reference api allocated
 * there would very likely duplicate a real Power App case. api refuses the create there itself with a 409
 * (`CASE_CREATION_ENABLED`, deed-poll-api#167), and that refusal is the control. This setting only stops the
 * page offering what api will refuse, and the form handles api's 409 in case the two settings ever disagree.
 *
 * `=== true` so that a value that did not parse as a boolean reads as off, the way the persona switcher's
 * flag does: a misconfigured prod must not offer a create.
 */
import config from "config";

export function caseCreationEnabled(): boolean {
  return config.get<boolean>("caseCreation.enabled") === true;
}
