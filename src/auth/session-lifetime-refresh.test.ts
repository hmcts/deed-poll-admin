/**
 * The lifetime limits and the token refresh together, in the order `createApp` mounts them.
 *
 * Each has its own tests, and `app.test.ts` pins the mount order. This pins what that order buys: a session past
 * its absolute limit whose token is due for renewal is ended, and IDAM is never asked to renew it. Mounted the other
 * way round the refresh would run first and the limit would be no limit (OWASP plan 03, Task 6). The control case
 * shows the same session within its limits does reach the refresh, so the first case cannot pass vacuously.
 *
 * The two lifetime paths pass the limits by design: the status question is answered rather than enforced, and the
 * timed-out page must render for a session that is over. So the refresh itself has to leave them alone, or a session
 * past its absolute limit would still be renewed at IDAM by the warning's poll (review finding R06).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageResponse, type RequestDouble, refreshCoordinatorDouble, sessionDouble } from "../express-doubles.js";
import { GET as statusPage } from "../pages/session/status.js";
import { GET as timedOutPage } from "../pages/session-timed-out/index.js";
import { fetchCallerAccess } from "./caller-access.js";
import { endSessionUrl, refreshTokens } from "./idam.js";
import { refreshMiddleware } from "./refresh-middleware.js";
import { STATUS_PATH, sessionLifetime, TIMED_OUT_PATH } from "./session-lifetime.js";

vi.mock("./idam.js", async (importOriginal) => ({
  describeIdamError: (await importOriginal<typeof import("./idam.js")>()).describeIdamError,
  endSessionUrl: vi.fn(async () => "https://hmcts-access.example/o/endSession"),
  refreshTokens: vi.fn()
}));
vi.mock("./caller-access.js", () => ({ fetchCallerAccess: vi.fn(async () => undefined) }));
vi.mock("./settings.js", () => ({ idamSettings: () => ({ redirectUri: "https://deed-poll-admin.example/oauth2/callback" }) }));

const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000, logoutPathRegistered: false };

function request(signedInSecondsAgo: number, path = "/deed-polls"): RequestDouble {
  const now = Math.floor(Date.now() / 1000);
  const session = sessionDouble({
    user: { name: "A Caseworker" },
    subject: "caseworker@example.com",
    idToken: "an-id-token",
    accessToken: "an-access-token",
    refreshToken: "a-refresh-token",
    // Two minutes left: inside the five-minute refresh window, so refreshMiddleware would renew it.
    tokenExpiresAt: now + 120,
    authenticatedAt: now - signedInSecondsAgo,
    lastSeenAt: now - 10
  });
  return { method: "GET", path, originalUrl: path, session, sessionStore: refreshCoordinatorDouble(), get: () => undefined } as unknown as RequestDouble;
}

/** Runs the handlers in order, as Express would, stopping where one does not call `next`. */
async function chain(handlers: RequestHandler[], req: Request, res: Response): Promise<boolean> {
  for (const handler of handlers) {
    let advanced = false;
    await handler(req, res, (() => {
      advanced = true;
    }) as NextFunction);
    if (!advanced) return false;
  }
  return true;
}

describe("the lifetime limits ahead of the token refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(refreshTokens).mockResolvedValue({
      ok: true,
      tokens: { accessToken: "a-new-access-token", refreshToken: "a-new-refresh-token", idToken: "a-new-id-token", expiresAt: 2_000_000_000 }
    } as never);
  });

  it("should end a session past its absolute limit without asking IDAM to renew its token", async () => {
    const req = request(36_000);
    const res = pageResponse();

    const reachedTheRouter = await chain([sessionLifetime(LIMITS), refreshMiddleware], req, res);

    expect(reachedTheRouter).toBe(false);
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(endSessionUrl).toHaveBeenCalled();
    expect(req.session.deedPoll.refreshToken).toBeUndefined();
  });

  it("should still renew the token of a session within its limits", async () => {
    const req = request(3600);

    const reachedTheRouter = await chain([sessionLifetime(LIMITS), refreshMiddleware], req, pageResponse());

    expect(reachedTheRouter).toBe(true);
    expect(refreshTokens).toHaveBeenCalled();
  });

  describe("on the lifetime paths, for a session past its absolute limit", () => {
    it("should answer the status question as before without renewing the token or asking /me", async () => {
      const req = request(36_060, STATUS_PATH);
      const res = Object.assign(pageResponse(), { json: vi.fn() });

      const reachedTheRouter = await chain([sessionLifetime(LIMITS), refreshMiddleware], req, res);
      statusPage(req, res);

      expect(reachedTheRouter).toBe(true);
      expect(res.json).toHaveBeenCalledWith({ idleSeconds: 1800, idleRemaining: 1790, absoluteRemaining: 0 });
      expect(refreshTokens).not.toHaveBeenCalled();
      expect(fetchCallerAccess).not.toHaveBeenCalled();
      expect(req.session.deedPoll).toMatchObject({ accessToken: "an-access-token", refreshToken: "a-refresh-token" });
    });

    it("should render the timed-out page as before without renewing the token or asking /me", async () => {
      const req = request(36_060, TIMED_OUT_PATH);
      const res = pageResponse();

      const reachedTheRouter = await chain([sessionLifetime(LIMITS), refreshMiddleware], req, res);
      timedOutPage(req, res);

      expect(reachedTheRouter).toBe(true);
      expect(res.render).toHaveBeenCalledWith("session-timed-out/index", expect.objectContaining({ unsaved: false }));
      expect(refreshTokens).not.toHaveBeenCalled();
      expect(fetchCallerAccess).not.toHaveBeenCalled();
      expect(req.session.deedPoll).toMatchObject({ accessToken: "an-access-token", refreshToken: "a-refresh-token" });
    });
  });
});
