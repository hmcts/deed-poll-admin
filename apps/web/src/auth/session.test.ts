import { currentUser, DEEDPOLL_ADMIN } from "@hmcts/deed-poll";
import type { Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { pageRequest, type RequestDouble } from "../express-doubles.js";
import type { AuthFlowState } from "./idam.js";
import { assertRedisUrl, assertSessionSecret, sessionIdToken, sessionUser, signIn, signOut, startFlow, takeFlow } from "./session.js";

const FLOW: AuthFlowState = { codeVerifier: "a-verifier", state: "a-state", returnTo: "/deed-polls" };

function request(options: Parameters<typeof pageRequest>[0] = {}): RequestDouble {
  return pageRequest({ signedIn: false, ...options });
}

describe("sessionUser", () => {
  it("returns the signed-in user", () => {
    expect(sessionUser(request({ signedIn: true, admin: true, name: "A Caseworker" }))).toMatchObject({ isAdmin: true, name: "A Caseworker" });
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
  const user = currentUser([DEEDPOLL_ADMIN], "A Caseworker");
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
