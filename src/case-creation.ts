/**
 * Whether this deployment offers case creation: the case list's New case button and the form at
 * `/deed-polls/new`.
 *
 * Enabled in every environment by the chart. The API enforces the matching setting and refuses creation
 * with 409 when disabled; the form handles that refusal if the two deployments disagree.
 *
 * `=== true` so a value that did not parse as a boolean reads as off.
 */
import config from "config";

export function caseCreationEnabled(): boolean {
  return config.get<boolean>("caseCreation.enabled") === true;
}
