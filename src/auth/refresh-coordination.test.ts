/**
 * The token refresh across two app instances sharing one real Redis, through the real `refreshMiddleware` and the
 * guarded store (review finding E01, Task 2 of `docs/plans/20261020-e01-session-revocation.md`).
 *
 * IDAM and `/me` are stubbed, and the IDAM call is held at a barrier so each interleaving is the one named rather than
 * the scheduler's. What is asserted is what each response carried, what Redis holds afterwards and how many times IDAM
 * was asked — not which store methods ran. Keys live under a per-run prefix that is removed afterwards, never flushed.
 */
import { randomUUID } from "node:crypto";
import { currentUser } from "@hmcts/deed-poll";
import { expressSessionRedis } from "@hmcts-cft/express-session-redis";
import express, { type NextFunction, type Request, type Response } from "express";
import { createClient } from "redis";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCallerAccess } from "./caller-access.js";
import { GuardedSessionStore, type SessionRedis } from "./guarded-session-store.js";
import { refreshTokens } from "./idam.js";
import { refreshMiddleware } from "./refresh-middleware.js";
import { sessionAccessToken, sessionStoreTtl, sessionUser, signIn, signOut } from "./session.js";

vi.mock("./idam.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idam.js")>()),
  refreshTokens: vi.fn()
}));
vi.mock("./caller-access.js", () => ({ fetchCallerAccess: vi.fn() }));
vi.mock("./settings.js", () => ({ idamSettings: () => ({ issuerUrl: "https://idam.example/o", clientId: "deed-poll-admin" }) }));
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const PREFIX = `test-e01-refresh-${randomUUID()}:`;
const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000 };
const COOKIE = { httpOnly: true, secure: false, sameSite: "lax" as const, maxAge: 60_000 };
const NO_ACCESS = { staff: true, judicial: false, capabilities: [] };
const DELIVERY_MANAGER = { staff: true, judicial: false, capabilities: ["ACCESS_GAZETTE"] };
const redisReachable = await requireRedis();

describe.skipIf(!redisReachable)("token refresh across two app instances", () => {
  let clients: RedisClient[];
  let idam: Barrier;

  beforeAll(async () => {
    clients = [await connect(), await connect()];
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetchCallerAccess).mockResolvedValue(undefined);
    idam = barrier();
    // The first call is held until released and answers "renewed"; any later call answers at once, as "takeover".
    vi.mocked(refreshTokens).mockImplementation(async () => {
      const first = vi.mocked(refreshTokens).mock.calls.length === 1;
      if (first) {
        idam.enter();
        await idam.held;
      }
      return { ok: true, tokens: tokens(first ? "renewed" : "takeover") };
    });
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

  it("should ask IDAM once when both instances refresh at once, and give both requests the new tokens", async () => {
    const [a, b] = instances();
    const cookie = await signedInCookie(a, 60);

    const first = who(a, cookie);
    await idam.entered;
    const second = who(b, cookie);
    await pause(250);
    idam.release();

    expect(await first).toMatchObject({ status: 200, accessToken: "renewed-access" });
    expect(await second).toMatchObject({ status: 200, accessToken: "renewed-access" });
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    const held = await record(cookie);
    expect(held.sess.deedPoll.accessToken).toBe("renewed-access");
    expect(held.sess.deedPoll.refreshToken).toBe("renewed-refresh");
    // Created at 1 and published at 2: the waiter re-read the session and wrote nothing back over it.
    expect(held.rev).toBe("2");
    expect(held.lease).toBeUndefined();
  });

  it("should leave the cookie signed out when logout lands while IDAM is answering", async () => {
    const [a, b] = instances();
    const cookie = await signedInCookie(a, 60);

    const pending = who(a, cookie);
    await idam.entered;
    await request(b).get("/logout").set("Cookie", cookie).expect(204);
    idam.release();

    expect(await pending).toMatchObject({ status: 302, location: "/login?returnTo=%2Fwho" });
    expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
    expect(await who(a, cookie)).toMatchObject({ signedIn: false });
    expect(await who(b, cookie)).toMatchObject({ signedIn: false });
  });

  it("should refuse to publish once its lease has expired, keeping the tokens of the request that took over", async () => {
    const [a, b] = instances({ refreshLeaseMs: 300 });
    const cookie = await signedInCookie(a, 60);

    const stale = who(a, cookie);
    await idam.entered;
    await pause(400);
    expect(await who(b, cookie)).toMatchObject({ status: 200, accessToken: "takeover-access" });
    idam.release();

    expect((await stale).status).toBe(500);
    expect((await record(cookie)).sess.deedPoll.accessToken).toBe("takeover-access");
    expect(await who(a, cookie)).toMatchObject({ accessToken: "takeover-access" });
  });

  it("should stop waiting after its bound, and go on with a token that still works", async () => {
    const [a, b] = instances({}, { refreshWaitMs: 300 });
    const cookie = await signedInCookie(a, 60);

    const owner = who(a, cookie);
    await idam.entered;

    expect(await who(b, cookie)).toMatchObject({ status: 200, accessToken: "old-access" });
    idam.release();
    expect(await owner).toMatchObject({ status: 200, accessToken: "renewed-access" });
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("should fail a request whose wait runs out on a token that has already expired", async () => {
    const [a, b] = instances({}, { refreshWaitMs: 300 });
    const cookie = await signedInCookie(a, -30);

    const owner = who(a, cookie);
    await idam.entered;

    expect((await who(b, cookie)).status).toBe(500);
    idam.release();
    expect(await owner).toMatchObject({ status: 200, accessToken: "renewed-access" });
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("should keep another instance's write that lands while IDAM is answering, rather than its own snapshot", async () => {
    const [a, b] = instances();
    const cookie = await signedInCookie(a, 60);

    const pending = who(a, cookie);
    await idam.entered;
    await request(b).get("/mark").set("Cookie", cookie).expect(204);
    idam.release();

    expect(await pending).toMatchObject({ status: 200, accessToken: "renewed-access" });
    const held = await record(cookie);
    expect(held.sess.marker).toBe("from-b");
    expect(held.sess.deedPoll.accessToken).toBe("renewed-access");
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("should store the new /me answer in the same write as the tokens", async () => {
    vi.mocked(fetchCallerAccess).mockResolvedValue(DELIVERY_MANAGER as never);
    const [a] = instances();
    const cookie = await signedInCookie(a, 60);

    const pending = who(a, cookie);
    await idam.entered;
    idam.release();

    expect(await pending).toMatchObject({ status: 200, accessToken: "renewed-access", capabilities: ["ACCESS_GAZETTE"] });
    const held = await record(cookie);
    expect(held.rev).toBe("2");
    expect(held.sess.deedPoll.user).toMatchObject({ capabilities: ["ACCESS_GAZETTE"], name: "A Caseworker" });
  });

  it("should release the lease and leave the session as it was when IDAM is unreachable", async () => {
    vi.mocked(refreshTokens).mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN"));
    const [a, b] = instances({}, { refreshWaitMs: 5_000 });
    const cookie = await signedInCookie(a, 60);

    expect(await who(a, cookie)).toMatchObject({ status: 200, accessToken: "old-access" });
    const held = await record(cookie);
    expect(held.lease).toBeUndefined();
    expect(held.rev).toBe("1");

    // Not held behind a lease nobody owns: the next request refreshes straight away.
    const started = Date.now();
    expect(await who(b, cookie)).toMatchObject({ status: 200, accessToken: "takeover-access" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("should sign out, and delete the session with its lease, when IDAM refuses the refresh token", async () => {
    vi.mocked(refreshTokens).mockResolvedValueOnce({ ok: false, reason: "invalid_grant" });
    const [a] = instances();
    const cookie = await signedInCookie(a, 60);

    expect(await who(a, cookie)).toMatchObject({ status: 302 });
    expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
  });

  it("should fail closed, without asking IDAM, when Redis fails the claim", async () => {
    const [a] = instances({ client: failingScripts(clients[0], "'leaseUntil', tostring") });
    const cookie = await signedInCookie(a, 60);

    expect((await who(a, cookie)).status).toBe(500);
    expect(refreshTokens).not.toHaveBeenCalled();
    expect((await record(cookie)).sess.deedPoll.accessToken).toBe("old-access");
  });

  it("should still store a refresh whose browser gave up waiting for it, and free the lease", async () => {
    const [a] = instances();
    const cookie = await signedInCookie(a, 60);

    const abandoned = request(a)
      .get("/who")
      .set("Cookie", cookie)
      .timeout(50)
      .then(
        () => "answered",
        () => "aborted"
      );
    await idam.entered;
    expect(await abandoned).toBe("aborted");
    idam.release();

    await until(async () => (await record(cookie)).sess.deedPoll.accessToken === "renewed-access");
    expect((await record(cookie)).lease).toBeUndefined();
  });

  function instances(aOptions: Partial<StoreOptions> = {}, bOptions: Partial<StoreOptions> = {}): [express.Express, express.Express] {
    return [appInstance(clients[0], aOptions), appInstance(clients[1], bOptions)];
  }

  async function record(cookie: string): Promise<StoredRecord> {
    const hash = await clients[0].hGetAll(PREFIX + sidOf(cookie));
    return { rev: hash.rev, lease: hash.lease, sess: JSON.parse(hash.sess) as StoredRecord["sess"] };
  }
});

function appInstance(client: RedisClient, { client: storeClient, ...options }: Partial<StoreOptions>) {
  const store = new GuardedSessionStore({ client: storeClient ?? client, prefix: PREFIX, ttl: sessionStoreTtl(LIMITS), ...options });
  const app = express();
  app.use(expressSessionRedis({ redisConnection: client, sessionOptions: { store, secret: "a-test-secret", cookie: COOKIE } }));
  app.get("/seed", async (req, res) => {
    await signIn(req, currentUser(NO_ACCESS, "A Caseworker"), "a-subject", {
      ...tokens("old"),
      expiresAt: nowSeconds() + Number(req.query.expiresIn)
    });
    res.sendStatus(204);
  });
  app.get("/logout", async (req, res) => {
    await signOut(req);
    res.sendStatus(204);
  });
  // Another writer of the same session: saves a field the refresh knows nothing about.
  app.get("/mark", async (req, res) => {
    (req.session as unknown as { marker?: string }).marker = "from-b";
    await new Promise<void>((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
    res.sendStatus(204);
  });
  app.use(refreshMiddleware);
  app.get("/who", (req, res) => {
    const user = sessionUser(req);
    res.json({ signedIn: user !== undefined, accessToken: sessionAccessToken(req), capabilities: user?.capabilities });
  });
  app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: error.name });
  });
  return app;
}

async function who(app: express.Express, cookie: string): Promise<WhoAnswer> {
  const res = await request(app).get("/who").set("Cookie", cookie);
  return { status: res.status, location: res.headers.location, ...(res.status === 200 ? (res.body as object) : {}) } as WhoAnswer;
}

async function signedInCookie(app: express.Express, expiresIn: number): Promise<string> {
  const seeded = await request(app).get(`/seed?expiresIn=${expiresIn}`).expect(204);
  return (seeded.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

function tokens(name: string) {
  return { accessToken: `${name}-access`, refreshToken: `${name}-refresh`, idToken: `${name}-id`, expiresAt: nowSeconds() + 3600 };
}

/** A client whose scripts containing `marker` fail as a dropped connection would, and whose other commands are real. */
function failingScripts(client: RedisClient, marker: string): SessionRedis {
  return {
    eval: (script, options) => (script.includes(marker) ? Promise.reject(new Error("Socket closed unexpectedly")) : client.eval(script, options))
  };
}

/** The session id inside a signed `s:<id>.<signature>` cookie. */
function sidOf(cookie: string): string {
  const value = decodeURIComponent(cookie.split("=")[1]);
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

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condition not met within 5 seconds");
    await pause(10);
  }
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
      throw new Error("REDIS_URL is set but Redis is unreachable, so the refresh coordination suite cannot run", { cause: error });
    return false;
  }
}

type RedisClient = Awaited<ReturnType<typeof connect>>;

interface StoreOptions {
  client: SessionRedis;
  refreshLeaseMs: number;
  refreshWaitMs: number;
}

interface WhoAnswer {
  status: number;
  location?: string;
  signedIn?: boolean;
  accessToken?: string;
  capabilities?: string[];
}

interface StoredRecord {
  rev: string;
  lease?: string;
  sess: { marker?: string; deedPoll: { accessToken?: string; refreshToken?: string; user?: Record<string, unknown> } };
}

interface Barrier {
  enter: () => void;
  entered: Promise<void>;
  release: () => void;
  held: Promise<void>;
}
