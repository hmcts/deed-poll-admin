import { createHash } from "node:crypto";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest } from "../express-doubles.js";
import { type SecurityEventName, securityEvent } from "./security-events.js";

vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const SESSION_ID = "s%3Araw-session-id-never-recorded";

function request(overrides: Record<string, unknown> = {}) {
  return Object.assign(pageRequest({ subject: "idam-subject-1" }), {
    sessionID: SESSION_ID,
    method: "POST",
    baseUrl: "/deed-polls",
    path: "/search",
    originalUrl: "/deed-polls/search?surname=Smith",
    url: "/search?surname=Smith",
    ...overrides
  });
}

function emitted(): { name: string; properties: Record<string, string> } {
  const [name, properties] = vi.mocked(trackEvent).mock.calls[0] as [string, Record<string, string>];
  return { name, properties };
}

describe("securityEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accept exactly the agreed vocabulary", () => {
    // The type-level half — that nothing else is a name — is in `security-events.test-d.ts`.
    const names: SecurityEventName[] = [
      "auth.login.succeeded",
      "auth.login.failed",
      "auth.logout",
      "auth.session.ended",
      "auth.persona.switched",
      "auth.persona.switch_failed",
      "authz.denied",
      "csrf.refused"
    ];

    for (const name of names) securityEvent(name, request());

    expect(vi.mocked(trackEvent).mock.calls.map(([name]) => name)).toEqual(names);
  });

  it("should fill in the subject, sid, env, method and route", () => {
    securityEvent("auth.logout", request());

    expect(emitted()).toEqual({
      name: "auth.logout",
      properties: {
        subject: "idam-subject-1",
        sid: createHash("sha256").update(SESSION_ID).digest("hex").slice(0, 16),
        env: "test",
        method: "POST",
        route: "/deed-polls/search"
      }
    });
  });

  it("should record a 16-hex-character sid that is never the raw session id", () => {
    securityEvent("auth.logout", request());

    const { sid } = emitted().properties;
    expect(sid).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain("raw-session-id");
  });

  it("should record the same sid for every event in one session, and a different one for another session", () => {
    securityEvent("auth.logout", request());
    securityEvent("authz.denied", request());
    securityEvent("authz.denied", request({ sessionID: "another-session" }));

    const sids = vi.mocked(trackEvent).mock.calls.map(([, properties]) => (properties as Record<string, string>).sid);
    expect(sids[0]).toBe(sids[1]);
    expect(sids[2]).not.toBe(sids[0]);
  });

  it("should drop the query string from the route, because a search's query carries names", () => {
    securityEvent("authz.denied", request());

    expect(emitted().properties.route).toBe("/deed-polls/search");
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain("Smith");
  });

  it("should take the caller's subject over the session's", () => {
    securityEvent("auth.persona.switched", request(), { subject: "new-subject", fromSubject: "idam-subject-1", toSubject: "new-subject" });

    expect(emitted().properties).toMatchObject({ subject: "new-subject", fromSubject: "idam-subject-1", toSubject: "new-subject" });
  });

  it("should pass the caller's properties through", () => {
    securityEvent("auth.session.ended", request(), { reason: "subject_mismatch" });

    expect(emitted().properties.reason).toBe("subject_mismatch");
  });

  it("should omit the subject and sid when the request has neither", () => {
    securityEvent("auth.login.failed", Object.assign(pageRequest({ signedIn: false }), { method: "GET", baseUrl: "", path: "/oauth2/callback" }), {
      reason: "idam_error"
    });

    expect(emitted().properties).toEqual({ env: "test", method: "GET", route: "/oauth2/callback", reason: "idam_error" });
  });
});
