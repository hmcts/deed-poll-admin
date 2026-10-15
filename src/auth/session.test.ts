import { ACCESS_GAZETTE, can, currentUser, DEEDPOLL_ADMIN, DEEDPOLL_DELIVERY_MANAGER, DELETE_NOTE, OVERRIDE_PRIVACY } from "@hmcts/deed-poll";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageRequest, type RequestDouble } from "../express-doubles.js";
import type { AuthFlowState } from "./idam.js";
import {
  assertRedisUrl,
  assertSessionSecret,
  assertSessionTimeouts,
  sessionCookieName,
  sessionHoldsAccess,
  sessionIdToken,
  sessionStoreTtl,
  sessionTimestamps,
  sessionUser,
  signIn,
  signOut,
  startFlow,
  storeAccess,
  takeFlow,
  touchLastSeen,
  updateTokens
} from "./session.js";

const FLOW: AuthFlowState = { codeVerifier: "a-verifier", state: "a-state", returnTo: "/deed-polls" };

function request(options: Parameters<typeof pageRequest>[0] = {}): RequestDouble {
  return pageRequest({ signedIn: false, ...options });
}

describe("sessionUser", () => {
  it("returns the signed-in user", () => {
    expect(sessionUser(request({ signedIn: true, teamLeader: true, name: "A Caseworker" }))).toMatchObject({ isAdmin: true, name: "A Caseworker" });
  });

  it("returns undefined when nobody is signed in, rather than a role-less user", () => {
    // The distinction matters: `requireAuth` treats undefined as "send them to log in", where a
    // role-less user would read as signed in and let every non-admin page through.
    expect(sessionUser(request())).toBeUndefined();
  });

  it("tolerates a session that has never been namespaced", () => {
    expect(sessionUser({ session: {} } as unknown as Request)).toBeUndefined();
  });

  it("leaves an un-namespaced session untouched, so an anonymous request writes nothing to the store", () => {
    // `express-session` persists a brand-new session if it was modified, `saveUninitialized: false` or
    // not. `requireAuth` is global and reads the user on every non-public request, so creating the
    // namespace on read meant a Redis key per anonymous request, each for the cookie's full maxAge.
    const session = {};

    sessionUser({ session } as unknown as Request);

    expect(session).toEqual({});
  });
});

describe("startFlow and takeFlow", () => {
  it("stores the flow and gives it back", () => {
    const req = request();
    startFlow(req, FLOW);

    expect(takeFlow(req)).toEqual(FLOW);
  });

  it("yields the flow only once, so a code cannot be replayed against the same session", () => {
    // The second callback finds no verifier and `completeLogin` is never reached. Without this a
    // captured code could be redeemed repeatedly.
    const req = request();
    startFlow(req, FLOW);

    expect(takeFlow(req)).toEqual(FLOW);
    expect(takeFlow(req)).toBeUndefined();
  });

  it("yields undefined when no flow was ever started", () => {
    expect(takeFlow(request())).toBeUndefined();
  });

  it("leaves an un-namespaced session untouched when there is no flow to take", () => {
    const session = {};

    expect(takeFlow({ session } as unknown as Request)).toBeUndefined();
    expect(session).toEqual({});
  });

  it("replaces an abandoned flow rather than keeping the first", () => {
    // Someone who hits /login twice should be able to complete the second attempt.
    const req = request();
    startFlow(req, FLOW);
    startFlow(req, { ...FLOW, state: "second-state" });

    expect(takeFlow(req)?.state).toBe("second-state");
  });
});

describe("signIn", () => {
  const user = currentUser({ staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY] }, "A Caseworker");
  const SUBJECT = "caseworker@example.com";
  const tokens = {
    idToken: "an-id-token",
    accessToken: "an-access-token",
    refreshToken: "a-refresh-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600
  };

  it("records the user and the tokens", async () => {
    const req = request();

    await signIn(req, user, SUBJECT, tokens);

    expect(sessionUser(req)).toMatchObject({ isAdmin: true, name: "A Caseworker" });
    expect(sessionIdToken(req)).toBe("an-id-token");
  });

  it("regenerates the session id before writing the user", async () => {
    // Session fixation: without this an attacker plants a known cookie, the victim logs in, and the
    // attacker's cookie is authenticated. The double's `regenerate` clears the data, so writing the
    // user first would lose it — which is what makes this assertion mean anything.
    const req = request();

    await signIn(req, user, SUBJECT, tokens);

    expect(req.session.regenerate).toHaveBeenCalled();
    expect(sessionUser(req)).toBeDefined();
  });

  it("saves before resolving, so the callback's redirect cannot outrun the store", async () => {
    const req = request();

    await signIn(req, user, SUBJECT, tokens);

    expect(req.session.save).toHaveBeenCalled();
  });

  it("rejects rather than reporting a login when regeneration fails", async () => {
    const req = request();
    req.session.regenerate.mockImplementation((callback: (error?: Error) => void) => callback(new Error("store down")));

    await expect(signIn(req, user, SUBJECT, tokens)).rejects.toThrow("store down");
  });

  it("rejects rather than reporting a login when the save fails", async () => {
    // Resolving here would redirect the user into the service holding a session the store never
    // accepted — they would appear signed in until the next request.
    const req = request();
    req.session.save.mockImplementation((callback: (error?: Error) => void) => callback(new Error("store down")));

    await expect(signIn(req, user, SUBJECT, tokens)).rejects.toThrow("store down");
  });

  it("accepts an absent id token, since logout works without one", async () => {
    const req = request();

    await signIn(req, user, SUBJECT, { ...tokens, idToken: undefined });

    expect(sessionUser(req)).toBeDefined();
    expect(sessionIdToken(req)).toBeUndefined();
  });
});

describe("session timestamps", () => {
  const user = currentUser({ staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY] }, "A Caseworker");
  const tokens = { idToken: "an-id-token", accessToken: "an-access-token", refreshToken: "a-refresh-token", expiresAt: 1_800_000_000 };
  const SIGNED_IN_AT = new Date("2026-10-14T09:00:00Z");
  const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should start both clocks at sign-in", async () => {
    vi.useFakeTimers({ now: SIGNED_IN_AT, toFake: ["Date"] });
    const req = request();

    await signIn(req, user, "caseworker@example.com", tokens);

    expect(sessionTimestamps(req)).toEqual({ authenticatedAt: seconds(SIGNED_IN_AT), lastSeenAt: seconds(SIGNED_IN_AT) });
  });

  // The guard that matters most: a refresh that moved either clock would make the session endless again.
  it("should leave both clocks alone when tokens are refreshed", async () => {
    vi.useFakeTimers({ now: SIGNED_IN_AT, toFake: ["Date"] });
    const req = request();
    await signIn(req, user, "caseworker@example.com", tokens);
    vi.setSystemTime(new Date("2026-10-14T17:00:00Z"));

    await updateTokens(req, { ...tokens, accessToken: "a-refreshed-token" });

    expect(sessionTimestamps(req)).toEqual({ authenticatedAt: seconds(SIGNED_IN_AT), lastSeenAt: seconds(SIGNED_IN_AT) });
  });

  it("should leave both clocks alone when a refresh also brings a new /me answer", async () => {
    vi.useFakeTimers({ now: SIGNED_IN_AT, toFake: ["Date"] });
    const req = request();
    await signIn(req, user, "caseworker@example.com", tokens);
    vi.setSystemTime(new Date("2026-10-14T17:00:00Z"));

    await updateTokens(req, { ...tokens, accessToken: "a-refreshed-token" }, { staff: true, judicial: false, capabilities: [ACCESS_GAZETTE] });

    expect(sessionTimestamps(req)).toEqual({ authenticatedAt: seconds(SIGNED_IN_AT), lastSeenAt: seconds(SIGNED_IN_AT) });
  });

  it("should move only the last-seen clock, and save it, when activity is recorded", async () => {
    vi.useFakeTimers({ now: SIGNED_IN_AT, toFake: ["Date"] });
    const req = request();
    await signIn(req, user, "caseworker@example.com", tokens);
    const later = new Date("2026-10-14T09:20:00Z");
    vi.setSystemTime(later);
    req.session.save.mockClear();

    await touchLastSeen(req);

    expect(sessionTimestamps(req)).toEqual({ authenticatedAt: seconds(SIGNED_IN_AT), lastSeenAt: seconds(later) });
    expect(req.session.save).toHaveBeenCalled();
  });

  it("should reject when the last-seen save fails, rather than carrying on as if it had been recorded", async () => {
    const req = request({ signedIn: true });
    req.session.save.mockImplementation((callback: (error?: Error) => void) => callback(new Error("store down")));

    await expect(touchLastSeen(req)).rejects.toThrow("store down");
  });

  // A session from before this change has neither. Reading it as "no timestamps" lets the lifetime check end it.
  it("should report no timestamps for a session that has none, or only one", () => {
    const untimed = request({ signedIn: true });
    const halfTimed = request({ signedIn: true });
    halfTimed.session.deedPoll.authenticatedAt = seconds(SIGNED_IN_AT);

    expect(sessionTimestamps(untimed)).toBeUndefined();
    expect(sessionTimestamps(halfTimed)).toBeUndefined();
  });
});

describe("sessionStoreTtl", () => {
  const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000 };
  const NOW = new Date("2026-10-14T12:00:00Z");
  const NOW_SECONDS = NOW.getTime() / 1000;
  const ttl = sessionStoreTtl(LIMITS);
  const stored = (deedPoll?: Record<string, unknown>) => ({ cookie: {}, ...(deedPoll ? { deedPoll } : {}) }) as unknown as Parameters<typeof ttl>[0];

  afterEach(() => {
    vi.useRealTimers();
  });

  // Ten minutes is long enough to finish a sign-in at IDAM, and short enough that a crawler's sessions do not linger.
  it.each([
    ["an empty session", undefined],
    ["a sign-in in flight", { flow: { state: "a-state" } }],
    ["a timed-out session holding only its return path", { timedOutReturnTo: "/deed-polls" }]
  ])("should keep %s for ten minutes", (_label, deedPoll) => {
    expect(ttl(stored(deedPoll))).toBe(600);
  });

  // Fifteen minutes past the absolute deadline, so it is the middleware, not eviction, that ends every session on time
  // and sends the user through IDAM end-session.
  it("should keep a signed-in session until fifteen minutes after its absolute deadline", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

    expect(ttl(stored({ user: { name: "A" }, authenticatedAt: NOW_SECONDS - 3600, lastSeenAt: NOW_SECONDS }))).toBe(36_000 - 3600 + 900);
  });

  // connect-redis deletes the key on a TTL of zero or less, which would lose the session mid-request.
  it("should never answer less than one second, even long past the deadline", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

    expect(ttl(stored({ user: { name: "A" }, authenticatedAt: NOW_SECONDS - 100_000, lastSeenAt: NOW_SECONDS - 100_000 }))).toBe(1);
  });
});

describe("sessionCookieName", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  // `__Host-` makes the browser refuse the cookie unless it is Secure, Path=/ and has no Domain, so a sibling
  // *.platform.hmcts.net site cannot plant or overwrite it. OWASP plan 03, Task 13.
  it.each(["production", "aat", ""])("should use the __Host- name where cookies must be secure, under NODE_ENV=%o", (env) => {
    process.env.NODE_ENV = env;

    expect(sessionCookieName()).toBe("__Host-deed-poll-admin-sid");
  });

  // Browsers refuse a __Host- cookie over plain http, so local runs would never keep a session.
  it.each(["development", "test"])("should drop the prefix where plain http is permitted, under NODE_ENV=%o", (env) => {
    process.env.NODE_ENV = env;

    expect(sessionCookieName()).toBe("deed-poll-admin-sid");
  });
});

describe("signOut", () => {
  it("destroys the whole session, not just this app's namespace", async () => {
    const req = request({ signedIn: true, idToken: "an-id-token" });

    await signOut(req);

    expect(req.session.destroy).toHaveBeenCalled();
    expect(sessionUser(req)).toBeUndefined();
  });

  it("rejects when the store cannot destroy it, rather than claiming a sign-out", async () => {
    const req = request({ signedIn: true });
    req.session.destroy.mockImplementation((callback: (error?: Error) => void) => callback(new Error("store down")));

    await expect(signOut(req)).rejects.toThrow("store down");
  });
});

describe("assertSessionSecret", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("allows the checked-in placeholder locally, where there is nothing to protect", () => {
    process.env.NODE_ENV = "development";

    expect(() => assertSessionSecret("session-secret")).not.toThrow();
  });

  // Not a warning, and not only production. Everything would work, users would log in, and the
  // sessions asserting their roles could be minted by anyone — nothing about running would reveal it.
  it.each(["production", "aat", "preview", "demo", "ithc", ""])("refuses to start on the placeholder under NODE_ENV=%o", (env) => {
    process.env.NODE_ENV = env;

    expect(() => assertSessionSecret("session-secret")).toThrow(/forgeable/);
  });

  it("refuses to start on the placeholder when NODE_ENV is not set at all", () => {
    delete process.env.NODE_ENV;

    expect(() => assertSessionSecret("session-secret")).toThrow(/forgeable/);
  });

  it("accepts a real secret everywhere", () => {
    process.env.NODE_ENV = "production";

    expect(() => assertSessionSecret("a-real-secret-from-the-key-vault")).not.toThrow();
  });
});

describe("assertSessionTimeouts", () => {
  it("should accept the plan's defaults of 30 minutes idle and 10 hours absolute", () => {
    expect(assertSessionTimeouts(1800, 36_000)).toEqual({ idleSeconds: 1800, absoluteSeconds: 36_000 });
  });

  it("should accept the bounds themselves, 300 seconds idle and 24 hours absolute", () => {
    expect(assertSessionTimeouts(300, 86_400)).toEqual({ idleSeconds: 300, absoluteSeconds: 86_400 });
  });

  // An idle limit at or past the absolute one could never fire, so the setting would be a no-op that reads like a control.
  it.each([
    [36_000, 36_000],
    [36_001, 36_000]
  ])("should refuse an idle limit of %o that is not shorter than the absolute limit of %o", (idle, absolute) => {
    expect(() => assertSessionTimeouts(idle, absolute)).toThrow(/SESSION_IDLE_TIMEOUT_SECONDS.*SESSION_ABSOLUTE_TIMEOUT_SECONDS/);
  });

  // Under five minutes there is no room for the two-minute warning and a reply to it.
  it("should refuse an idle limit under 300 seconds", () => {
    expect(() => assertSessionTimeouts(299, 36_000)).toThrow(/SESSION_IDLE_TIMEOUT_SECONDS/);
  });

  it("should refuse an absolute limit over 24 hours, which would be no tighter than the cookie it replaces", () => {
    expect(() => assertSessionTimeouts(1800, 86_401)).toThrow(/SESSION_ABSOLUTE_TIMEOUT_SECONDS/);
  });

  it.each([
    ["a fraction", 1800.5, 36_000, /SESSION_IDLE_TIMEOUT_SECONDS/],
    ["text", "abc", 36_000, /SESSION_IDLE_TIMEOUT_SECONDS/],
    ["a numeric string", 1800, "36000", /SESSION_ABSOLUTE_TIMEOUT_SECONDS/],
    ["missing", 1800, undefined, /SESSION_ABSOLUTE_TIMEOUT_SECONDS/]
  ])("should refuse %s", (_label, idle, absolute, message) => {
    expect(() => assertSessionTimeouts(idle, absolute)).toThrow(message);
  });

  // The message names the setting and the rule only. It is read in startup logs, and quoting values from config
  // is how a secret ends up there when a neighbouring setting is mis-mapped.
  it("should not quote the rejected value", () => {
    expect(() => assertSessionTimeouts("not-a-secret-but-could-be", 36_000)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("not-a-secret-but-could-be") })
    );
  });
});

describe("assertRedisUrl", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("allows the local placeholder in development, where that is the Redis docker compose serves", () => {
    process.env.NODE_ENV = "development";

    expect(() => assertRedisUrl("redis://localhost:6379")).not.toThrow();
  });

  // Same reason the secret guard is not production-only: `redis.url` has a working-looking default, so a
  // `redis-url` entry missing from an environment's vault does not fail — it points the store at loopback,
  // and the only symptom is a readiness probe that never goes green.
  it.each(["production", "aat", "preview", "demo", "ithc", ""])("refuses to start on the loopback placeholder under NODE_ENV=%o", (env) => {
    process.env.NODE_ENV = env;

    expect(() => assertRedisUrl("redis://localhost:6379")).toThrow(/placeholder/);
  });

  describe("with REDIS_PLAINTEXT_PERMITTED, which only the preview template sets", () => {
    it("admits plain redis:// to a preview release's own subchart service", () => {
      process.env.NODE_ENV = "production";

      expect(() => assertRedisUrl("redis://deed-poll-admin-pr-172-redis-master:6379", true)).not.toThrow();
    });

    it.each([
      "redis://deed-poll-admin-aat.redis.cache.windows.net:6379",
      "redis://deed-poll-admin-pr-172-redis-master.evil.example:6379",
      "redis://other-service-pr-172-redis-master:6379",
      "redis://deed-poll-admin-pr-abc-redis-master:6379"
    ])("still refuses plain redis:// to %s, which is not a per-PR subchart service", (url) => {
      process.env.NODE_ENV = "production";

      expect(() => assertRedisUrl(url, true)).toThrow(/unencrypted/);
    });

    it("still refuses the loopback placeholder", () => {
      process.env.NODE_ENV = "production";

      expect(() => assertRedisUrl("redis://localhost:6379", true)).toThrow(/placeholder/);
    });

    it("refuses the preview host without the flag, which AAT and production never set", () => {
      process.env.NODE_ENV = "production";

      expect(() => assertRedisUrl("redis://deed-poll-admin-pr-172-redis-master:6379")).toThrow(/unencrypted/);
    });
  });

  it.each(["rediss://127.0.0.1:6380", "rediss://[::1]:6380"])("refuses %s as well as the localhost spelling", (url) => {
    process.env.NODE_ENV = "production";

    expect(() => assertRedisUrl(url)).toThrow(/placeholder/);
  });

  // The vault value is `rediss://:<access-key>@host:6380`, so a message quoting it puts the access key in
  // stdout and App Insights — where startup failures are read by more people, and kept longer, than
  // anything else this app logs.
  it("names the scheme and host but never the credential in the URL", () => {
    process.env.NODE_ENV = "production";

    expect(() => assertRedisUrl("redis://:an-access-key@deed-poll-prod.redis.cache.windows.net:6379")).toThrow(/on the wire/);
    expect(() => assertRedisUrl("redis://:an-access-key@deed-poll-prod.redis.cache.windows.net:6379")).not.toThrow(/an-access-key/);
    expect(() => assertRedisUrl("redis://:an-access-key@localhost:6379")).not.toThrow(/an-access-key/);
  });

  // `new URL` throws `TypeError: Invalid URL` and names neither the setting nor where it comes from, so the
  // one input shape this guard exists to explain would be the one it said least about.
  it("explains a value that is not a URL at all, without quoting it", () => {
    process.env.NODE_ENV = "production";

    expect(() => assertRedisUrl("an-access-key-pasted-on-its-own")).toThrow(/redis-url key vault entry/);
    expect(() => assertRedisUrl("an-access-key-pasted-on-its-own")).not.toThrow(/an-access-key-pasted-on-its-own/);
  });

  it("refuses a cleartext URL to a real host, since sessions carry IDAM tokens", () => {
    process.env.NODE_ENV = "production";

    expect(() => assertRedisUrl("redis://deed-poll-prod.redis.cache.windows.net:6379")).toThrow(/on the wire/);
  });

  it("accepts the rediss:// URL the shared root writes", () => {
    process.env.NODE_ENV = "production";

    expect(() => assertRedisUrl("rediss://deed-poll-prod.redis.cache.windows.net:6380")).not.toThrow();
  });
});

describe("stored access", () => {
  it.each([
    {
      label: "a Delivery Manager's answer",
      access: { staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE] },
      privacy: true,
      gazette: true
    },
    { label: "a Team leader's answer", access: { staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY, DELETE_NOTE] }, privacy: true, gazette: false },
    { label: "an unknown capability", access: { staff: true, judicial: false, capabilities: ["MANAGE_USERS"] }, privacy: false, gazette: false },
    { label: "a roles-era Delivery Manager", access: { roles: [DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_ADMIN] }, privacy: false, gazette: false },
    { label: "a malformed answer", access: { staff: true, judicial: false, capabilities: "ACCESS_GAZETTE" }, privacy: false, gazette: false }
  ])("should revalidate $label and ignore stale booleans", ({ access, privacy, gazette }) => {
    const req = request();
    const stored = { ...access, name: "Same person", isAdmin: !privacy, isJudicial: true };
    req.session.deedPoll.user = stored;

    const user = sessionUser(req);

    expect(user).toMatchObject({ name: "Same person", isAdmin: privacy, isJudicial: false });
    expect(user).not.toHaveProperty("roles");
    expect(can(user!, ACCESS_GAZETTE)).toBe(gazette);
    expect(req.session.deedPoll.user).toBe(stored);
    expect(req.session.save).not.toHaveBeenCalled();
  });
});

describe("the /me answer after sign-in", () => {
  const tokens = { idToken: "an-id-token", accessToken: "an-access-token", refreshToken: "a-refresh-token", expiresAt: 1_800_000_000 };
  const GAZETTE = { staff: true, judicial: false, capabilities: [OVERRIDE_PRIVACY, ACCESS_GAZETTE] };

  it("should replace the answer and keep the name when a refresh brings a new one", async () => {
    const req = request();
    await signIn(req, currentUser({ staff: true, judicial: false, capabilities: [] }, "A Caseworker"), "caseworker@example.com", tokens);

    await updateTokens(req, { ...tokens, accessToken: "a-refreshed-token" }, GAZETTE);

    expect(sessionUser(req)).toMatchObject({ ...GAZETTE, isAdmin: true, name: "A Caseworker" });
    expect(req.session.deedPoll.accessToken).toBe("a-refreshed-token");
  });

  it("should keep the previous answer when a refresh brings none", async () => {
    const req = request();
    await signIn(req, currentUser(GAZETTE, "A Caseworker"), "caseworker@example.com", tokens);

    await updateTokens(req, { ...tokens, accessToken: "a-refreshed-token" });

    expect(can(sessionUser(req)!, ACCESS_GAZETTE)).toBe(true);
  });

  it("should tell a session with no answer from one whose answer is no access", () => {
    const rolesEra = request();
    rolesEra.session.deedPoll.user = { roles: [DEEDPOLL_DELIVERY_MANAGER], isAdmin: true, name: "Same person" };

    expect(sessionHoldsAccess(rolesEra)).toBe(false);
    expect(sessionHoldsAccess(request({ signedIn: true, persona: "none" }))).toBe(true);
    expect(sessionHoldsAccess(request())).toBe(false);
  });

  it("should store a backfilled answer under the existing name, and save it", async () => {
    const req = request();
    req.session.deedPoll.user = { roles: [DEEDPOLL_DELIVERY_MANAGER], isAdmin: true, name: "Same person" };

    await storeAccess(req, GAZETTE);

    expect(sessionHoldsAccess(req)).toBe(true);
    expect(sessionUser(req)).toMatchObject({ ...GAZETTE, name: "Same person" });
    expect(req.session.deedPoll.user).not.toHaveProperty("roles");
    expect(req.session.save).toHaveBeenCalled();
  });

  it("should reject when the backfill save fails", async () => {
    const req = request({ signedIn: true });
    req.session.save.mockImplementation((callback: (error?: Error) => void) => callback(new Error("store down")));

    await expect(storeAccess(req, GAZETTE)).rejects.toThrow("store down");
  });
});
