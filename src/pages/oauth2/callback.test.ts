import { createHash } from "node:crypto";
import { currentUser, OVERRIDE_PRIVACY } from "@hmcts/deed-poll";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callbackUrl, completeLogin } from "../../auth/idam.js";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./callback.js";

vi.mock("../../auth/idam.js", async (importOriginal) => ({
  describeIdamError: (await importOriginal<typeof import("../../auth/idam.js")>()).describeIdamError,
  completeLogin: vi.fn(),
  callbackUrl: vi.fn(() => new URL("http://localhost:3000/oauth2/callback?code=abc&state=a-state"))
}));
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));
vi.mock("../../auth/settings.js", () => ({ idamSettings: () => ({ issuerUrl: "https://idam.example/o" }) }));

const FLOW = { codeVerifier: "a-verifier", state: "a-state", returnTo: "/deed-polls/case-1" };

const PRE_LOGIN_SESSION_ID = "pre-login-session-id";
const SIGNED_IN_SESSION_ID = "signed-in-session-id";

function callback(options: Parameters<typeof pageRequest>[0] = {}) {
  const req = Object.assign(pageRequest({ signedIn: false, flow: FLOW, originalUrl: "/oauth2/callback?code=abc&state=a-state", ...options }), {
    sessionID: PRE_LOGIN_SESSION_ID,
    method: "GET",
    baseUrl: "",
    path: "/oauth2/callback"
  });
  // express-session gives the regenerated session a new id, which is the one a signed-in event must carry.
  const regenerate = req.session.regenerate.getMockImplementation();
  req.session.regenerate.mockImplementation((done?: (error?: Error) => void) => {
    req.sessionID = SIGNED_IN_SESSION_ID;
    regenerate?.(done);
  });
  return req;
}

function sid(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

function events(): [string, Record<string, string>][] {
  return vi.mocked(trackEvent).mock.calls as [string, Record<string, string>][];
}

describe("the IDAM callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(completeLogin).mockResolvedValue({
      user: currentUser({ staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY] }, "A Team leader"),
      subject: "idam-subject-1",
      tokens: {
        idToken: "an-id-token",
        accessToken: "an-access-token",
        refreshToken: "a-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      }
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("signs the user in and sends them where they were heading", async () => {
    const req = callback();
    const res = pageResponse();

    await GET(req, res);

    expect(req.session.deedPoll.user).toMatchObject({ isAdmin: true, name: "A Team leader" });
    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1");
  });

  it("stores the id token, so logout can end the IDAM session too", async () => {
    const req = callback();

    await GET(req, pageResponse());

    expect(req.session.deedPoll.idToken).toBe("an-id-token");
  });

  it("regenerates the session id, so a planted cookie cannot become an authenticated one", async () => {
    const req = callback();

    await GET(req, pageResponse());

    expect(req.session.regenerate).toHaveBeenCalled();
  });

  it("exchanges the code against the flow held in the session, not anything from the request", async () => {
    const req = callback();

    await GET(req, pageResponse());

    expect(completeLogin).toHaveBeenCalledWith(expect.anything(), FLOW, expect.any(URL));
    expect(callbackUrl).toHaveBeenCalled();
  });

  it("consumes the flow, so the same code cannot be redeemed twice", async () => {
    const req = callback();

    await GET(req, pageResponse());

    expect(req.session.deedPoll.flow).toBeUndefined();
  });

  describe("when there is no flow in the session", () => {
    it("sends the user to start again rather than failing", async () => {
      // A bookmarked callback, a replayed code, or a session that expired mid-login. None is worth a
      // stack trace and all are fixed by starting over.
      const res = pageResponse();

      await GET(callback({ flow: undefined }), res);

      expect(res.redirect).toHaveBeenCalledWith("/login");
      expect(completeLogin).not.toHaveBeenCalled();
    });
  });

  describe("when IDAM reports a refusal", () => {
    it("renders a 403 with the reason rather than attempting an exchange", async () => {
      // IDAM signals a refusal by redirecting here with ?error=, not by failing the exchange. Without
      // this the exchange would fail on a missing `code` and report a server fault for what is usually
      // the user declining.
      const res = pageResponse();

      await GET(callback({ query: { error: "access_denied", error_description: "User declined" } }), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.render).toHaveBeenCalledWith("errors/403", { reason: "User declined" });
      expect(completeLogin).not.toHaveBeenCalled();
    });

    it("falls back to the error code when there is no description", async () => {
      const res = pageResponse();

      await GET(callback({ query: { error: "access_denied" } }), res);

      expect(res.render).toHaveBeenCalledWith("errors/403", { reason: "access_denied" });
    });

    it("still consumes the flow, so the abandoned attempt cannot be resumed", async () => {
      const req = callback({ query: { error: "access_denied" } });

      await GET(req, pageResponse());

      expect(req.session.deedPoll.flow).toBeUndefined();
    });
  });

  describe("when the exchange fails", () => {
    beforeEach(() => {
      vi.mocked(completeLogin).mockRejectedValue(new Error("unexpected state parameter"));
    });

    it("renders a 403 rather than a 500", async () => {
      // A forged `state` is the security check working. Letting it propagate reported a server fault
      // for it, which is the same mistake the upload parser made — hence catching it here at the
      // source rather than leaving it to error middleware.
      const res = pageResponse();

      await GET(callback(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.render).toHaveBeenCalledWith("errors/403");
    });

    it("signs nobody in", async () => {
      const req = callback();

      await GET(req, pageResponse());

      expect(req.session.deedPoll.user).toBeUndefined();
    });

    it("logs the real reason, since 'nobody can log in' reads differently to an operator", async () => {
      // Only the log distinguishes a forgery from a misconfigured client secret or an outage.
      await GET(callback(), pageResponse());

      expect(console.error).toHaveBeenCalledWith("IDAM authorization code exchange failed:", expect.objectContaining({ name: "Error" }));
    });

    it("does not put the reason in front of the user", async () => {
      const res = pageResponse();

      await GET(callback(), res);

      expect(res.render).toHaveBeenCalledWith("errors/403");
      expect(res.render.mock.calls[0][1]).toBeUndefined();
    });
  });

  describe("security events", () => {
    it("should emit auth.login.succeeded with the new session's subject and sid", async () => {
      await GET(callback(), pageResponse());

      expect(events()).toEqual([
        ["auth.login.succeeded", { subject: "idam-subject-1", sid: sid(SIGNED_IN_SESSION_ID), env: "test", method: "GET", route: "/oauth2/callback" }]
      ]);
    });

    it("should emit auth.login.failed with IDAM's error code and never its description", async () => {
      await GET(callback({ query: { error: "access_denied", error_description: "User jane@example.com declined" } }), pageResponse());

      expect(events()).toEqual([
        [
          "auth.login.failed",
          { sid: sid(PRE_LOGIN_SESSION_ID), env: "test", method: "GET", route: "/oauth2/callback", reason: "idam_error", outcome: "access_denied" }
        ]
      ]);
      expect(JSON.stringify(events())).not.toContain("declined");
    });

    it("should record an error code that is not one IDAM could send as unrecognised", async () => {
      // The query is the browser's to write, so a crafted value must not reach the event as free text.
      await GET(callback({ query: { error: "access_denied\nforged: line" } }), pageResponse());

      expect(events()[0][1].outcome).toBe("unrecognised");
    });

    it("should emit auth.login.failed when the code exchange fails", async () => {
      vi.mocked(completeLogin).mockRejectedValue(new Error("unexpected state parameter"));

      await GET(callback(), pageResponse());

      expect(events()).toEqual([
        ["auth.login.failed", { sid: sid(PRE_LOGIN_SESSION_ID), env: "test", method: "GET", route: "/oauth2/callback", reason: "exchange_failed" }]
      ]);
    });

    it("should emit nothing when there is no flow, because no login was attempted", async () => {
      await GET(callback({ flow: undefined }), pageResponse());

      expect(trackEvent).not.toHaveBeenCalled();
    });

    it("should put no token, name or raw session id in any event", async () => {
      await GET(callback(), pageResponse());

      const serialised = JSON.stringify(events());
      for (const secret of ["an-id-token", "an-access-token", "a-refresh-token", "A Team leader", SIGNED_IN_SESSION_ID, "@"]) {
        expect(serialised).not.toContain(secret);
      }
    });
  });
});
