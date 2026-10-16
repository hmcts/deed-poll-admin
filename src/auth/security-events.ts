/**
 * Security events about the session: who signed in, who was signed out and why, who switched persona, who was
 * refused. They go to App Insights as `customEvents` through this one emitter, and nothing calls `trackEvent`
 * directly — see `docs/plans/20261015-security-events.md`.
 *
 * The names and the property keys are closed types, so an event cannot carry a key nobody reviewed. That matters
 * because the obvious keys are the wrong ones: never a token, secret, raw session id, cookie, email address,
 * display name or applicant data. Hence `route` is `baseUrl + path` and never `originalUrl` (a search's query
 * string carries names), `sid` is a hash prefix of the session id, and `subject` is the IDAM subject.
 *
 * This records the session only. api keeps the audit trail of writes and reads, and this app does not duplicate it.
 */
import { createHash } from "node:crypto";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import config from "config";
import type { Request } from "express";
import { sessionSubject } from "./session.js";

const SID_LENGTH = 16;

export function securityEvent(name: SecurityEventName, req: Request, props: SecurityEventProps = {}): void {
  const properties: SecurityEventProperties = {
    subject: sessionSubject(req),
    sid: req.sessionID ? sid(req.sessionID) : undefined,
    env: config.get<string>("environmentName"),
    method: req.method,
    route: `${req.baseUrl}${req.path}`,
    ...props
  };
  trackEvent(name, definedOnly(properties));
}

function sid(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, SID_LENGTH);
}

function definedOnly(properties: SecurityEventProperties): Record<string, string> {
  return Object.fromEntries(Object.entries(properties).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export type SecurityEventName =
  | "auth.login.succeeded"
  | "auth.login.failed"
  | "auth.logout"
  | "auth.session.ended"
  | "auth.persona.switched"
  | "auth.persona.switch_failed"
  | "authz.denied"
  | "csrf.refused";

export type LoginFailedReason = "idam_error" | "exchange_failed";

export type SessionEndedReason =
  | "no_refresh_token"
  | "no_subject"
  | "refresh_refused"
  | "refresh_failed_expired"
  | "subject_mismatch"
  | "api_401"
  | "idle"
  | "absolute"
  | "untimed";

/** The whole allowlist. An unknown key is a compile error. */
export interface SecurityEventProperties {
  subject?: string;
  fromSubject?: string;
  toSubject?: string;
  personaId?: string;
  sid?: string;
  outcome?: string;
  reason?: LoginFailedReason | SessionEndedReason;
  source?: "role" | "api";
  requiredCapability?: string;
  method?: string;
  route?: string;
  fetchSite?: string;
  originHost?: string;
  env?: string;
}

/** What a caller may give. The rest are filled in here, so a caller cannot record `originalUrl` as the route. */
export type SecurityEventProps = Omit<SecurityEventProperties, "sid" | "env" | "method" | "route">;
