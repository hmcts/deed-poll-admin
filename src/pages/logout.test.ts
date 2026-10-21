import { createHash } from "node:crypto";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { endSessionUrl } from "../auth/idam.js";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { GET } from "./logout.js";

vi.mock("../auth/idam.js", () => ({ endSessionUrl: vi.fn() }));
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));
vi.mock("../auth/settings.js", () => ({ idamSettings: () => ({ issuerUrl: "https://idam.example/o" }) }));

const AWAY = "https://idam.example/o/endSession?id_token_hint=an-id-token";

const SESSION_ID = "signed-in-session-id";

function signedIn() {
  const req = Object.assign(
    pageRequest({ teamLeader: true, name: "An Admin", idToken: "an-id-token", accessToken: "an-access-token", subject: "idam-subject-1" }),
    { sessionID: SESSION_ID, method: "GET", baseUrl: "", path: "/logout" }
  );
  // express-session drops the id along with the session, so an event emitted afterwards would carry no sid.
  const destroy = req.session.destroy.getMockImplementation();
  req.session.destroy.mockImplementation((done?: (error?: Error) => void) => {
    Reflect.deleteProperty(req, "sessionID");
    destroy?.(done);
  });
  return req;
}

describe("the logout page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(endSessionUrl).mockResolvedValue(AWAY);
  });

  it("destroys the local session", async () => {
    const req = signedIn();

    await GET(req, pageResponse());

    expect(req.session.destroy).toHaveBeenCalled();
    expect(req.session.deedPoll.user).toBeUndefined();
  });

  it("then sends the browser to IDAM to end that session too", async () => {
    const res = pageResponse();

    await GET(signedIn(), res);

    expect(res.redirect).toHaveBeenCalledWith(AWAY);
  });

  it("reads the id token before destroying the session, since destroying it removes the token", async () => {
    // Ordering, and it is easy to get wrong: taking the token after `signOut` would pass `undefined`
    // and IDAM would prompt the user to confirm which session to end.
    await GET(signedIn(), pageResponse());

    expect(vi.mocked(endSessionUrl).mock.calls[0][1]).toBe("an-id-token");
  });

  it("signs out locally even when the issuer advertises no end-session endpoint", async () => {
    // The local half is the half that matters, so say it is done rather than pretending the IDAM
    // session is gone as well.
    vi.mocked(endSessionUrl).mockResolvedValue(undefined);
    const req = signedIn();
    const res = pageResponse();

    await GET(req, res);

    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/");
  });

  it("tells the browser to drop its cached pages, on the way to IDAM and on the local fallback", async () => {
    // The Back button after sign-out is the one moment a cached case page becomes an exposure on a shared PC.
    // "cache" only: "cookies" would also wipe the cookie-consent choice.
    const toIdam = pageResponse();
    await GET(signedIn(), toIdam);
    vi.mocked(endSessionUrl).mockResolvedValue(undefined);
    const local = pageResponse();
    await GET(signedIn(), local);

    for (const res of [toIdam, local]) {
      expect(res.setHeader).toHaveBeenCalledWith("Clear-Site-Data", '"cache"');
      expect(res.setHeader.mock.invocationCallOrder[0]).toBeLessThan(res.redirect.mock.invocationCallOrder[0]);
    }
  });

  it("works for someone who is not signed in, rather than failing", async () => {
    // A bookmarked /logout, or a second click. Both should be harmless.
    const res = pageResponse();

    await GET(pageRequest({ signedIn: false }), res);

    expect(vi.mocked(endSessionUrl).mock.calls[0][1]).toBeUndefined();
    expect(res.redirect).toHaveBeenCalled();
  });

  describe("while IDAM discovery is failing", () => {
    // Review finding R04: the lookup used to throw past the header and the redirect, answering 500 to a user who
    // had in fact been signed out.
    beforeEach(() => {
      vi.mocked(endSessionUrl).mockRejectedValue(new Error("IDAM discovery failed recently"));
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("should still destroy the local session", async () => {
      const req = signedIn();

      await GET(req, pageResponse());

      expect(req.session.destroy).toHaveBeenCalled();
      expect(req.session.deedPoll.user).toBeUndefined();
    });

    it("should tell the browser to drop its cached pages and redirect to the service's own start page", async () => {
      const res = pageResponse();

      await GET(signedIn(), res);

      expect(res.setHeader).toHaveBeenCalledWith("Clear-Site-Data", '"cache"');
      expect(res.redirect).toHaveBeenCalledWith("/");
      expect(res.setHeader.mock.invocationCallOrder[0]).toBeLessThan(res.redirect.mock.invocationCallOrder[0]);
    });

    it("should emit auth.logout exactly once", async () => {
      await GET(signedIn(), pageResponse());

      expect(vi.mocked(trackEvent).mock.calls.map(([name]) => name)).toEqual(["auth.logout"]);
    });

    it("should ask IDAM only after the local session has gone", async () => {
      const req = signedIn();

      await GET(req, pageResponse());

      expect(req.session.destroy.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(endSessionUrl).mock.invocationCallOrder[0]);
    });
  });

  describe("security events", () => {
    it("should emit auth.logout with the subject and sid of the session being ended", async () => {
      await GET(signedIn(), pageResponse());

      expect(vi.mocked(trackEvent).mock.calls).toEqual([
        [
          "auth.logout",
          {
            subject: "idam-subject-1",
            sid: createHash("sha256").update(SESSION_ID).digest("hex").slice(0, 16),
            env: "test",
            method: "GET",
            route: "/logout"
          }
        ]
      ]);
    });

    it("should put no token, name or raw session id in the event", async () => {
      await GET(signedIn(), pageResponse());

      const serialised = JSON.stringify(vi.mocked(trackEvent).mock.calls);
      for (const secret of ["an-id-token", "an-access-token", "An Admin", SESSION_ID, "@"]) {
        expect(serialised).not.toContain(secret);
      }
    });
  });
});
