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
 * `refreshTokens` is stubbed here, since its own behaviour is covered in `idam.test.ts`, and so is
 * `fetchCallerAccess`, whose failure is already its `undefined`.
 */
import { createHash } from "node:crypto";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import type { NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageResponse, type RequestDouble, type ResponseDouble, refreshCoordinatorDouble, sessionDouble } from "../express-doubles.js";
import { fetchCallerAccess } from "./caller-access.js";
import { SessionWriteRefusedError } from "./guarded-session-store.js";
import { refreshTokens } from "./idam.js";
import { refreshMiddleware } from "./refresh-middleware.js";

vi.mock("./idam.js", async (importOriginal) => ({
  describeIdamError: (await importOriginal<typeof import("./idam.js")>()).describeIdamError,
  refreshTokens: vi.fn()
}));

vi.mock("./caller-access.js", () => ({ fetchCallerAccess: vi.fn() }));

vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
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

const SUBJECT = "idam-subject-1";
const SESSION_ID = "a-refreshing-session-id";
const REFUSED = { ok: false, reason: "invalid_grant" } as const;
const TEAM_LEADER = {
  staff: true,
  judicial: false,
  capabilities: ["OVERRIDE_PRIVACY", "DELETE_NOTE", "DELETE_WITNESS", "MANAGE_SHARED_QUERIES", "REPAIR_CCD"]
};
const DELIVERY_MANAGER = { ...TEAM_LEADER, capabilities: [...TEAM_LEADER.capabilities, "ACCESS_GAZETTE"] };
/** A session saved before admin read `/me`: it holds roles and stale flags, and no answer. */
const ROLES_ERA_USER = { roles: ["caseworker-deedpoll-delivery-manager"], isAdmin: true, isJudicial: false, name: "An Admin" };

/** Seconds from now, so a test can put the token inside or outside the refresh window explicitly. */
function expiringIn(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

interface SessionState {
  user?: unknown;
  subject?: string;
  accessToken?: string;
  authenticatedAt?: number;
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
    user: { staff: false, judicial: false, capabilities: [], isAdmin: false, isJudicial: false, name: "An Admin" },
    subject: SUBJECT,
    refreshToken: "a-refresh-token",
    tokenExpiresAt: expiringIn(60),
    ...overrides
  };

  for (const field of without) delete deedPoll[field];

  const req = {
    method: "GET",
    baseUrl: "",
    path: "/deed-polls",
    originalUrl: "/deed-polls",
    sessionID: SESSION_ID,
    sessionStore: refreshCoordinatorDouble(),
    session: sessionDouble(deedPoll as Record<string, unknown>)
  } as unknown as RequestDouble;
  // express-session drops the id along with the session, so an event emitted afterwards would carry no sid.
  const destroy = req.session.destroy.getMockImplementation();
  req.session.destroy.mockImplementation((done?: (error?: Error) => void) => {
    Reflect.deleteProperty(req, "sessionID");
    destroy?.(done);
  });
  return req;
}

function events(): [string, Record<string, string>][] {
  return vi.mocked(trackEvent).mock.calls as [string, Record<string, string>][];
}

let next: NextFunction;
let res: ResponseDouble;

beforeEach(() => {
  vi.clearAllMocks();
  next = vi.fn();
  res = pageResponse();
  vi.mocked(refreshTokens).mockResolvedValue({
    ok: true,
    tokens: { accessToken: "a-new-access-token", refreshToken: "a-refresh-token", expiresAt: expiringIn(900) }
  });
  vi.mocked(fetchCallerAccess).mockResolvedValue(undefined);
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
    // `refreshTokens` refuses a revoked or expired token and a response naming a different subject. Both
    // mean this session is over, so neither may continue into the request.
    vi.mocked(refreshTokens).mockResolvedValue(REFUSED);
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
    vi.mocked(refreshTokens).mockResolvedValue(REFUSED);
    const req = { ...request(), originalUrl: "/deed-polls/case-1/notes" } as RequestDouble;

    await refreshMiddleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls%2Fcase-1%2Fnotes");
  });
});

describe("refreshMiddleware's security events", () => {
  const SID = createHash("sha256").update(SESSION_ID).digest("hex").slice(0, 16);

  const ended = (reason: string) => ["auth.session.ended", { subject: SUBJECT, sid: SID, env: "test", method: "GET", route: "/deed-polls", reason }];

  it("should emit no_refresh_token when an expired token has nothing to refresh it with", async () => {
    await refreshMiddleware(request(["refreshToken"], { tokenExpiresAt: expiringIn(-30) }), res, next);

    expect(events()).toEqual([ended("no_refresh_token")]);
  });

  it("should emit no_subject, with no subject, for a session that recorded none", async () => {
    await refreshMiddleware(request(["subject"]), res, next);

    expect(events()).toEqual([["auth.session.ended", { sid: SID, env: "test", method: "GET", route: "/deed-polls", reason: "no_subject" }]]);
  });

  it("should emit refresh_refused when IDAM refuses the refresh token", async () => {
    vi.mocked(refreshTokens).mockResolvedValue(REFUSED);

    await refreshMiddleware(request(), res, next);

    expect(events()).toEqual([ended("refresh_refused")]);
  });

  it("should emit subject_mismatch, not refresh_refused, when the refresh names somebody else", async () => {
    // The one sign-out here that says a session was being handed to another identity, so it must be alertable alone.
    vi.mocked(refreshTokens).mockResolvedValue({ ok: false, reason: "subject_mismatch" });
    const req = request();

    await refreshMiddleware(req, res, next);

    expect(events()).toEqual([ended("subject_mismatch")]);
    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
  });

  it("should emit refresh_failed_expired when the refresh throws and the token has expired", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await refreshMiddleware(request([], { tokenExpiresAt: expiringIn(-30) }), res, next);

    expect(events()).toEqual([ended("refresh_failed_expired")]);
  });

  it("should emit nothing when the refresh throws while the token still works, because the session goes on", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await refreshMiddleware(request(), res, next);

    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("should emit nothing for a successful refresh", async () => {
    await refreshMiddleware(request(), res, next);

    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("should put no token or raw session id in the event", async () => {
    vi.mocked(refreshTokens).mockResolvedValue(REFUSED);

    await refreshMiddleware(request([], { accessToken: "an-access-token" }), res, next);

    const serialised = JSON.stringify(events());
    for (const secret of ["a-refresh-token", "an-access-token", SESSION_ID, "An Admin", "@"]) {
      expect(serialised).not.toContain(secret);
    }
  });
});

describe("refreshMiddleware and the caller's access", () => {
  const stored = (req: RequestDouble) => req.session.deedPoll as SessionState;

  it("should replace the stored answer with api's answer for the refreshed token", async () => {
    vi.mocked(fetchCallerAccess).mockResolvedValue(DELIVERY_MANAGER as never);
    const req = request([], { user: { ...TEAM_LEADER, isAdmin: true, isJudicial: false, name: "An Admin" }, authenticatedAt: 1_700_000_000 });

    await refreshMiddleware(req, res, next);

    expect(fetchCallerAccess).toHaveBeenCalledWith("a-new-access-token", "refresh");
    expect(stored(req).user).toMatchObject({ ...DELIVERY_MANAGER, name: "An Admin" });
    expect(stored(req).accessToken).toBe("a-new-access-token");
    expect(stored(req).authenticatedAt).toBe(1_700_000_000);
    expect(next).toHaveBeenCalled();
  });

  it("should keep the previous answer when /me fails after a successful refresh", async () => {
    const previous = { ...TEAM_LEADER, isAdmin: true, isJudicial: false, name: "An Admin" };
    const req = request([], { user: previous });

    await refreshMiddleware(req, res, next);

    expect(fetchCallerAccess).toHaveBeenCalledTimes(1);
    expect(stored(req).user).toEqual(previous);
    expect(stored(req).accessToken).toBe("a-new-access-token");
    expect(next).toHaveBeenCalled();
  });

  it("should ask once for a session saved before /me, with its own token, and store the answer", async () => {
    vi.mocked(fetchCallerAccess).mockResolvedValue(TEAM_LEADER as never);
    const req = request([], { user: ROLES_ERA_USER, accessToken: "the-session-token", tokenExpiresAt: expiringIn(3600) });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(fetchCallerAccess).toHaveBeenCalledWith("the-session-token", "backfill");
    expect(stored(req).user).toMatchObject({ ...TEAM_LEADER, name: "An Admin" });
    expect(stored(req).user).not.toHaveProperty("roles");
    expect(req.session.save).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("should leave a failed backfill with no access and ask again on the next request", async () => {
    const req = request([], { user: ROLES_ERA_USER, accessToken: "the-session-token", tokenExpiresAt: expiringIn(3600) });

    await refreshMiddleware(req, res, next);

    expect(stored(req).user).toEqual(ROLES_ERA_USER);
    expect(next).toHaveBeenCalledTimes(1);

    vi.mocked(fetchCallerAccess).mockResolvedValue(DELIVERY_MANAGER as never);
    await refreshMiddleware(req, res, next);

    expect(fetchCallerAccess).toHaveBeenCalledTimes(2);
    expect(stored(req).user).toMatchObject({ ...DELIVERY_MANAGER, name: "An Admin" });
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("should not ask again for a session that already holds an answer, even one of no access", async () => {
    const req = request([], {
      user: { staff: false, judicial: false, capabilities: [], isAdmin: false, isJudicial: false, name: "An Admin" },
      accessToken: "the-session-token",
      tokenExpiresAt: expiringIn(3600)
    });

    await refreshMiddleware(req, res, next);

    expect(fetchCallerAccess).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("should backfill while IDAM is unreachable if the token still works", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));
    vi.mocked(fetchCallerAccess).mockResolvedValue(TEAM_LEADER as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const req = request([], { user: ROLES_ERA_USER, accessToken: "the-session-token" });

    await refreshMiddleware(req, res, next);

    expect(fetchCallerAccess).toHaveBeenCalledWith("the-session-token", "backfill");
    expect(stored(req).user).toMatchObject(TEAM_LEADER);
  });
});

describe("refreshMiddleware and the refresh lease", () => {
  const withClaim = (claim: Parameters<typeof refreshCoordinatorDouble>[0], overrides: SessionState = {}) => {
    const req = request([], overrides);
    (req as unknown as { sessionStore: unknown }).sessionStore = refreshCoordinatorDouble(claim);
    return req;
  };
  const store = (req: RequestDouble) => (req as unknown as { sessionStore: ReturnType<typeof refreshCoordinatorDouble> }).sessionStore;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("should refresh only after taking the lease, publish under it and then give it up", async () => {
    const req = request();

    await refreshMiddleware(req, res, next);

    expect(store(req).claimRefresh).toHaveBeenCalledWith(SESSION_ID, req.session);
    expect(store(req).attachRefreshLease).toHaveBeenCalledWith(req.session, "a-lease");
    expect(store(req).releaseRefresh).toHaveBeenCalledWith(SESSION_ID, "a-lease");
    expect(vi.mocked(refreshTokens).mock.invocationCallOrder[0]).toBeGreaterThan(store(req).claimRefresh.mock.invocationCallOrder[0]);
  });

  it("should decide from the session as read again under the lease, and not refresh what another request already has", async () => {
    const req = request();
    // The reload brings in the tokens the request this one waited on has just stored.
    req.session.reload.mockImplementation((done: () => void) => {
      Object.assign(req.session.deedPoll, { accessToken: "the-winners-token", tokenExpiresAt: expiringIn(3600) });
      done();
    });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect((req.session.deedPoll as SessionState).accessToken).toBe("the-winners-token");
    expect(store(req).releaseRefresh).toHaveBeenCalledWith(SESSION_ID, "a-lease");
    expect(next).toHaveBeenCalled();
  });

  it("should refresh with the refresh token read again under the lease, not the one the request started with", async () => {
    const req = request();
    req.session.reload.mockImplementation((done: () => void) => {
      Object.assign(req.session.deedPoll, { refreshToken: "a-rotated-refresh-token" });
      done();
    });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).toHaveBeenCalledWith(expect.anything(), "a-rotated-refresh-token", SUBJECT);
  });

  it("should sign this request out, without an event of its own, when the session ended before the lease", async () => {
    const req = withClaim({ outcome: "missing" });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
    expect(next).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("should sign this request out when the session ended while IDAM was answering", async () => {
    const req = request();
    req.session.save.mockImplementation((done: (error?: Error) => void) => done(new SessionWriteRefusedError("missing")));

    await refreshMiddleware(req, res, next);

    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fdeed-polls");
    expect(next).not.toHaveBeenCalled();
  });

  it("should fail the request, and not ask IDAM again, when the lease was lost before the publish", async () => {
    const req = request();
    req.session.save.mockImplementation((done: (error?: Error) => void) => done(new SessionWriteRefusedError("lease")));

    await expect(refreshMiddleware(req, res, next)).rejects.toMatchObject({ reason: "lease" });

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(store(req).releaseRefresh).toHaveBeenCalled();
  });

  it("should re-read and re-apply the same tokens when another write moved the revision, without asking IDAM again", async () => {
    const req = request();
    req.session.save.mockImplementationOnce((done: (error?: Error) => void) => done(new SessionWriteRefusedError("conflict")));
    req.session.reload.mockImplementation((done: () => void) => {
      Object.assign(req.session.deedPoll, { lastSeenAt: 1_800_000_000 });
      done();
    });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(req.session.save).toHaveBeenCalledTimes(2);
    expect(req.session.deedPoll).toMatchObject({ accessToken: "a-new-access-token", lastSeenAt: 1_800_000_000 });
    expect(next).toHaveBeenCalled();
  });

  it("should go on with a working token when another request still holds the lease after the wait", async () => {
    const req = withClaim({ outcome: "busy" }, { accessToken: "the-current-token" });

    await refreshMiddleware(req, res, next);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("should fail, and not sign out, when the wait runs out on an expired token", async () => {
    const req = withClaim({ outcome: "busy" }, { tokenExpiresAt: expiringIn(-30) });

    await expect(refreshMiddleware(req, res, next)).rejects.toThrow("still in progress");

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should fail closed, and not ask IDAM, when the store cannot coordinate refreshes", async () => {
    const req = request();
    (req as unknown as { sessionStore: unknown }).sessionStore = {};

    await expect(refreshMiddleware(req, res, next)).rejects.toThrow("cannot coordinate");

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should give the lease up when IDAM fails, so the next request need not wait for it to expire", async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const req = request();

    await refreshMiddleware(req, res, next);

    expect(store(req).releaseRefresh).toHaveBeenCalledWith(SESSION_ID, "a-lease");
    expect(next).toHaveBeenCalled();
  });
});
