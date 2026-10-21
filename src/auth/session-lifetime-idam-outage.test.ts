/**
 * A timed-out session during an IDAM discovery outage, end to end (review finding R04, plan
 * `docs/plans/20261021-r04-timeout-during-idam-outage.md`).
 *
 * `openid-client` runs for real against a loopback discovery endpoint, and the session lives in real Redis under a
 * per-run prefix that is removed afterwards, never flushed. What is asserted is the response, what Redis holds and the
 * events emitted: the end-session lookup used to come before the local end, so an outage left every timed-out request
 * a 500, the old key standing and the event emitted again on the next one.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { currentUser } from "@hmcts/deed-poll";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { expressSessionRedis } from "@hmcts-cft/express-session-redis";
import express, { type NextFunction, type Request, type Response } from "express";
import { createClient } from "redis";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedSessionStore } from "./guarded-session-store.js";
import { resetIdamDiscovery } from "./idam.js";
import { sessionStoreTtl, sessionUser, signIn } from "./session.js";
import { sessionLifetime } from "./session-lifetime.js";

vi.mock("./settings.js", () => ({ idamSettings: () => idam.config }));
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const PREFIX = `test-r04-outage-${randomUUID()}:`;
const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000 };
const COOKIE = { httpOnly: true, secure: false, sameSite: "lax" as const, maxAge: 60_000 };
const idam = vi.hoisted(() => ({ config: { issuerUrl: "", clientId: "deed-poll-admin", clientSecret: "a-secret", redirectUri: "", scope: "openid" } }));
const redisReachable = await requireRedis();

describe.skipIf(!redisReachable)("a timed-out session while IDAM discovery fails", () => {
  let client: RedisClient;
  let server: Server;
  let base: string;
  let discoveryHealthy: boolean;

  beforeAll(async () => {
    client = await connect();
    server = createServer((_req, res) => {
      if (!discoveryHealthy) return void res.writeHead(503).end();
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          issuer: `${base}/o`,
          authorization_endpoint: `${base}/o/authorize`,
          token_endpoint: `${base}/o/token`,
          jwks_uri: `${base}/o/jwks`,
          end_session_endpoint: `${base}/o/endSession`,
          response_types_supported: ["code"]
        })
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    idam.config.issuerUrl = `${base}/o`;
    idam.config.redirectUri = "http://localhost:3000/oauth2/callback";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetIdamDiscovery();
    discoveryHealthy = false;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for await (const keys of client.scanIterator({ MATCH: `${PREFIX}*`, COUNT: 100 })) {
      if (keys.length > 0) await client.del(keys);
    }
    await client.quit();
    server.closeAllConnections();
    server.close();
  });

  it("should end an idle GET on the first request, delete the old key and emit one event with the old sid", async () => {
    const app = appInstance(client);
    const cookie = await idleCookie(app);

    const res = await request(app).get("/page").set("Cookie", cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/session-timed-out");
    expect(await client.exists(PREFIX + sidOf(cookie))).toBe(0);
    const fresh = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    expect(sidOf(fresh)).not.toBe(sidOf(cookie));
    expect(await signedIn(app, fresh)).toBe(false);
    expect(endedEvents()).toEqual([expect.objectContaining({ reason: "idle", sid: hashed(sidOf(cookie)) })]);
  });

  it("should emit nothing more when the old cookie comes back, because the session is already gone", async () => {
    const app = appInstance(client);
    const cookie = await idleCookie(app);
    await request(app).get("/page").set("Cookie", cookie).expect(302);

    const again = await request(app).get("/page").set("Cookie", cookie);

    expect(again.status).toBe(200);
    expect(again.body).toEqual({ signedIn: false });
    expect(endedEvents()).toHaveLength(1);
  });

  it("should end an idle POST on the first request with 401", async () => {
    const app = appInstance(client);
    const cookie = await idleCookie(app);

    const res = await request(app).post("/page").set("Cookie", cookie);

    expect(res.status).toBe(401);
    expect(res.text).toContain('href="/login"');
    expect(await client.exists(PREFIX + sidOf(cookie))).toBe(0);
    expect(endedEvents()).toHaveLength(1);
  });

  it("should still send an idle GET to IDAM's end-session page when discovery succeeds", async () => {
    discoveryHealthy = true;
    const app = appInstance(client);
    const cookie = await idleCookie(app);

    const res = await request(app).get("/page").set("Cookie", cookie);

    expect(res.status).toBe(302);
    const away = new URL(res.headers.location);
    expect(`${away.origin}${away.pathname}`).toBe(`${base}/o/endSession`);
    expect(away.searchParams.get("id_token_hint")).toBe("an-id-token");
    expect(away.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/");
    expect(await client.exists(PREFIX + sidOf(cookie))).toBe(0);
  });

  function endedEvents(): unknown[] {
    return vi
      .mocked(trackEvent)
      .mock.calls.filter(([name]) => name === "auth.session.ended")
      .map(([, properties]) => properties);
  }
});

function appInstance(client: RedisClient) {
  const store = new GuardedSessionStore({ client, prefix: PREFIX, ttl: sessionStoreTtl(LIMITS) });
  const app = express();
  app.use(expressSessionRedis({ redisConnection: client, sessionOptions: { store, secret: "a-test-secret", cookie: COOKIE } }));
  app.get("/seed", async (req, res) => {
    await signIn(req, currentUser({ staff: true, judicial: false, capabilities: [] }, "A Caseworker"), "a-subject", {
      accessToken: "an-access-token",
      refreshToken: "a-refresh-token",
      idToken: "an-id-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });
    (req.session as unknown as { deedPoll: { lastSeenAt: number } }).deedPoll.lastSeenAt -= LIMITS.idleSeconds + 60;
    await new Promise<void>((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
    res.sendStatus(204);
  });
  // Stands in for the timed-out page, so the POST branch's model is visible without the Nunjucks environment.
  app.use((_req, res, next) => {
    res.render = ((_view: string, model?: { signInHref?: string }) => res.send(`<a href="${model?.signInHref}">`)) as Response["render"];
    next();
  });
  app.use(sessionLifetime({ ...LIMITS, logoutPathRegistered: false }));
  app.all("/page", (req, res) => {
    res.json({ signedIn: sessionUser(req) !== undefined });
  });
  app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: error.name });
  });
  return app;
}

async function idleCookie(app: express.Express): Promise<string> {
  const seeded = await request(app).get("/seed").expect(204);
  return (seeded.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

async function signedIn(app: express.Express, cookie: string): Promise<boolean> {
  return ((await request(app).get("/page").set("Cookie", cookie)).body as { signedIn: boolean }).signedIn;
}

/** The session id inside a signed `s:<id>.<signature>` cookie. */
function sidOf(cookie: string): string {
  const value = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  return value.slice(2, value.lastIndexOf("."));
}

function hashed(sid: string): string {
  return createHash("sha256").update(sid).digest("hex").slice(0, 16);
}

async function connect() {
  const redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379", disableOfflineQueue: true });
  redis.on("error", () => {});
  await redis.connect();
  return redis;
}

/** Skipped only where no Redis was configured at all; with `REDIS_URL` set, an unreachable Redis fails the file. */
async function requireRedis(): Promise<boolean> {
  const redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379", socket: { connectTimeout: 1_000, reconnectStrategy: false } });
  redis.on("error", () => {});
  try {
    await redis.connect();
    await redis.quit();
    return true;
  } catch (error) {
    if (process.env.REDIS_URL !== undefined) throw new Error("REDIS_URL is set but Redis is unreachable, so the R04 outage suite cannot run", { cause: error });
    return false;
  }
}

type RedisClient = Awaited<ReturnType<typeof connect>>;
