/**
 * The session lifetime limits, which are the whole of OWASP plan 03's M7 fix.
 *
 * What is pinned is **which sessions end and how**. An idle or over-age session must be ended before anything else
 * runs, including the refresh that would otherwise renew it, and ended at IDAM too: a plain redirect to `/login`
 * looks equivalent locally, where the simulator keeps no session, and silently signs the user straight back in
 * anywhere else. `endSessionUrl` is stubbed because its URL-building is `idam.test.ts`'s subject.
 */
import { createHash } from "node:crypto";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import type { NextFunction } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageResponse, type RequestDouble, type ResponseDouble, sessionDouble } from "../express-doubles.js";
import { SessionWriteRefusedError } from "./guarded-session-store.js";
import { endSessionUrl } from "./idam.js";
import { sessionLifetime } from "./session-lifetime.js";

vi.mock("./idam.js", () => ({ endSessionUrl: vi.fn() }));
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));
vi.mock("./settings.js", () => ({ idamSettings: () => ({ redirectUri: "https://deed-poll-admin.aat.platform.hmcts.net/oauth2/callback" }) }));

const NOW = new Date("2026-10-14T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000, logoutPathRegistered: false };
const SESSION_ID = "a-timed-session-id";
const END_SESSION = "https://hmcts-access.aat.platform.hmcts.net/o/endSession?id_token_hint=an-id-token";

interface Options {
  method?: string;
  path?: string;
  signedIn?: boolean;
  authenticatedAt?: number;
  lastSeenAt?: number;
}

/** A signed-in session, active ten seconds ago and signed in an hour ago, unless told otherwise. */
function request({
  method = "GET",
  path = "/deed-polls/case-1",
  signedIn = true,
  authenticatedAt = NOW_SECONDS - 3600,
  lastSeenAt = NOW_SECONDS - 10
}: Options = {}): RequestDouble {
  const deedPoll = signedIn
    ? {
        user: { name: "A Caseworker" },
        subject: "idam-subject-1",
        idToken: "an-id-token",
        accessToken: "a-secret-access-token",
        authenticatedAt,
        lastSeenAt
      }
    : {};
  const req = { method, baseUrl: "", path, originalUrl: path, sessionID: SESSION_ID, session: sessionDouble(deedPoll) } as unknown as RequestDouble;
  // A timeout regenerates the session, and with it the id, so an event emitted afterwards would carry the new one.
  const regenerate = req.session.regenerate.getMockImplementation();
  req.session.regenerate.mockImplementation((done?: (error?: Error) => void) => {
    Object.assign(req, { sessionID: "the-fresh-anonymous-session-id" });
    regenerate?.(done);
  });
  return req;
}

async function run(req: RequestDouble, limits = LIMITS): Promise<{ res: ResponseDouble; next: NextFunction }> {
  const res = pageResponse();
  const next = vi.fn() as unknown as NextFunction;
  await sessionLifetime(limits)(req, res, next);
  return { res, next };
}

describe("sessionLifetime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    vi.mocked(endSessionUrl).mockResolvedValue(END_SESSION);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("a session within both limits", () => {
    it("should pass an anonymous request untouched", async () => {
      const req = request({ signedIn: false });

      const { next } = await run(req);

      expect(next).toHaveBeenCalledWith();
      expect(req.session.save).not.toHaveBeenCalled();
    });

    it("should record activity at most once a minute, so most requests write nothing", async () => {
      const req = request({ lastSeenAt: NOW_SECONDS - 59 });

      const { next } = await run(req);

      expect(next).toHaveBeenCalledWith();
      expect(req.session.save).not.toHaveBeenCalled();
      expect(req.session.deedPoll.lastSeenAt).toBe(NOW_SECONDS - 59);
    });

    // Saved before the request runs, so a slow request finishing late cannot write back stale tokens over a refresh.
    it("should save the new activity time before handing on, once a minute has passed", async () => {
      const req = request({ lastSeenAt: NOW_SECONDS - 60 });
      const order: string[] = [];
      req.session.save.mockImplementation((callback: () => void) => {
        order.push("save");
        callback();
      });
      const res = pageResponse();

      await sessionLifetime(LIMITS)(req, res, () => order.push("next"));

      expect(req.session.deedPoll.lastSeenAt).toBe(NOW_SECONDS);
      expect(order).toEqual(["save", "next"]);
    });

    it("should go on signed out, with no event, when the session was ended elsewhere before its activity saved", async () => {
      const req = request({ lastSeenAt: NOW_SECONDS - 600 });
      req.session.save.mockImplementation((callback: (error?: Error) => void) => callback(new SessionWriteRefusedError("missing")));

      const { res, next } = await run(req);

      expect(next).not.toHaveBeenCalled();
      expect(req.session.destroy).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls%2Fcase-1");
      expect(trackEvent).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/a-timed-session-id|a-secret-access-token|idam-subject-1/);
    });

    it("should still fail the request when the activity save fails for any other reason", async () => {
      const req = request({ lastSeenAt: NOW_SECONDS - 600 });
      req.session.save.mockImplementation((callback: (error?: Error) => void) => callback(new Error("Socket closed unexpectedly")));

      await expect(run(req)).rejects.toThrow("Socket closed unexpectedly");
      expect(req.session.destroy).not.toHaveBeenCalled();
    });

    it("should not count a public page as activity", async () => {
      const req = request({ path: "/cookies", lastSeenAt: NOW_SECONDS - 600 });

      await run(req);

      expect(req.session.deedPoll.lastSeenAt).toBe(NOW_SECONDS - 600);
    });
  });

  describe("a session past a limit", () => {
    it("should end an idle GET at IDAM too, returning to the root until the timed-out page is registered", async () => {
      const req = request({ lastSeenAt: NOW_SECONDS - 1800 });

      const { res, next } = await run(req);

      expect(endSessionUrl).toHaveBeenCalledWith(expect.anything(), "an-id-token", "/");
      expect(res.redirect).toHaveBeenCalledWith(END_SESSION);
      expect(next).not.toHaveBeenCalled();
      expect(req.session.regenerate).toHaveBeenCalled();
      expect(req.session.deedPoll.user).toBeUndefined();
      expect(req.session.deedPoll.accessToken).toBeUndefined();
    });

    it("should return to the timed-out page from IDAM once that address is registered", async () => {
      await run(request({ lastSeenAt: NOW_SECONDS - 1800 }), { ...LIMITS, logoutPathRegistered: true });

      expect(endSessionUrl).toHaveBeenCalledWith(expect.anything(), "an-id-token", "/session-timed-out");
    });

    it("should go straight to the timed-out page when IDAM advertises no end-session endpoint", async () => {
      vi.mocked(endSessionUrl).mockResolvedValue(undefined);

      const { res } = await run(request({ lastSeenAt: NOW_SECONDS - 1800 }));

      expect(res.redirect).toHaveBeenCalledWith("/session-timed-out");
    });

    it("should remember where an idle GET was going, in the fresh anonymous session", async () => {
      const req = request({ path: "/deed-polls/case-1?tab=notes", lastSeenAt: NOW_SECONDS - 1800 });

      await run(req);

      expect(req.session.deedPoll.timedOutReturnTo).toBe("/deed-polls/case-1?tab=notes");
    });

    it.each(["//evil.example/x", "/\\evil.example"])("should remember the root instead of %o", async (path) => {
      const req = request({ path, lastSeenAt: NOW_SECONDS - 1800 });

      await run(req);

      expect(req.session.deedPoll.timedOutReturnTo).toBe("/");
    });

    // Never replayed: the user may not be who submitted it, and the form state is gone with the session.
    it("should answer an idle POST with 401 and the timed-out page, saying nothing was saved", async () => {
      const req = request({ method: "POST", path: "/deed-polls/case-1/notes", lastSeenAt: NOW_SECONDS - 1800 });

      const { res, next } = await run(req);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.render).toHaveBeenCalledWith("session-timed-out/index", expect.objectContaining({ unsaved: true }));
      expect(next).not.toHaveBeenCalled();
      expect(req.session.deedPoll.user).toBeUndefined();
      expect(req.session.deedPoll.timedOutReturnTo).toBeUndefined();
    });

    // Not `/login`: the IDAM session usually outlives ours, so that link would sign whoever is at the PC back in.
    it("should make the POST page's sign-in link end the IDAM session first", async () => {
      const { res } = await run(request({ method: "POST", path: "/deed-polls/case-1/notes", lastSeenAt: NOW_SECONDS - 1800 }));

      expect(res.render).toHaveBeenCalledWith("session-timed-out/index", expect.objectContaining({ signInHref: END_SESSION }));
    });

    it("should end a session past the absolute limit, however recently it was active", async () => {
      const req = request({ authenticatedAt: NOW_SECONDS - 36_000, lastSeenAt: NOW_SECONDS - 5 });

      const { res } = await run(req);

      expect(res.redirect).toHaveBeenCalledWith(END_SESSION);
      expect(console.warn).toHaveBeenCalledWith("session ended: absolute");
    });

    it("should end a signed-in session with no timestamps rather than grandfather it", async () => {
      const req = request();
      delete req.session.deedPoll.authenticatedAt;

      const { res } = await run(req);

      expect(res.redirect).toHaveBeenCalledWith(END_SESSION);
      expect(console.warn).toHaveBeenCalledWith("session ended: untimed");
    });

    it("should log the reason as one plain line, with no token in it", async () => {
      await run(request({ lastSeenAt: NOW_SECONDS - 1800 }));

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith("session ended: idle");
    });
  });

  describe("its security events", () => {
    const ended = (reason: string, method = "GET") => [
      "auth.session.ended",
      {
        subject: "idam-subject-1",
        sid: createHash("sha256").update(SESSION_ID).digest("hex").slice(0, 16),
        env: "test",
        method,
        route: "/deed-polls/case-1",
        reason
      }
    ];

    it("should emit idle, with the subject and sid of the session being ended", async () => {
      await run(request({ lastSeenAt: NOW_SECONDS - 1800 }));

      expect(vi.mocked(trackEvent).mock.calls).toEqual([ended("idle")]);
    });

    it("should emit absolute for a session past the absolute limit, on a POST too", async () => {
      await run(request({ method: "POST", authenticatedAt: NOW_SECONDS - 36_000 }));

      expect(vi.mocked(trackEvent).mock.calls).toEqual([ended("absolute", "POST")]);
    });

    it("should emit untimed for a signed-in session with no timestamps", async () => {
      const req = request();
      Reflect.deleteProperty(req.session.deedPoll, "authenticatedAt");

      await run(req);

      expect(vi.mocked(trackEvent).mock.calls).toEqual([ended("untimed")]);
    });

    it("should emit nothing for a session within both limits", async () => {
      await run(request());

      expect(trackEvent).not.toHaveBeenCalled();
    });

    it("should put no token or raw session id in the event", async () => {
      await run(request({ lastSeenAt: NOW_SECONDS - 1800 }));

      const serialised = JSON.stringify(vi.mocked(trackEvent).mock.calls);
      for (const secret of ["an-id-token", "a-secret-access-token", "A Caseworker", SESSION_ID]) {
        expect(serialised).not.toContain(secret);
      }
    });
  });

  describe("what it tells the timeout warning", () => {
    it("should give a page the seconds left on each limit, after recording this request's activity", async () => {
      const req = request({ authenticatedAt: NOW_SECONDS - 3600, lastSeenAt: NOW_SECONDS - 120 });

      const { res } = await run(req);

      expect(res.locals.sessionClock).toEqual({ idleSeconds: 1800, idleRemaining: 1800, absoluteRemaining: 36_000 - 3600 });
    });

    // Read-only: the warning asks before declaring a timeout, and a question that answered by extending the session
    // or ending it would be the bug the warning exists to prevent.
    it("should report the time left on /session/status without recording activity or ending the session", async () => {
      const req = request({ path: "/session/status", lastSeenAt: NOW_SECONDS - 1700 });

      const { res, next } = await run(req);

      expect(next).toHaveBeenCalledWith();
      expect(req.session.deedPoll.lastSeenAt).toBe(NOW_SECONDS - 1700);
      expect(res.locals.sessionClock).toMatchObject({ idleRemaining: 100 });
    });

    it("should report no time left on /session/status for a session already past a limit, without ending it", async () => {
      const req = request({ path: "/session/status", lastSeenAt: NOW_SECONDS - 7200 });

      const { res } = await run(req);

      expect(res.locals.sessionClock).toMatchObject({ idleRemaining: 0 });
      expect(req.session.deedPoll.user).toBeDefined();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  // The routes a timed-out user needs, and the probes and assets that are not activity.
  it.each(["/logout", "/session-timed-out", "/health", "/health/readiness", "/assets/js/index.js"])(
    "should let %o through even for a session past its limits",
    async (path) => {
      const req = request({ path, lastSeenAt: NOW_SECONDS - 7200 });

      const { next } = await run(req);

      expect(next).toHaveBeenCalledWith();
      expect(req.session.deedPoll.user).toBeDefined();
      expect(req.session.deedPoll.lastSeenAt).toBe(NOW_SECONDS - 7200);
    }
  );
});
