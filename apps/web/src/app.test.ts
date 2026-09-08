/**
 * Pins the wiring in `createApp` that nothing else would notice going wrong.
 *
 * Chiefly **which session store this app builds**. A silent regression to the Postgres store works
 * locally and in every page test — sessions persist either way — and only surfaces much later as a
 * Flyway conflict when `deed-poll-api` takes ownership of the `public` schema, at which point the cause
 * is a long way from the symptom. Hence asserting on the store the app constructs rather than on
 * behaviour that both stores satisfy.
 *
 * The readiness probe is here for the same reason: it has to name **both** Redis and the database while
 * this app still reads case data through Prisma, and a probe missing one of them is green while half the
 * app 500s. Nothing about running the app would reveal it.
 *
 * Everything `createApp` mounts that touches the filesystem, a network or a database is doubled — this
 * is a test of the wiring, not of Nunjucks, Vite or Postgres.
 */
import { deedPollDatabaseChecks } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const mocks = vi.hoisted(() => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  const redisClient = {
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    // `isReady` and not just `ping`, because the readiness check consults it first — a reconnecting client
    // has `isOpen` true and `isReady` false, which answers "down" without a round trip. See `redisStatus`.
    isReady: true,
    ping: vi.fn(async () => "PONG")
  };

  return {
    passthrough,
    redisClient,
    createClient: vi.fn(() => redisClient),
    expressSessionRedis: vi.fn(() => passthrough),
    expressSessionPostgres: vi.fn(() => passthrough),
    healthcheck: vi.fn(() => passthrough)
  };
});

vi.mock("redis", () => ({ createClient: mocks.createClient }));
vi.mock("@hmcts-cft/express-session-redis", () => ({ expressSessionRedis: mocks.expressSessionRedis }));
vi.mock("@hmcts-cft/express-session-postgres", () => ({ expressSessionPostgres: mocks.expressSessionPostgres }));
vi.mock("@hmcts-cft/simple-router", () => ({ createSimpleRouter: vi.fn(async () => mocks.passthrough) }));
vi.mock("@hmcts-cft/express-govuk-starter", () => ({
  configureCookieManager: vi.fn(async () => undefined),
  configureGovuk: vi.fn(async () => undefined),
  configureHelmet: vi.fn(() => mocks.passthrough),
  configureNonce: vi.fn(() => mocks.passthrough),
  errorHandler: vi.fn(() => mocks.passthrough),
  notFoundHandler: vi.fn(() => mocks.passthrough)
}));

// A partial mock: only the two things that reach out of the process are doubled, so everything the
// readiness entry itself does stays real — that is part of what is being pinned. `loadSecrets` is not here
// because `createApp` no longer loads the secrets; `server.ts` does, before importing this module at all.
// See ./secrets.ts and ./server.test.ts.
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  monitoringMiddleware: vi.fn(() => mocks.passthrough),
  healthcheck: mocks.healthcheck
}));
// `@hmcts/deed-poll` is deliberately **not** mocked. `deedPollDatabaseChecks` only builds functions —
// nothing touches the database until one is called — so the real one can run, and the readiness assertion
// below can compare against the names it really produces. Mocking it was how that assertion came to check a
// hardcoded list against a hardcoded list.

type HealthcheckOptions = {
  checks: Record<string, () => Promise<"UP" | "DOWN">>;
  readinessChecks: Record<string, () => Promise<"UP" | "DOWN">>;
};

type SessionRedisOptions = {
  sessionOptions: { secret: string; cookie: Record<string, unknown> };
  storeOptions: { prefix: string };
};

function healthcheckOptions(): HealthcheckOptions {
  return mocks.healthcheck.mock.calls[0][0] as unknown as HealthcheckOptions;
}

function sessionRedisOptions(): SessionRedisOptions {
  return mocks.expressSessionRedis.mock.calls[0][0] as unknown as SessionRedisOptions;
}

describe("createApp", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.redisClient.isReady = true;
    await createApp();
  });

  it("should build the session store on Redis with the connected client, and not on Postgres", async () => {
    expect(mocks.expressSessionRedis).toHaveBeenCalledWith(expect.objectContaining({ redisConnection: mocks.redisClient }));
    expect(sessionRedisOptions().sessionOptions.secret).toBe("session-secret");
    expect(mocks.expressSessionPostgres).not.toHaveBeenCalled();
  });

  // Every flag stated at the call site rather than inherited, and pinned here because the library spreads
  // `sessionOptions` over its defaults — a partial `cookie` replaces the whole default object, so any future
  // edit to one of these silently drops the rest. Two are behaviour the store swap changed by itself:
  // `expressSessionRedis` defaults `maxAge` to four hours where the Postgres store it replaced defaulted to
  // twenty-four, and `express-session` sets no `sameSite` at all. `secure` is false only because vitest sets
  // `NODE_ENV=test`, which `plainHttpPermitted` allowlists.
  it("should give the session cookie a 24-hour lifetime, httpOnly and sameSite=lax explicitly", async () => {
    expect(sessionRedisOptions().sessionOptions.cookie).toEqual({ maxAge: 86_400_000, httpOnly: true, secure: false, sameSite: "lax" });
  });

  // One Redis per product, shared with `deed-poll-web`, so the library's default `sess:` prefix would put a
  // public service's sessions and this one's IDAM tokens in a single keyspace.
  it("should prefix session keys per component, since the product's Redis is shared with deed-poll-web", async () => {
    expect(sessionRedisOptions().storeOptions).toEqual({ prefix: "admin-sess:" });
  });

  it("should connect a Redis client at the configured URL before mounting the session middleware", async () => {
    expect(mocks.createClient).toHaveBeenCalledWith(expect.objectContaining({ url: "redis://localhost:6379" }));
    expect(mocks.redisClient.connect).toHaveBeenCalled();
  });

  /**
   * The option with no local symptom and the worst remote one.
   *
   * With node-redis's default offline queue, a command issued while the client is reconnecting is buffered
   * and its promise never settles. `express-session` reads the store on every request and `requireAuth` is
   * global, so dropping this turns a Redis outage into browsers hanging indefinitely — no error page and no
   * log line — instead of the 500 that `errorHandler()` renders. Nothing about a healthy environment, and no
   * other test here, would notice: both settings behave identically while Redis is up.
   */
  it("should reject session store commands rather than queue them while Redis is unreachable", async () => {
    expect(mocks.createClient).toHaveBeenCalledWith(expect.objectContaining({ disableOfflineQueue: true }));
  });

  it("should register an error listener on the Redis client, so a later connection failure cannot end the process", async () => {
    expect(mocks.redisClient.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("should put Redis and the deed-poll database on readiness together, since this app depends on both", async () => {
    // Names taken from `deedPollDatabaseChecks` itself rather than restated. Restating them while also
    // mocking the function that produces them is how the earlier version of this test came to compare a
    // hardcoded list against a hardcoded list — a rename in the domain passed.
    const databaseChecks = Object.keys(deedPollDatabaseChecks());

    expect(databaseChecks.length).toBeGreaterThan(0);
    expect(Object.keys(healthcheckOptions().readinessChecks)).toEqual([...databaseChecks, "redis"]);
  });

  it("should leave liveness empty, so a dependency outage does not restart every pod", async () => {
    expect(healthcheckOptions().checks).toEqual({});
  });

  it("should report readiness UP from Redis when the client answers a ping", async () => {
    const status = await healthcheckOptions().readinessChecks.redis();

    expect(mocks.redisClient.ping).toHaveBeenCalled();
    expect(status).toBe("UP");
  });

  it("should report readiness DOWN from Redis when the ping fails", async () => {
    mocks.redisClient.ping.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:6379"));

    const status = await healthcheckOptions().readinessChecks.redis();

    expect(status).toBe("DOWN");
  });

  /**
   * The state a bare `ping()` cannot report, and the reason `redisStatus` exists.
   *
   * A reconnecting client has `isOpen` true and `isReady` false, so a ping tells the probe nothing it did
   * not already know while costing a round trip on a socket that is being re-established. The healthcheck
   * middleware awaits its checks with a bare `Promise.all`, so any check that stalls hangs readiness for the
   * whole outage rather than answering 503, taking the database results down with it.
   */
  it("should report readiness DOWN from Redis while the client is reconnecting, without issuing a command", async () => {
    mocks.redisClient.isReady = false;

    const status = await healthcheckOptions().readinessChecks.redis();

    expect(status).toBe("DOWN");
    expect(mocks.redisClient.ping).not.toHaveBeenCalled();
  });

  // The connection that drops between `isReady` and the reply, where the command is queued after the check
  // has already passed. Bounded so the probe still answers.
  it("should report readiness DOWN from Redis when the ping never settles", async () => {
    mocks.redisClient.ping.mockImplementationOnce(() => new Promise<string>(() => {}));

    const status = await healthcheckOptions().readinessChecks.redis();

    expect(status).toBe("DOWN");
  });
});

/**
 * Startup against a Redis that is not there.
 *
 * Its own `describe` because these have to override the client double *before* `createApp` runs, where the
 * suite above builds the app in `beforeEach`.
 *
 * This is the case that has no visible symptom if it regresses. node-redis retries the initial connection
 * indefinitely by default, so `connect()` neither resolves nor rejects — and awaiting it bare means
 * `createApp` never returns, `server.ts` never reaches `app.listen`, and the pod answers no probe at all.
 * Kubernetes then restarts pods over a dependency outage, which is what the empty liveness checks exist to
 * prevent. Nothing in a green test run or a healthy environment would reveal it.
 */
describe("createApp when Redis is unreachable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should still build the app when the connection never settles, so the process can serve and report readiness DOWN", async () => {
    // Never resolves and never rejects — the real client's behaviour against a refused connection, not an
    // invented one. Takes the real startup bound to complete, which is the point being asserted.
    mocks.redisClient.connect.mockImplementationOnce(() => new Promise<undefined>(() => {}));

    const app = await createApp();

    expect(app).toBeDefined();
    expect(mocks.expressSessionRedis).toHaveBeenCalled();
  });

  it("should still build the app when the connection rejects outright", async () => {
    mocks.redisClient.connect.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:6379"));

    await expect(createApp()).resolves.toBeDefined();
  });
});
