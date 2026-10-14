/**
 * The session store over a real Redis, because every other test of it is mocked.
 *
 * `app.test.ts` doubles `@hmcts-cft/express-session-redis` and `redis`; the library's own tests double
 * `connect-redis` and `express-session`. So the whole swap from Postgres to Redis is asserted against
 * doubles, and the failures that matters for are exactly the ones a double cannot have: a `redis` and
 * `connect-redis` pair whose versions disagree, a store that accepts a write and returns nothing on the
 * read, a prefix or TTL that means the key is not where the next request looks. All of those produce a
 * fully green unit run and a service where nobody can stay signed in.
 *
 * The Playwright suite used to be the backstop for this. It no longer runs in any pipeline — see
 * `docs/PIPELINES.md` — and it needs browsers and a running app, so it is not the backstop here either.
 *
 * Requires a reachable Redis, served by this repo's `docker compose` on 6379. Skipped when there is none,
 * because the Jenkins nodejs test stage runs `yarn test` on a bare agent with no services — the only such
 * skip left in the repo, now that the deleted `apps/postgres` migration tests have gone with the data
 * access layer. Treat this as local-only coverage until a stage provides one.
 *
 * Driven over real HTTP rather than by calling the store directly. Calling `store.set`/`store.get` would
 * test `connect-redis` and not the wiring — what is being pinned is that a cookie issued on one request
 * carries a session that is still there on the next, which is the behaviour the app depends on.
 */

import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expressSessionRedis } from "@hmcts-cft/express-session-redis";
import express from "express";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionStoreTtl } from "./auth/session.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
/** The prefix `src/app.ts` passes. Restated here so this asserts against a real keyspace. */
const PREFIX = "admin-sess:";

const redisReachable = await canConnect();

describe.skipIf(!redisReachable)("a session through a real Redis", () => {
  let client: Awaited<ReturnType<typeof connect>>;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    client = await connect();

    const app = express();
    app.use(
      expressSessionRedis({
        redisConnection: client,
        sessionOptions: { secret: "a-test-secret", cookie: { maxAge: 60_000, httpOnly: true, secure: false, sameSite: "lax" } },
        storeOptions: { prefix: PREFIX }
      })
    );
    // Deliberately writes on the first request and only reads on the second: `saveUninitialized` is false,
    // so a session that is never written is never stored, and a test that only read would pass against a
    // store that persists nothing.
    app.get("/write", (req, res) => {
      (req.session as unknown as { subject?: string }).subject = "a-caseworker";
      req.session.save(() => res.json({ id: req.sessionID }));
    });
    app.get("/read", (req, res) => {
      res.json({ id: req.sessionID, subject: (req.session as unknown as { subject?: string }).subject });
    });

    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterAll(async () => {
    await close?.();
    await client?.quit();
  });

  it("gives a later request the session the earlier one wrote", async () => {
    const written = await fetch(`${baseUrl}/write`);
    const cookie = written.headers.get("set-cookie");
    const { id } = (await written.json()) as { id: string };

    expect(cookie).toBeTruthy();

    const read = await fetch(`${baseUrl}/read`, { headers: { cookie: cookie as string } });

    expect(await read.json()).toEqual({ id, subject: "a-caseworker" });
  });

  it("stores the session under the per-component prefix, not the library default", async () => {
    // The prefix is the one thing `app.test.ts` can only assert as an argument. If it were wrong the round
    // trip above would still pass — both requests would look in the same wrong place — while `deed-poll-web`
    // shared this app's keyspace.
    const written = await fetch(`${baseUrl}/write`);
    const { id } = (await written.json()) as { id: string };

    expect(await client.exists(`${PREFIX}${id}`)).toBe(1);
    expect(await client.exists(`sess:${id}`)).toBe(0);
  });

  it("expires the key, so an abandoned session is not kept forever", async () => {
    const written = await fetch(`${baseUrl}/write`);
    const { id } = (await written.json()) as { id: string };

    // From the cookie's `maxAge`, which is what `connect-redis` derives its TTL from. Positive rather than
    // an exact value: the assertion is that a TTL was set at all, not how many seconds have elapsed since.
    expect(await client.ttl(`${PREFIX}${id}`)).toBeGreaterThan(0);
  });
});

/**
 * The key lifetimes OWASP plan 03 sets, through a real Redis, because the point is what connect-redis does with the
 * TTL function on every write and every touch, and a double cannot show that. The limits are the app's defaults.
 */
describe.skipIf(!redisReachable)("session key lifetimes through a real Redis", () => {
  const LIMITS = { idleSeconds: 1800, absoluteSeconds: 36_000 };
  const SIGNED_IN_AN_HOUR_AGO = () => Math.floor(Date.now() / 1000) - 3600;
  /** The most a signed-in key may have left: its remaining absolute lifetime plus fifteen minutes. */
  const SIGNED_IN_CEILING = 36_000 - 3600 + 900;
  let client: Awaited<ReturnType<typeof connect>>;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    client = await connect();

    const app = express();
    app.use(
      expressSessionRedis({
        redisConnection: client,
        sessionOptions: { secret: "a-test-secret", cookie: { maxAge: LIMITS.absoluteSeconds * 1000, httpOnly: true, secure: false, sameSite: "lax" } },
        storeOptions: { prefix: PREFIX, ttl: sessionStoreTtl(LIMITS) }
      })
    );
    const namespace = (req: express.Request) => req.session as unknown as { deedPoll?: Record<string, unknown> };
    app.get("/start-sign-in", (req, res) => {
      namespace(req).deedPoll = { flow: { state: "a-state" } };
      req.session.save(() => res.json({ id: req.sessionID }));
    });
    app.get("/signed-in", (req, res) => {
      const at = SIGNED_IN_AN_HOUR_AGO();
      namespace(req).deedPoll = { user: { name: "A Caseworker" }, authenticatedAt: at, lastSeenAt: at };
      req.session.save(() => res.json({ id: req.sessionID }));
    });
    app.get("/read", (req, res) => {
      res.json({ id: req.sessionID });
    });

    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterAll(async () => {
    await close?.();
    await client?.quit();
  });

  it("should keep a session that is only signing in for ten minutes at most", async () => {
    const { id } = (await (await fetch(`${baseUrl}/start-sign-in`)).json()) as { id: string };

    const ttl = await client.ttl(`${PREFIX}${id}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it("should keep a signed-in session no longer than its remaining absolute lifetime plus fifteen minutes", async () => {
    const { id } = (await (await fetch(`${baseUrl}/signed-in`)).json()) as { id: string };

    const ttl = await client.ttl(`${PREFIX}${id}`);

    expect(ttl).toBeLessThanOrEqual(SIGNED_IN_CEILING);
    expect(ttl).toBeGreaterThan(SIGNED_IN_CEILING - 30);
  });

  // The behaviour that was missing: every request used to slide the key a full cookie lifetime further on.
  it("should not let a later request push the signed-in key past that", async () => {
    const written = await fetch(`${baseUrl}/signed-in`);
    const cookie = written.headers.get("set-cookie") as string;
    const { id } = (await written.json()) as { id: string };

    const read = await fetch(`${baseUrl}/read`, { headers: { cookie } });

    expect(((await read.json()) as { id: string }).id).toBe(id);
    expect(await client.ttl(`${PREFIX}${id}`)).toBeLessThanOrEqual(SIGNED_IN_CEILING);
  });
});

/**
 * The same wiring against a Redis that is not there, which needs no service and so runs everywhere.
 *
 * This is the half of the store's behaviour that `app.test.ts` can only assert as a constructor argument.
 * With node-redis's default offline queue a store read during an outage is buffered and never settles, so
 * `express-session` never calls back and the request hangs for as long as Redis is away — the failure mode
 * with no error page, no log line and no bound. `disableOfflineQueue` in `src/app.ts` is what makes
 * it a rejection instead, and this asserts the consequence rather than the flag: a response arrives.
 */
describe("a session request while Redis is unreachable", () => {
  let client: ReturnType<typeof createClient>;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // Port 1 rather than a plausible one: nothing can be listening, so this cannot pass by accident against a
    // developer's local Redis. `reconnectStrategy` left at the default, since a client that has given up
    // rejects for a different reason (`ClientClosedError`) than the one under test.
    client = createClient({ url: "redis://127.0.0.1:1", disableOfflineQueue: true });
    client.on("error", () => {});
    // Mirrors `getRedisClient`: the connection is waited for, but only up to a bound, and the app is built
    // either way.
    await Promise.race([client.connect().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 500))]);

    const app = express();
    app.use(expressSessionRedis({ redisConnection: client, sessionOptions: { secret: "a-test-secret" }, storeOptions: { prefix: PREFIX } }));
    // Writes rather than reads, so the store is reached on a request carrying no cookie: `express-session`
    // will not read the store for a session id it cannot verify, and signing one here would mean restating
    // `cookie-signature`'s wire format in a test. `save` is what `signIn` calls, and forwarding its error is
    // what that route does too — see ./auth/session.ts.
    app.get("/write", (req, res, next) => {
      (req.session as unknown as { subject?: string }).subject = "a-caseworker";
      req.session.save((error) => (error ? next(error) : res.json({ id: req.sessionID })));
    });

    const server = createServer(app);
    server.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterAll(async () => {
    await close?.();
    client?.destroy();
  });

  it("answers with an error instead of hanging until Redis returns", async () => {
    // The timeout is half the assertion. A regression to the offline queue does not fail on the status — it
    // never produces one, and this aborts instead.
    const response = await fetch(`${baseUrl}/write`, { signal: AbortSignal.timeout(2_000) });

    expect(response.status).toBe(500);
  });
});

async function connect() {
  const client = createClient({ url: REDIS_URL });
  client.on("error", () => {});
  await client.connect();
  return client;
}

/**
 * Probed with a short bound rather than by awaiting `connect()`: node-redis retries an initial connection
 * indefinitely by default, so awaiting it against nothing would hang the whole file rather than skip it.
 */
async function canConnect(): Promise<boolean> {
  const client = createClient({ url: REDIS_URL, socket: { connectTimeout: 1_000, reconnectStrategy: false } });
  client.on("error", () => {});

  try {
    await client.connect();
    await client.quit();
    return true;
  } catch {
    return false;
  }
}
