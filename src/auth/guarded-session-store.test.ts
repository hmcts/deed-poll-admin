/**
 * The guarded store against a real Redis, because what it guarantees is an atomicity property of Redis itself, and a
 * double of the client could only restate the Lua.
 *
 * The races use two app instances, each with its own client and its own store, sharing one key prefix — what two
 * pods sharing the product's Redis are. Each is held at a barrier rather than slept, so the interleaving is the one
 * named and not whichever the scheduler chose. They assert what a later request with the cookie sees, and what Redis
 * holds, rather than which store methods were called.
 *
 * The prefix is unique per run and only keys under it are removed afterwards, never a flush: the database may be a
 * developer's shared one.
 */
import { randomUUID } from "node:crypto";
import { currentUser } from "@hmcts/deed-poll";
import { expressSessionRedis } from "@hmcts-cft/express-session-redis";
import { RedisStore } from "connect-redis";
import express, { type NextFunction, type Request, type Response } from "express";
import type { SessionData, Store } from "express-session";
import { createClient } from "redis";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GuardedSessionStore, SessionWriteRefusedError } from "./guarded-session-store.js";
import { sessionAccessToken, sessionStoreTtl, sessionUser, signIn, signOut, touchLastSeen, updateTokens } from "./session.js";

const PREFIX = `test-e01-${randomUUID()}:`;
const LEGACY_PREFIX = `test-e01-legacy-${randomUUID()}:`;
const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000 };
const COOKIE = { httpOnly: true, secure: false, sameSite: "lax" as const, maxAge: 60_000 };
const redisReachable = await requireRedis();

describe.skipIf(!redisReachable)("the guarded session store", () => {
  let clients: RedisClient[];
  let stores: GuardedSessionStore[];

  beforeAll(async () => {
    clients = [await connect(), await connect()];
    stores = clients.map((client) => new GuardedSessionStore({ client, prefix: PREFIX, ttl: sessionStoreTtl(LIMITS) }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await removeTestKeys(clients[0]);
    await Promise.all(clients.map((client) => client.quit()));
  });

  describe("its contract", () => {
    it("should create a session it has never stored, under a fresh id", async () => {
      const sid = randomUUID();

      await set(stores[0], sid, session("first"));

      expect(await get(stores[1], sid)).toMatchObject({ marker: "first" });
      expect(await clients[0].hGet(PREFIX + sid, "rev")).toBe("1");
    });

    it("should let a session it read be saved again, moving the revision on", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData & { marker: string };

      loaded.marker = "second";
      await set(stores[0], sid, loaded);

      expect(await get(stores[1], sid)).toMatchObject({ marker: "second" });
      expect(await clients[0].hGet(PREFIX + sid, "rev")).toBe("2");
    });

    it("should refuse to create a session over a key that already exists", async () => {
      const sid = await stored("first");

      await expect(set(stores[1], sid, session("intruder"))).rejects.toMatchObject({ reason: "exists" });
      expect(await get(stores[0], sid)).toMatchObject({ marker: "first" });
    });

    it("should not create a session a second time after a create whose outcome was lost", async () => {
      const sid = randomUUID();
      const fresh = session("lost");
      vi.spyOn(clients[0], "eval").mockRejectedValueOnce(new Error("response lost"));

      await expect(set(stores[0], sid, fresh)).rejects.toThrow("response lost");
      await expect(set(stores[0], sid, fresh)).rejects.toMatchObject({ reason: "exists" });

      expect(await get(stores[1], sid)).toBeNull();
    });

    it("should refuse to save a session that has been destroyed, and leave it destroyed", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData;

      await destroy(stores[1], sid);

      await expect(set(stores[0], sid, loaded)).rejects.toBeInstanceOf(SessionWriteRefusedError);
      await expect(set(stores[0], sid, loaded)).rejects.toMatchObject({ reason: "missing" });
      expect(await clients[0].exists(PREFIX + sid)).toBe(0);
    });

    it("should refuse a save based on a revision another write has replaced", async () => {
      const sid = await stored("first");
      const stale = (await get(stores[0], sid)) as SessionData & { marker: string };
      const fresh = (await get(stores[1], sid)) as SessionData & { marker: string };

      fresh.marker = "newer";
      await set(stores[1], sid, fresh);
      stale.marker = "older";

      await expect(set(stores[0], sid, stale)).rejects.toMatchObject({ reason: "conflict" });
      expect(await get(stores[0], sid)).toMatchObject({ marker: "newer" });
    });

    it("should refuse a save from an earlier incarnation of the same id", async () => {
      const sid = await stored("first");
      const earlier = (await get(stores[0], sid)) as SessionData;
      await destroy(stores[1], sid);
      await set(stores[1], sid, session("later"));

      await expect(set(stores[0], sid, earlier)).rejects.toMatchObject({ reason: "conflict" });
      expect(await get(stores[0], sid)).toMatchObject({ marker: "later" });
    });

    it("should refuse a save after the key has expired, rather than bring it back", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData;

      await clients[0].pExpire(PREFIX + sid, 1);
      await waitUntilGone(clients[0], PREFIX + sid);

      await expect(set(stores[0], sid, loaded)).rejects.toMatchObject({ reason: "missing" });
      expect(await clients[0].exists(PREFIX + sid)).toBe(0);
    });

    it("should keep the revision and the session in one key, so neither can outlive the other", async () => {
      const sid = await stored("first");

      expect(await clients[0].type(PREFIX + sid)).toBe("hash");
      expect(Object.keys(await clients[0].hGetAll(PREFIX + sid)).sort()).toEqual(["inc", "rev", "sess"]);
      expect(await clients[0].keys(`${PREFIX}${sid}*`)).toEqual([PREFIX + sid]);
    });

    it("should not touch a key that has gone, so a touch cannot bring it back either", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData;
      await destroy(stores[1], sid);

      await touch(stores[0], sid, loaded);

      expect(await clients[0].exists(PREFIX + sid)).toBe(0);
    });

    it("should not extend another incarnation's key from a stale touch", async () => {
      const sid = await stored("first");
      const earlier = (await get(stores[0], sid)) as SessionData;
      await destroy(stores[1], sid);
      await set(stores[1], sid, session("later"));
      await clients[0].expire(PREFIX + sid, 30);

      await touch(stores[0], sid, earlier);

      expect(await clients[0].ttl(PREFIX + sid)).toBeLessThanOrEqual(30);
    });

    it("should read an unreadable record as no session at all, without naming it", async () => {
      const sid = randomUUID();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await clients[0].hSet(PREFIX + sid, { inc: "an-incarnation", rev: "not-a-number", sess: '{"cookie":{}}' });

      expect(await get(stores[0], sid)).toBeNull();
      expect(warn.mock.calls.flat().join(" ")).not.toContain(sid);
    });

    it("should delete a session it holds and report that it was there, and report one already gone as not there", async () => {
      const sid = await stored("first");

      const present = await stores[0].destroyExisting(sid);
      const gone = await stores[1].destroyExisting(sid);

      expect(present).toBe(true);
      expect(gone).toBe(false);
      expect(await clients[0].exists(PREFIX + sid)).toBe(0);
    });

    it("should report a session as there to exactly one of two instances deleting it at once", async () => {
      const sid = await stored("first");

      const reports = await Promise.all([stores[0].destroyExisting(sid), stores[1].destroyExisting(sid)]);

      expect(reports.filter(Boolean)).toHaveLength(1);
      expect(await clients[0].exists(PREFIX + sid)).toBe(0);
    });

    it("should bound a signed-in key by the absolute limit and an anonymous one by ten minutes", async () => {
      const anonymous = await stored("first");
      const signedIn = randomUUID();
      const at = Math.floor(Date.now() / 1000) - 3600;
      await set(stores[0], signedIn, {
        ...session("signed-in"),
        deedPoll: { user: { name: "A Caseworker" }, authenticatedAt: at, lastSeenAt: at }
      } as SessionData);

      expect(await clients[0].ttl(PREFIX + anonymous)).toBeLessThanOrEqual(600);
      expect(await clients[0].ttl(PREFIX + signedIn)).toBeLessThanOrEqual(36_000 - 3600 + 900);
      expect(await clients[0].ttl(PREFIX + signedIn)).toBeGreaterThan(36_000 - 3600 + 900 - 30);
    });
  });

  describe("its refresh lease", () => {
    const leased = (options: { refreshLeaseMs?: number; refreshWaitMs?: number }) =>
      new GuardedSessionStore({ client: clients[1], prefix: PREFIX, ttl: sessionStoreTtl(LIMITS), ...options });

    it("should grant one claim and make a second, from another instance, wait and then report it busy", async () => {
      const sid = await stored("first");
      const other = leased({ refreshWaitMs: 150 });

      const first = await stores[0].claimRefresh(sid, (await get(stores[0], sid)) as SessionData);
      const started = Date.now();
      const second = await other.claimRefresh(sid, (await get(other, sid)) as SessionData);

      expect(first.outcome).toBe("acquired");
      expect(second).toEqual({ outcome: "busy" });
      expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    });

    it("should let another instance claim a lease that has expired, and refuse the first holder's publish", async () => {
      const sid = await stored("first");
      const short = leased({ refreshLeaseMs: 100 });
      const stale = (await get(short, sid)) as SessionData & { marker: string };
      const claim = await short.claimRefresh(sid, stale);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const takeover = await stores[0].claimRefresh(sid, (await get(stores[0], sid)) as SessionData);
      short.attachRefreshLease(stale, (claim as { lease: string }).lease);
      stale.marker = "from-the-expired-holder";

      expect(takeover.outcome).toBe("acquired");
      await expect(set(short, sid, stale)).rejects.toMatchObject({ reason: "lease" });
      expect(await get(stores[0], sid)).toMatchObject({ marker: "first" });
    });

    it("should refuse a publish whose lease expired even when nobody has taken it over", async () => {
      const sid = await stored("first");
      const short = leased({ refreshLeaseMs: 50 });
      const loaded = (await get(short, sid)) as SessionData & { marker: string };
      const claim = await short.claimRefresh(sid, loaded);
      await new Promise((resolve) => setTimeout(resolve, 100));

      short.attachRefreshLease(loaded, (claim as { lease: string }).lease);
      loaded.marker = "late";

      await expect(set(short, sid, loaded)).rejects.toMatchObject({ reason: "lease" });
    });

    it("should publish under a held lease, give it up in the same write, and let the next claim through at once", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData & { marker: string };
      const claim = await stores[0].claimRefresh(sid, loaded);

      stores[0].attachRefreshLease(loaded, (claim as { lease: string }).lease);
      loaded.marker = "published";
      await set(stores[0], sid, loaded);

      expect(await clients[0].hGet(PREFIX + sid, "lease")).toBeNull();
      expect(await get(stores[1], sid)).toMatchObject({ marker: "published" });
      const next = leased({ refreshWaitMs: 0 });
      expect((await next.claimRefresh(sid, (await get(next, sid)) as SessionData)).outcome).toBe("acquired");
    });

    it.each(["received", "lost"])(
      "should give up a lease whose claim reply was lost and preserve the claim error when the release reply is %s",
      async (releaseReply) => {
        const sid = await stored("first");
        const claimError = new Error("Command timeout");
        let replies = 0;
        const lossy = new GuardedSessionStore({
          client: {
            eval: async (script, options) => {
              const reply = await clients[1].eval(script, options);
              if (script.includes("'TIME'") && replies++ === 0) throw claimError;
              if (script.includes("'HDEL'") && releaseReply === "lost") throw new Error("Release timeout");
              return reply;
            }
          },
          prefix: PREFIX,
          ttl: sessionStoreTtl(LIMITS)
        });

        await expect(lossy.claimRefresh(sid, (await get(lossy, sid)) as SessionData)).rejects.toBe(claimError);

        expect(await clients[0].hGet(PREFIX + sid, "lease")).toBeNull();
        const next = leased({ refreshWaitMs: 0 });
        expect((await next.claimRefresh(sid, (await get(next, sid)) as SessionData)).outcome).toBe("acquired");
      }
    );

    it("should release only the lease it was given, never one another request now holds", async () => {
      const sid = await stored("first");
      const claim = await stores[0].claimRefresh(sid, (await get(stores[0], sid)) as SessionData);

      await stores[1].releaseRefresh(sid, "somebody-elses-lease");
      expect(await clients[0].hGet(PREFIX + sid, "lease")).toBe((claim as { lease: string }).lease);

      await stores[0].releaseRefresh(sid, (claim as { lease: string }).lease);
      expect(await clients[0].hGet(PREFIX + sid, "lease")).toBeNull();
    });

    it("should take the lease with the session on destroy, so a later claim finds nothing to refresh", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData;
      await stores[0].claimRefresh(sid, loaded);

      await destroy(stores[1], sid);

      expect(await clients[0].exists(PREFIX + sid)).toBe(0);
      expect(await stores[0].claimRefresh(sid, loaded)).toEqual({ outcome: "missing" });
    });

    it("should report another incarnation of the id as a conflict, not grant it a lease", async () => {
      const sid = await stored("first");
      const earlier = (await get(stores[0], sid)) as SessionData;
      await destroy(stores[1], sid);
      await set(stores[1], sid, session("later"));

      expect(await stores[0].claimRefresh(sid, earlier)).toEqual({ outcome: "conflict" });
    });
  });

  describe("an unchanged save", () => {
    it("should move no revision when nothing but the cookie changed", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData;

      loaded.cookie = { ...loaded.cookie, expires: new Date(Date.now() + 120_000) } as SessionData["cookie"];
      await set(stores[0], sid, loaded);

      expect(await clients[0].hGet(PREFIX + sid, "rev")).toBe("1");
    });

    it("should still refuse a session that has gone", async () => {
      const sid = await stored("first");
      const loaded = (await get(stores[0], sid)) as SessionData;
      await destroy(stores[1], sid);

      await expect(set(stores[0], sid, loaded)).rejects.toMatchObject({ reason: "missing" });
      expect(await clients[0].exists(PREFIX + sid)).toBe(0);
    });
  });

  describe("two app instances sharing it", () => {
    it("should leave the cookie signed out when a refresh held before logout saves afterwards", async () => {
      const gate = barrier();
      const [a, b] = instances(gate);
      const cookie = await signedInCookie(a);

      const pending = request(a)
        .get("/slow-refresh")
        .set("Cookie", cookie)
        .then((res) => res);
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      expect(await isSignedIn(b, cookie)).toBe(false);

      gate.release();
      expect((await pending).status).toBe(500);

      expect(await isSignedIn(a, cookie)).toBe(false);
      expect(await isSignedIn(b, cookie)).toBe(false);
      expect(await sessionKeys(clients[0])).not.toContain(PREFIX + sidOf(cookie));
    });

    it("should leave the cookie signed out when the refresh saves first and logout follows", async () => {
      const [a, b] = instances();
      const cookie = await signedInCookie(a);

      await request(a).get("/slow-refresh").set("Cookie", cookie).expect(204);
      await request(b).get("/logout").set("Cookie", cookie).expect(204);

      expect(await isSignedIn(a, cookie)).toBe(false);
      expect(await isSignedIn(b, cookie)).toBe(false);
    });

    it("should not let express-session's own end-of-response save restore a logged-out session", async () => {
      const gate = barrier();
      const [a, b] = instances(gate);
      const cookie = await signedInCookie(a);

      const pending = request(a)
        .get("/slow-mutation")
        .set("Cookie", cookie)
        .then(
          (res) => res,
          () => undefined
        );
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      gate.release();
      await pending;

      expect(await isSignedIn(a, cookie)).toBe(false);
      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
    });

    it("should not let a request that changed nothing bring the key back when it ends", async () => {
      const gate = barrier();
      const [a, b] = instances(gate);
      const cookie = await signedInCookie(a);

      const pending = request(a)
        .get("/slow-read")
        .set("Cookie", cookie)
        .then((res) => res);
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      gate.release();
      await pending;

      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await isSignedIn(a, cookie)).toBe(false);
    });

    it("should refuse an activity save held across logout", async () => {
      const gate = barrier();
      const [a, b] = instances(gate);
      const cookie = await signedInCookie(a);

      const pending = request(a)
        .get("/slow-touch")
        .set("Cookie", cookie)
        .then((res) => res);
      await gate.entered;
      await request(b).get("/logout").set("Cookie", cookie).expect(204);
      gate.release();

      expect((await pending).status).toBe(500);
      expect(await isSignedIn(a, cookie)).toBe(false);
    });

    it("should not let an older snapshot's refresh roll back tokens another instance has since stored", async () => {
      const gate = barrier();
      const [a, b] = instances(gate);
      const cookie = await signedInCookie(a);

      const stale = request(a)
        .get("/slow-refresh")
        .set("Cookie", cookie)
        .then((res) => res);
      await gate.entered;
      await request(b).get("/refresh?to=newest-access").set("Cookie", cookie).expect(204);
      gate.release();

      expect((await stale).status).toBe(500);
      expect(await tokenSeenBy(a, cookie)).toBe("newest-access");
      expect(await tokenSeenBy(b, cookie)).toBe("newest-access");
    });

    it("should refuse a save to a session that expired while the request was held", async () => {
      const gate = barrier();
      const [a] = instances(gate);
      const cookie = await signedInCookie(a);

      const pending = request(a)
        .get("/slow-refresh")
        .set("Cookie", cookie)
        .then((res) => res);
      await gate.entered;
      await clients[0].pExpire(PREFIX + sidOf(cookie), 1);
      await waitUntilGone(clients[0], PREFIX + sidOf(cookie));
      gate.release();

      expect((await pending).status).toBe(500);
      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await isSignedIn(a, cookie)).toBe(false);
    });

    it("should not let a save from before a sign-in restore the session id that sign-in replaced", async () => {
      const gate = barrier();
      const [a, b] = instances(gate);
      const before = await signedInCookie(a);

      const pending = request(a)
        .get("/slow-refresh")
        .set("Cookie", before)
        .then((res) => res);
      await gate.entered;
      const after = (await request(b).get("/seed").set("Cookie", before).expect(204)).headers["set-cookie"] as unknown as string[];
      gate.release();

      expect((await pending).status).toBe(500);
      expect(sidOf(after[0])).not.toBe(sidOf(before));
      expect(await clients[0].exists(PREFIX + sidOf(before))).toBe(0);
      expect(await isSignedIn(a, before)).toBe(false);
      expect(await isSignedIn(a, after[0].split(";")[0])).toBe(true);
    });

    it("should sign in afresh with the old cookie after logout, under a new session id", async () => {
      const [a, b] = instances();
      const old = await signedInCookie(a);
      await request(b).get("/logout").set("Cookie", old).expect(204);

      const fresh = (await request(b).get("/seed").set("Cookie", old).expect(204)).headers["set-cookie"] as unknown as string[];

      expect(sidOf(fresh[0])).not.toBe(sidOf(old));
      expect(await isSignedIn(a, fresh[0].split(";")[0])).toBe(true);
      expect(await isSignedIn(a, old)).toBe(false);
    });

    it("should start an anonymous sign-in flow, and keep it, for a browser with no session", async () => {
      const [a, b] = instances();

      const started = await request(a).get("/start-flow").expect(204);
      const cookie = (started.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

      expect(((await request(b).get("/flow").set("Cookie", cookie)).body as { state?: string }).state).toBe("a-state");
    });

    function instances(gate?: Barrier): [express.Express, express.Express] {
      return [appInstance(clients[0], stores[0], gate), appInstance(clients[1], stores[1])];
    }
  });

  /**
   * The rollout boundary: an instance still on connect-redis uses the old prefix, so neither version can read or
   * write the other's sessions. Crossing versions signs a user out; it never signs anyone in or puts a session back.
   */
  describe("alongside an instance still running the old store", () => {
    it("should treat the old instance's session as signed out, and the old instance the new one's", async () => {
      const legacy = appInstance(clients[0], new RedisStore({ client: clients[0], prefix: LEGACY_PREFIX }));
      const guarded = appInstance(clients[1], stores[1]);

      const legacyCookie = await signedInCookie(legacy);
      const guardedCookie = await signedInCookie(guarded);

      expect(await isSignedIn(guarded, legacyCookie)).toBe(false);
      expect(await isSignedIn(legacy, guardedCookie)).toBe(false);
    });

    it("should leave a logged-out guarded session out even when the old instance writes with its cookie", async () => {
      const legacy = appInstance(clients[0], new RedisStore({ client: clients[0], prefix: LEGACY_PREFIX }));
      const guarded = appInstance(clients[1], stores[1]);
      const cookie = await signedInCookie(guarded);
      await request(guarded).get("/logout").set("Cookie", cookie).expect(204);

      await request(legacy).get("/refresh?to=from-the-old-instance").set("Cookie", cookie);

      expect(await clients[0].exists(PREFIX + sidOf(cookie))).toBe(0);
      expect(await isSignedIn(guarded, cookie)).toBe(false);
    });
  });

  async function stored(marker: string): Promise<string> {
    const sid = randomUUID();
    await set(stores[0], sid, session(marker));
    return sid;
  }
});

function appInstance(client: RedisClient, store: Store, gate?: Barrier) {
  const app = express();
  app.use(expressSessionRedis({ redisConnection: client, sessionOptions: { store, secret: "a-test-secret", cookie: COOKIE } }));
  app.get("/seed", async (req, res) => {
    await signIn(req, currentUser({ staff: true, judicial: false, capabilities: [] }, "A Caseworker"), "a-subject", {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      idToken: "an-id-token",
      expiresAt: nowSeconds() + 60
    });
    res.sendStatus(204);
  });
  app.get("/slow-refresh", async (req, res) => {
    await hold(gate);
    await updateTokens(req, { accessToken: "stale-access", refreshToken: "stale-refresh", expiresAt: nowSeconds() + 3600 });
    res.sendStatus(204);
  });
  app.get("/refresh", async (req, res) => {
    await updateTokens(req, { accessToken: String(req.query.to), refreshToken: "a-refresh", expiresAt: nowSeconds() + 3600 });
    res.sendStatus(204);
  });
  // Changes the session and leaves the write to express-session's end-of-response save.
  app.get("/slow-mutation", async (req, res) => {
    await hold(gate);
    (req.session as unknown as { marker?: string }).marker = "changed";
    res.sendStatus(204);
  });
  app.get("/slow-read", async (req, res) => {
    await hold(gate);
    res.json({ signedIn: sessionUser(req) !== undefined });
  });
  app.get("/slow-touch", async (req, res) => {
    await hold(gate);
    await touchLastSeen(req);
    res.sendStatus(204);
  });
  app.get("/start-flow", (req, res) => {
    (req.session as unknown as { deedPoll?: object }).deedPoll = { flow: { state: "a-state" } };
    res.sendStatus(204);
  });
  app.get("/flow", (req, res) => {
    res.json((req.session as unknown as { deedPoll?: { flow?: object } }).deedPoll?.flow ?? {});
  });
  app.get("/logout", async (req, res) => {
    await signOut(req);
    res.sendStatus(204);
  });
  app.get("/who", (req, res) => {
    res.json({ signedIn: sessionUser(req) !== undefined, accessToken: sessionAccessToken(req) });
  });
  app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: error.name });
  });
  return app;
}

async function hold(gate: Barrier | undefined): Promise<void> {
  gate?.enter();
  await gate?.held;
}

async function signedInCookie(app: express.Express): Promise<string> {
  const seeded = await request(app).get("/seed").expect(204);
  return (seeded.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

async function isSignedIn(app: express.Express, cookie: string): Promise<boolean> {
  return ((await request(app).get("/who").set("Cookie", cookie)).body as { signedIn: boolean }).signedIn;
}

async function tokenSeenBy(app: express.Express, cookie: string): Promise<string | undefined> {
  return ((await request(app).get("/who").set("Cookie", cookie)).body as { accessToken?: string }).accessToken;
}

/** The session id inside a signed `s:<id>.<signature>` cookie. */
function sidOf(cookie: string): string {
  const value = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  return value.slice(2, value.lastIndexOf("."));
}

function session(marker: string): SessionData {
  return { cookie: { originalMaxAge: 60_000 }, marker } as unknown as SessionData;
}

function get(store: Store, sid: string): Promise<SessionData | null | undefined> {
  return new Promise((resolve, reject) => store.get(sid, (error, sess) => (error ? reject(error) : resolve(sess))));
}

function set(store: Store, sid: string, sess: SessionData): Promise<void> {
  return new Promise((resolve, reject) => store.set(sid, sess, (error) => (error ? reject(error) : resolve())));
}

function touch(store: Store, sid: string, sess: SessionData): Promise<void> {
  return new Promise((resolve) => store.touch?.(sid, sess, () => resolve()));
}

function destroy(store: Store, sid: string): Promise<void> {
  return new Promise((resolve, reject) => store.destroy(sid, (error) => (error ? reject(error) : resolve())));
}

async function waitUntilGone(client: RedisClient, key: string): Promise<void> {
  while ((await client.exists(key)) === 1) await new Promise((resolve) => setTimeout(resolve, 5));
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

async function connect(): Promise<RedisClient> {
  const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379", disableOfflineQueue: true });
  client.on("error", () => {});
  await client.connect();
  return client;
}

async function sessionKeys(client: RedisClient): Promise<string[]> {
  const found: string[] = [];
  for await (const keys of client.scanIterator({ MATCH: `${PREFIX}*`, COUNT: 100 })) found.push(...keys);
  return found;
}

async function removeTestKeys(client: RedisClient): Promise<void> {
  for (const prefix of [PREFIX, LEGACY_PREFIX]) {
    for await (const keys of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      if (keys.length > 0) await client.del(keys);
    }
  }
}

/**
 * Skipped only where no Redis was configured at all. With `REDIS_URL` set, an unreachable Redis fails the file: the
 * plan's validation exports it, and these are the only tests of the invariant against the real store.
 */
async function requireRedis(): Promise<boolean> {
  const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379", socket: { connectTimeout: 1_000, reconnectStrategy: false } });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.quit();
    return true;
  } catch (error) {
    if (process.env.REDIS_URL !== undefined)
      throw new Error("REDIS_URL is set but Redis is unreachable, so the session revocation suite cannot run", { cause: error });
    return false;
  }
}

type RedisClient = Awaited<ReturnType<typeof connect>>;

interface Barrier {
  enter: () => void;
  entered: Promise<void>;
  release: () => void;
  held: Promise<void>;
}
