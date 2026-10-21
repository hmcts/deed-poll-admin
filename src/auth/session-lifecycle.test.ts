/**
 * The session's other writers racing logout, refresh and expiry, across two app instances sharing one real Redis,
 * through the middleware `createApp` mounts in its order: `sessionLifetime`, `requireAuth`, `refreshMiddleware`
 * (review finding E01, Task 3 of `docs/plans/20261020-e01-session-revocation.md`), and a persona switch racing logout
 * (review finding R05, `docs/plans/completed/20261021-r05-r06-session-edges.md`).
 *
 * A request is held at a barrier after its session was loaded — before the middleware, inside a page, or inside the
 * `/me` backfill's call to api — so each interleaving is the one named rather than the scheduler's. What is asserted
 * is the response, what Redis holds afterwards and what a later request with the cookie sees, never which store
 * methods ran. Keys live under a per-run prefix that is removed afterwards, never flushed.
 */
import { randomUUID } from "node:crypto";
import { currentUser } from "@hmcts/deed-poll";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { expressSessionRedis } from "@hmcts-cft/express-session-redis";
import express, { type NextFunction, type Request, type Response } from "express";
import { createClient } from "redis";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as keepAlive } from "../pages/session/keep-alive.js";
import { POST as switchPersona } from "../pages/switch-persona.js";
import { fetchCallerAccess } from "./caller-access.js";
import { GuardedSessionStore } from "./guarded-session-store.js";
import { loginAsPersona } from "./persona-users.js";
import { refreshMiddleware } from "./refresh-middleware.js";
import { requireAuth } from "./require-auth.js";
import { sessionAccessToken, sessionStoreTtl, sessionUser, signIn, signOut, updateTokens } from "./session.js";
import { sessionLifetime } from "./session-lifetime.js";

vi.mock("./idam.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idam.js")>()),
  endSessionUrl: vi.fn(async () => undefined),
  refreshTokens: vi.fn()
}));
vi.mock("./caller-access.js", () => ({ fetchCallerAccess: vi.fn() }));
vi.mock("./settings.js", () => ({ idamSettings: () => ({ issuerUrl: "https://idam.example/o", clientId: "deed-poll-admin" }) }));
// The switcher's chart flag is off in `config/default.json`; its gate is `persona-switcher.test.ts`'s subject.
vi.mock("./persona-switcher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./persona-switcher.js")>()),
  personaSwitcherEnabled: () => true
}));
vi.mock("./persona-users.js", () => ({ loginAsPersona: vi.fn() }));
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const PREFIX = `test-e01-lifecycle-${randomUUID()}:`;
const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000 };
const COOKIE = { httpOnly: true, secure: false, sameSite: "lax" as const, maxAge: 60_000 };
const NO_ACCESS = { staff: true, judicial: false, capabilities: [] };
const DELIVERY_MANAGER = { staff: true, judicial: false, capabilities: ["ACCESS_GAZETTE"] };
const JUDGE_LOGIN = {
  user: currentUser({ staff: false, judicial: true, capabilities: [] }, "A Judge"),
  subject: "judge-subject",
  tokens: { accessToken: "judge-access", refreshToken: "judge-refresh", idToken: "judge-id-token", expiresAt: nowSeconds() + 3600 }
};
const redisReachable = await requireRedis();

describe.skipIf(!redisReachable)("the session's writers across two app instances", () => {
  let clients: RedisClient[];
  let gate: Barrier;
  let logged: unknown[][];

  beforeAll(async () => {
    clients = [await connect(), await connect()];
  });

  beforeEach(() => {
    vi.clearAllMocks();
    logged = [];
    for (const level of ["warn", "log", "error", "info"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
    gate = barrier();
    vi.mocked(fetchCallerAccess).mockResolvedValue(undefined);
    vi.mocked(loginAsPersona).mockResolvedValue({ ok: true, login: JUDGE_LOGIN });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for await (const keys of clients[0].scanIterator({ MATCH: `${PREFIX}*`, COUNT: 100 })) {
      if (keys.length > 0) await clients[0].del(keys);
    }
    await Promise.all(clients.map((client) => client.quit()));
  });

  describe("an activity save", () => {
    it("should leave the request and the cookie signed out when logout lands before it saves", async () => {
      const [a, b] = instances();
      const cookie = await signedInCookie(a, { idle: 120 });

      const pending = page(a, cookie, "before");
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      gate.release();

      expect(await pending).toMatchObject({ status: 302, location: "/login?returnTo=%2Fpage%3Fhold%3Dbefore" });
      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await signedIn(a, cookie)).toBe(false);
      expect(await signedIn(b, cookie)).toBe(false);
      expectNothingSecretLogged(cookie);
    });

    it("should keep another instance's newer tokens, move only the clock, and go on with the winner's tokens", async () => {
      const [a, b] = instances();
      const cookie = await signedInCookie(a, { idle: 120 });
      const signedInAt = (await record(cookie)).sess.deedPoll.authenticatedAt;

      const pending = page(a, cookie, "before");
      await gate.entered;
      await request(b).get("/refresh?to=newest-access").set("Cookie", cookie).expect(204);
      gate.release();

      expect(await pending).toMatchObject({ status: 200, accessToken: "newest-access" });
      const held = await record(cookie);
      expect(held.sess.deedPoll.accessToken).toBe("newest-access");
      expect(held.sess.deedPoll.refreshToken).toBe("newest-refresh");
      expect(held.sess.deedPoll.lastSeenAt).toBeGreaterThanOrEqual(nowSeconds() - 5);
      expect(held.sess.deedPoll.authenticatedAt).toBe(signedInAt);
    });

    it("should not bring back a session that expired while the request was held", async () => {
      const [a] = instances();
      const cookie = await signedInCookie(a, { idle: 120 });

      const pending = page(a, cookie, "before");
      await gate.entered;
      await clients[0].pExpire(PREFIX + sidOf(cookie), 1);
      await waitUntilGone(PREFIX + sidOf(cookie));
      gate.release();

      expect((await pending).status).toBe(302);
      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await signedIn(a, cookie)).toBe(false);
    });

    it("should answer the timeout warning's keep-alive as signed out when logout landed first", async () => {
      const [a, b] = instances();
      const cookie = await signedInCookie(a);

      const pending = request(a)
        .post("/session/keep-alive?hold=before")
        .set("Cookie", cookie)
        .then((res) => res.status);
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      gate.release();

      expect(await pending).toBe(401);
      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
    });
  });

  describe("the /me backfill", () => {
    it("should leave the request and the cookie signed out when logout lands while api answers", async () => {
      const api = barrier();
      vi.mocked(fetchCallerAccess).mockImplementation(async () => {
        api.enter();
        await api.held;
        return DELIVERY_MANAGER as never;
      });
      const [a, b] = instances();
      const cookie = await signedInCookie(a, { withoutAccess: true });

      const pending = page(a, cookie);
      await api.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      api.release();

      expect(await pending).toMatchObject({ status: 302, location: "/login?returnTo=%2Fpage" });
      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await signedIn(a, cookie)).toBe(false);
      expectNothingSecretLogged(cookie);
    });

    it("should store the answer on what another instance refreshed meanwhile, rather than on its own snapshot", async () => {
      const api = barrier();
      vi.mocked(fetchCallerAccess).mockImplementation(async () => {
        api.enter();
        await api.held;
        return DELIVERY_MANAGER as never;
      });
      const [a, b] = instances();
      const cookie = await signedInCookie(a, { withoutAccess: true });

      const pending = page(a, cookie);
      await api.entered;
      await request(b).get("/refresh?to=newest-access").set("Cookie", cookie).expect(204);
      api.release();

      expect(await pending).toMatchObject({ status: 200, accessToken: "newest-access", capabilities: ["ACCESS_GAZETTE"] });
      const held = await record(cookie);
      expect(held.sess.deedPoll.accessToken).toBe("newest-access");
      expect(held.sess.deedPoll.user).toMatchObject({ capabilities: ["ACCESS_GAZETTE"], name: "A Caseworker" });
    });
  });

  describe("a page loaded before logout and finished after it", () => {
    it("should not let express-session's end-of-response save restore the session it changed", async () => {
      const [a, b] = instances();
      const cookie = await signedInCookie(a);

      const pending = page(a, cookie, "handler", "&mutate=1").catch(() => undefined);
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      gate.release();
      await pending;

      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await signedIn(a, cookie)).toBe(false);
      expect(await signedIn(b, cookie)).toBe(false);
    });

    it("should not let its end-of-response touch restore the session it only read", async () => {
      const [a, b] = instances();
      const cookie = await signedInCookie(a);

      const pending = page(a, cookie, "handler");
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      gate.release();
      await pending;

      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await signedIn(a, cookie)).toBe(false);
    });
  });

  describe("a session that is replaced", () => {
    it("should restart an idle session under a new anonymous id, leaving the old cookie signed out", async () => {
      const [a, b] = instances();
      const cookie = await signedInCookie(a, { idle: LIMITS.idleSeconds + 60 });

      const res = await request(b).get("/page").set("Cookie", cookie);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/session-timed-out");
      const fresh = (res.headers["set-cookie"] as unknown as string[])[0];
      expect(sidOf(fresh)).not.toBe(sidOf(cookie));
      expect(fresh).toMatch(/HttpOnly/);
      expect(fresh).toMatch(/SameSite=Lax/);
      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      const restarted = await clients[0].hGetAll(PREFIX + sidOf(fresh));
      expect(JSON.parse(restarted.sess).deedPoll).toEqual({ timedOutReturnTo: "/page" });
      expect(await signedIn(a, cookie)).toBe(false);
      expect(await signedIn(a, fresh.split(";")[0])).toBe(false);
      expect(vi.mocked(trackEvent)).toHaveBeenCalledWith("auth.session.ended", expect.objectContaining({ reason: "idle" }));
      expectNothingSecretLogged(cookie);
    });

    it("should sign in afresh under a new id, as a persona switch does, while a request on the old id is still held", async () => {
      const [a, b] = instances();
      const before = await signedInCookie(a, { idle: 120 });

      const pending = page(a, before, "before");
      await gate.entered;
      const after = await signedInCookie(b, {}, before);
      gate.release();

      expect((await pending).status).toBe(302);
      expect(sidOf(after)).not.toBe(sidOf(before));
      expect(await clients[0].exists(PREFIX + sidOf(before))).toBe(0);
      expect(await signedIn(a, before)).toBe(false);
      expect(await signedIn(a, after)).toBe(true);
      expect(await signedIn(b, after)).toBe(true);
    });

    it("should sign in afresh with the old cookie after logout, under a new id that both instances accept", async () => {
      const [a, b] = instances();
      const old = await signedInCookie(a);
      await request(b).get("/logout").set("Cookie", old).expect(204);

      const fresh = await signedInCookie(b, {}, old);

      expect(sidOf(fresh)).not.toBe(sidOf(old));
      expect(await signedIn(a, fresh)).toBe(true);
      expect(await signedIn(a, old)).toBe(false);
      expect(await page(a, fresh)).toMatchObject({ status: 200, accessToken: "old-access" });
    });
  });

  // Review finding R05: the switch waits on IDAM's password grant, and a logout can land in that wait.
  describe("a persona switch", () => {
    it("should sign nobody back in when logout lands on another instance while the persona's IDAM grant is held", async () => {
      const idam = barrier();
      vi.mocked(loginAsPersona).mockImplementation(async () => {
        idam.enter();
        await idam.held;
        return { ok: true, login: JUDGE_LOGIN };
      });
      const [a, b] = instances();
      const cookie = await signedInCookie(a);
      // Counted rather than assumed absent: the prefix is per run, not per test, so a sibling may have stored one.
      const judgesBefore = judgeSessions(await storedSubjects());

      const pending = switchTo(a, cookie);
      await idam.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      idam.release();
      const res = await pending;

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/login?returnTo=%2F");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(judgeSessions(await storedSubjects())).toBe(judgesBefore);
      expect(await signedIn(a, cookie)).toBe(false);
      expect(await signedIn(b, cookie)).toBe(false);
      expect(vi.mocked(trackEvent).mock.calls.map(([name]) => name)).not.toContain("auth.persona.switched");
      expectNothingSecretLogged(cookie);
    });

    it("should still rotate the session id, sign in as the persona on both instances and emit its event", async () => {
      const [a, b] = instances();
      const before = await signedInCookie(a);

      const res = await switchTo(a, before);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
      const after = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
      expect(sidOf(after)).not.toBe(sidOf(before));
      expect(await clients[0].exists(PREFIX + sidOf(before))).toBe(0);
      expect((await record(after)).sess.deedPoll.accessToken).toBe("judge-access");
      expect(await signedIn(a, before)).toBe(false);
      expect(await signedIn(b, after)).toBe(true);
      expect(vi.mocked(trackEvent)).toHaveBeenCalledWith("auth.persona.switched", expect.objectContaining({ toSubject: "judge-subject" }));
    });
  });

  function instances(): [express.Express, express.Express] {
    return [appInstance(clients[0], gate), appInstance(clients[1], gate)];
  }

  async function record(cookie: string): Promise<StoredRecord> {
    const hash = await clients[0].hGetAll(PREFIX + sidOf(cookie));
    const sess = JSON.parse(hash.sess) as StoredRecord["sess"];
    return { rev: hash.rev, sess };
  }

  /** The subject of every session under this run's prefix, so a session created under an unknown id still counts. */
  async function storedSubjects(): Promise<string[]> {
    const subjects: string[] = [];
    for await (const keys of clients[0].scanIterator({ MATCH: `${PREFIX}*`, COUNT: 100 })) {
      for (const key of keys) {
        const body = await clients[0].hGet(key, "sess");
        if (body) subjects.push((JSON.parse(body) as { deedPoll?: { subject?: string } }).deedPoll?.subject ?? "");
      }
    }
    return subjects;
  }

  function judgeSessions(subjects: string[]): number {
    return subjects.filter((subject) => subject === "judge-subject").length;
  }

  async function waitUntilGone(key: string): Promise<void> {
    while ((await clients[0].exists(key)) === 1) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  /** No log line from these races may carry the session id or any token. */
  function expectNothingSecretLogged(cookie: string): void {
    const text = JSON.stringify(logged.map((args) => args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : arg))));
    expect(text).not.toContain(sidOf(cookie));
    expect(text).not.toMatch(/-access|-refresh|-id-token/);
  }
});

function appInstance(client: RedisClient, gate: Barrier) {
  const store = new GuardedSessionStore({ client, prefix: PREFIX, ttl: sessionStoreTtl(LIMITS) });
  const app = express();
  app.use(expressSessionRedis({ redisConnection: client, sessionOptions: { store, secret: "a-test-secret", cookie: COOKIE } }));
  // After the session is loaded and before anything reads it: the snapshot is fixed, nothing has been written yet.
  app.use(async (req, _res, next) => {
    if (req.query.hold === "before") await hold(gate);
    next();
  });
  app.get("/seed", async (req, res) => {
    await signIn(req, currentUser(NO_ACCESS, "A Caseworker"), "a-subject", {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      idToken: "old-id-token",
      expiresAt: nowSeconds() + 3600
    });
    const stored = (req.session as unknown as { deedPoll: { lastSeenAt: number; user: unknown } }).deedPoll;
    stored.lastSeenAt -= Number(req.query.idle ?? 0);
    // A session saved before this app read `/me`, which the refresh middleware backfills.
    if (req.query.withoutAccess) stored.user = { roles: ["caseworker-deedpoll"], isAdmin: false, name: "A Caseworker" };
    await new Promise<void>((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
    res.sendStatus(204);
  });
  app.get("/logout", async (req, res) => {
    await signOut(req);
    res.sendStatus(204);
  });
  // Another instance's refresh, written without going through the middleware below.
  app.get("/refresh", async (req, res) => {
    await updateTokens(req, { accessToken: String(req.query.to), refreshToken: "newest-refresh", expiresAt: nowSeconds() + 3600 });
    res.sendStatus(204);
  });
  // An observer, before the lifetime check so that looking does not count as activity.
  app.get("/who", (req, res) => {
    res.json({ signedIn: sessionUser(req) !== undefined });
  });
  app.use(sessionLifetime({ ...LIMITS, logoutPathRegistered: false }));
  app.use(requireAuth());
  app.use(refreshMiddleware);
  app.post("/session/keep-alive", keepAlive);
  app.post("/switch-persona", express.urlencoded({ extended: false }), switchPersona);
  app.get("/page", async (req, res) => {
    if (req.query.hold === "handler") await hold(gate);
    // Left to express-session's end-of-response save.
    if (req.query.mutate) (req.session as unknown as { marker?: string }).marker = "changed";
    const user = sessionUser(req);
    res.json({ accessToken: sessionAccessToken(req), capabilities: user?.capabilities });
  });
  app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: error.name });
  });
  return app;
}

async function page(app: express.Express, cookie: string, holdAt?: "before" | "handler", extra = ""): Promise<PageAnswer> {
  const path = holdAt ? `/page?hold=${holdAt}${extra}` : "/page";
  const res = await request(app).get(path).set("Cookie", cookie);
  return { status: res.status, location: res.headers.location, ...(res.status === 200 ? (res.body as object) : {}) };
}

/** Sent at once rather than when awaited, as supertest otherwise would, so a test can hold it at a barrier. */
function switchTo(app: express.Express, cookie: string): Promise<request.Response> {
  return request(app)
    .post("/switch-persona")
    .type("form")
    .send({ persona: "judge" })
    .set("Cookie", cookie)
    .then((res) => res);
}

async function signedIn(app: express.Express, cookie: string): Promise<boolean> {
  return ((await request(app).get("/who").set("Cookie", cookie)).body as { signedIn: boolean }).signedIn;
}

async function signedInCookie(app: express.Express, options: { idle?: number; withoutAccess?: boolean } = {}, existing?: string): Promise<string> {
  const query = new URLSearchParams({ idle: String(options.idle ?? 0), ...(options.withoutAccess ? { withoutAccess: "1" } : {}) });
  const seeding = request(app).get(`/seed?${query}`);
  const seeded = await (existing ? seeding.set("Cookie", existing) : seeding).expect(204);
  return (seeded.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

async function hold(gate: Barrier): Promise<void> {
  gate.enter();
  await gate.held;
}

/** The session id inside a signed `s:<id>.<signature>` cookie. */
function sidOf(cookie: string): string {
  const value = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  return value.slice(2, value.lastIndexOf("."));
}

function barrier(): Barrier {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { enter, entered, release, held };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function connect() {
  const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379", disableOfflineQueue: true });
  client.on("error", () => {});
  await client.connect();
  return client;
}

/** Skipped only where no Redis was configured at all; with `REDIS_URL` set, an unreachable Redis fails the file. */
async function requireRedis(): Promise<boolean> {
  const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379", socket: { connectTimeout: 1_000, reconnectStrategy: false } });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.quit();
    return true;
  } catch (error) {
    if (process.env.REDIS_URL !== undefined)
      throw new Error("REDIS_URL is set but Redis is unreachable, so the session lifecycle suite cannot run", { cause: error });
    return false;
  }
}

type RedisClient = Awaited<ReturnType<typeof connect>>;

interface PageAnswer {
  status: number;
  location?: string;
  accessToken?: string;
  capabilities?: string[];
}

interface StoredRecord {
  rev: string;
  sess: {
    deedPoll: { accessToken?: string; refreshToken?: string; lastSeenAt?: number; authenticatedAt?: number; user?: Record<string, unknown> };
  };
}

interface Barrier {
  enter: () => void;
  entered: Promise<void>;
  release: () => void;
  held: Promise<void>;
}
