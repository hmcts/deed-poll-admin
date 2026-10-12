import { can, OVERRIDE_PRIVACY } from "./capabilities.js";
import type { Role } from "./roles.js";
import { DEEDPOLL_JUDICIAL } from "./roles.js";

/**
 * Fallback author for a write with no identified user. Matches the service account the
 * source system records for automated/integration writes, so an unattributed write is
 * labelled as one rather than left blank.
 */
export const SERVICE_ACCOUNT_NAME = "# svc_HMCTS_LCPT_Dev";

/**
 * The authenticated caller, as far as the domain is concerned.
 *
 * Populated from the authenticated IDAM session by the app. Every session read normalises its roles
 * and rebuilds these derived flags; no request-supplied role header is trusted.
 *
 * `name` is only ever used as audit text (createdBy / modifiedBy), never for
 * authorisation — that is driven entirely by `roles` — so a wrong name cannot escalate
 * anything.
 */
export interface CurrentUser {
  roles: Role[];
  /** Compatibility adapter for privacy form/presentation code; use can for other capabilities. */
  isAdmin: boolean;
  /**
   * Whether this caller is a judge, and so may reach `/judicial/**`.
   *
   * Alongside `isAdmin` rather than derived from it, because the two personas are alternatives: a judge
   * is not a privileged caseworker (the judicial api surface returns a *narrower* view of an application
   * than any caseworker sees), so neither flag implies the other and a caller may hold both, one or
   * neither. The gate this feeds is a UI boundary — api gates every `/judicial/**` route on the same role
   * itself — so a wrong value here shows the wrong chrome, never the wrong data.
   */
  isJudicial: boolean;
  name: string;
}

/** Build a CurrentUser from a resolved set of roles and an optional display name. */
export function currentUser(roles: Role[], name?: string | null): CurrentUser {
  const trimmed = (name ?? "").trim();
  return {
    roles,
    isAdmin: can({ roles }, OVERRIDE_PRIVACY),
    isJudicial: roles.includes(DEEDPOLL_JUDICIAL),
    name: trimmed.length > 0 ? trimmed : SERVICE_ACCOUNT_NAME
  };
}
