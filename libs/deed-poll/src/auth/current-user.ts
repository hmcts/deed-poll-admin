import { type CallerAccess, callerAccessFrom, OVERRIDE_PRIVACY } from "./capabilities.js";

/**
 * Fallback author for a write with no identified user. Matches the service account the
 * source system records for automated/integration writes, so an unattributed write is
 * labelled as one rather than left blank.
 */
export const SERVICE_ACCOUNT_NAME = "# svc_HMCTS_LCPT_Dev";

/**
 * The authenticated caller, as far as the domain is concerned.
 *
 * `staff`, `judicial` and `capabilities` are api's `GET /me` answer, which api resolves from AM. This app keeps no
 * mapping from roles to any of them. Every session read revalidates the answer and rebuilds the derived flags, so a
 * stored flag is never what a decision is made from.
 *
 * `name` is only ever used as audit text (createdBy / modifiedBy), never for authorisation, so a wrong name cannot
 * escalate anything.
 */
export interface CurrentUser extends CallerAccess {
  /** Compatibility adapter for privacy form/presentation code; use can for other capabilities. */
  isAdmin: boolean;
  /**
   * Whether this caller is a judge, and so may reach `/judicial/**`.
   *
   * Not derived from `isAdmin`, because the two personas are alternatives: a judge is not a privileged caseworker
   * (the judicial api surface returns a *narrower* view of an application than any caseworker sees), so a caller
   * may hold both, one or neither. The gate this feeds is a UI boundary — api gates every `/judicial/**` route
   * itself — so a wrong value here shows the wrong chrome, never the wrong data.
   */
  isJudicial: boolean;
  name: string;
}

/** Build a CurrentUser from an unvalidated `/me` answer, which fails closed, and an optional display name. */
export function currentUser(access: unknown, name?: string | null): CurrentUser {
  const { staff, judicial, capabilities } = callerAccessFrom(access);
  const trimmed = (name ?? "").trim();
  return {
    staff,
    judicial,
    capabilities,
    isAdmin: capabilities.includes(OVERRIDE_PRIVACY),
    isJudicial: judicial,
    name: trimmed.length > 0 ? trimmed : SERVICE_ACCOUNT_NAME
  };
}
