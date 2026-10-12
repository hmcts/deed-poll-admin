/**
 * The refresh gate, which had **no tests at all** until this file.
 *
 * That absence is why the missing-`id_token` defect survived: `refreshTokens` threw on a refresh
 * response without one, this middleware caught the throw as transient and called `next()`, and the
 * session then expired on schedule as though refresh had never been implemented. Nothing failed and
 * nothing was reported.
 *
 * The distinction this file exists to pin is therefore **which failures end a session and which do
 * not**. A revoked token and a substituted subject must sign the user out; IDAM being unreachable must
 * not, because signing everyone out during a blip is a worse outcome than a session expiring on time.
 * `refreshTokens` is stubbed here, since its own behaviour is covered in `idam.test.ts`.
 */
import type { NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageResponse, type RequestDouble, type ResponseDouble, sessionDouble } from "../express-doubles.js";
import { refreshTokens } from "./idam.js";
import { refreshMiddleware } from "./refresh-middleware.js";

vi.mock("./idam.js", async (importOriginal) => ({
  describeIdamError: (await importOriginal<typeof import("./idam.js")>()).describeIdamError,
  refreshTokens: vi.fn()
}));

vi.mock("./settings.js", () => ({
  idamSettings: () => ({
    issuerUrl: "https://hmcts-access.aat.platform.hmcts.net/o",
    clientId: "deed-poll-admin",
    clientSecret: "a-secret",
    redirectUri: "https://deed-poll-admin.aat.platform.hmcts.net/oauth2/callback",
    scope: "openid profile roles offline_access"
  })
}));

const SUBJECT = "admin@example.com";

/** Seconds from now, so a test can put the token inside or outside the refresh window explicitly. */
function expiringIn(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

interface SessionState {
  user?: unknown;
  subject?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

/**
 * A signed-in session inside the refresh window, with named fields **removed** rather than overridden.
 *
 * Absence is the interesting input here: three of the branches under test are "this field is missing".
 * Naming the fields to drop says that directly, and produces a session object where the key genuinely
 * is not there, which is what a real one looks like.
 *
 * **The `overrides` route cannot express absence, and the reason is worth knowing** because the first
 * version of this helper got it wrong. Object spread does honour an explicit `undefined` — it sets the
 * key to `undefined` rather than keeping the default — but a **destructuring default does not**:
 * `function f({ subject = SUBJECT })` called with `{ subject: undefined }` yields `SUBJECT`. This helper
 * originally destructured with per-field defaults, so `request({ subject: undefined })` silently tested
 * a session that *had* a subject, and the sign-out branch it was meant to cover was never reached. The
 * same trap cost a test in `idam.test.ts`, where `expiresIn` is now a required parameter for it.
 */
function request(without: (keyof SessionState)[] = [], overrides: SessionState = {}): RequestDouble {
  const deedPoll: SessionState = {
    user: { roles: [], isAdmin: false, name: "An Admin" },
    subject: SUBJECT,
    refreshToken: "a-refresh-token",
    tokenExpiresAt: expiringIn(60),
    ...overrides
  };

  for (const field of without) delete deedPoll[field];

  return {
    originalUrl: "/deed-polls",
    session: sessionDouble(deedPoll as Record<string, unknown>)
  } as unknown as RequestDouble;
}

let next: NextFunction;
let res: ResponseDouble;

beforeEach(() => {
  vi.clearAllMocks();
  next = vi.fn();
  res = pageResponse();
  vi.mocked(refreshTokens).mockResolvedValue({ accessToken: "a-new-access-token", refreshToken: "a-refresh-token", expiresAt: expiringIn(900) });
});

describe("refreshMiddleware", () => {
  it("refreshes when the token is inside the window, and stores what came back", async () => {
    const req = request([], { tokenExpiresAt: expiringIn(60) });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).toHaveBeenCalledWith(expect.anything(), "a-refresh-token", SUBJECT);
    expect((req.session.deedPoll as SessionState).tokenExpiresAt).toBeGreaterThan(expiringIn(600));
    expect(next).toHaveBeenCalled();
  });

  it("does nothing while the token still has time", async () => {
    // Refreshing on every request would put IDAM in the path of every page load.
    await refreshMiddleware(request([], { tokenExpiresAt: expiringIn(3600) }), res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("refreshes an already-expired token rather than giving up on it", async () => {
    // The refresh token outlives the access token, so an expired access token is still recoverable —
    // and a user returning to a tab after lunch is the ordinary case, not an edge one.
    await refreshMiddleware(request([], { tokenExpiresAt: expiringIn(-30) }), res, next);

    expect(refreshTokens).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("passes through when nobody is signed in", async () => {
    await refreshMiddleware(request(["user"]), res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("passes through when there is no refresh token to use", async () => {
    // IDAM issues one only if `offline_access` was granted. Its absence is not an error — the session
    // simply cannot be extended and will expire.
    await refreshMiddleware(request(["refreshToken"]), res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("signs out when the token has expired and there is no refresh token to recover it with", async () => {
    // The pass-through above is right only while the token still works. Once it has expired there is
    // nothing left to expire naturally: every case page presents it to api, which answers 401, which
    // `errors.ts` can only meet with a sign-in-again page. Known before any page runs, so it is ended here.
    const req = request(["refreshToken"], { tokenExpiresAt: expiringIn(-30) });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
    expect(next).not.toHaveBeenCalled();
  });

  it("signs out a session with no recorded subject, rather than refreshing unchecked", async () => {
    // Only reachable for a session created before the subject was stored. What cannot be verified is
    // refused, which is the same polarity as every other auth decision in this app.
    const req = request(["subject"]);

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
    expect(next).not.toHaveBeenCalled();
  });

  it("signs out when the refresh is refused", async () => {
    // `refreshTokens` answers undefined for a revoked or expired token and for a response naming a
    // different subject. Both mean this session is over, so neither may continue into the request.
    vi.mocked(refreshTokens).mockResolvedValue(undefined);
    const req = request();

    await refreshMiddleware(req, res, next);

    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
    expect(next).not.toHaveBeenCalled();
  });

  it("continues the request when the refresh throws, rather than signing everyone out", async () => {
    // IDAM unreachable is our problem, not the user's credentials. The existing token may still be
    // valid, and treating an outage as a revocation would boot every signed-in user during a blip.
    vi.mocked(refreshTokens).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));
    const req = request();

    await refreshMiddleware(req, res, next);

    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("signs out when the refresh throws and the access token has already expired", async () => {
    // The cutover made the token load-bearing: every case page presents it to api, which answers 401,
    // which reaches the 500 page with no route back to /login. Continuing is only defensible while the
    // token still works, so an expired one ends the session rather than looping through a 500 per page.
    vi.mocked(refreshTokens).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));
    const req = request([], { tokenExpiresAt: expiringIn(-30) });

    await refreshMiddleware(req, res, next);

    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps the user signed in across a refresh", async () => {
    // The session is not regenerated on refresh — the user was already authenticated — so a refresh
    // that dropped the user would log them out by accident.
    const req = request();

    await refreshMiddleware(req, res, next);

    expect((req.session.deedPoll as SessionState).user).toBeDefined();
  });

  it("carries the attempted URL into the login redirect, so the user lands where they were going", async () => {
    vi.mocked(refreshTokens).mockResolvedValue(undefined);
    const req = { ...request(), originalUrl: "/deed-polls/case-1/notes" } as RequestDouble;

    await refreshMiddleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls%2Fcase-1%2Fnotes");
  });
});
