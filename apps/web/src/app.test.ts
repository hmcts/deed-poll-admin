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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const mocks = vi.hoisted(() => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  const redisClient = {
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    ping: vi.fn(async () => "PONG")
  };

  return {
    passthrough,
    redisClient,
    createClient: vi.fn(() => redisClient),
    expressSessionRedis: vi.fn(() => passthrough),
    expressSessionPostgres: vi.fn(() => passthrough),
    healthcheck: vi.fn(() => passthrough),
    // Named as `deedPollDatabaseChecks` names them, so a rename there fails this rather than passing on
    // keys that no longer exist.
    deedPollDatabaseChecks: vi.fn(() => ({
      postgres: async () => "UP" as const,
      deedPollSchema: async () => "UP" as const
    }))
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

// Partial mocks, both of them: `hc.raw` and the rest of the deed-poll domain are the real ones, because
// what the readiness entry does when Redis fails is part of what is being pinned.
vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  getPropertiesVolumeSecrets: vi.fn(async () => ({})),
  monitoringMiddleware: vi.fn(() => mocks.passthrough),
  healthcheck: mocks.healthcheck
}));
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  deedPollDatabaseChecks: mocks.deedPollDatabaseChecks
}));

type HealthcheckOptions = {
  checks: Record<string, () => Promise<"UP" | "DOWN">>;
  readinessChecks: Record<string, () => Promise<"UP" | "DOWN">>;
};

function healthcheckOptions(): HealthcheckOptions {
  return mocks.healthcheck.mock.calls[0][0] as unknown as HealthcheckOptions;
}

describe("createApp", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await createApp();
  });

  it("should build the session store on Redis, and not on Postgres", async () => {
    expect(mocks.expressSessionRedis).toHaveBeenCalledWith({
      redisConnection: mocks.redisClient,
      sessionOptions: { secret: "session-secret" }
    });
    expect(mocks.expressSessionPostgres).not.toHaveBeenCalled();
  });

  it("should connect a Redis client at the configured URL before mounting the session middleware", async () => {
    expect(mocks.createClient).toHaveBeenCalledWith({ url: "redis://localhost:6379" });
    expect(mocks.redisClient.connect).toHaveBeenCalled();
  });

  it("should register an error listener on the Redis client, so a later connection failure cannot end the process", async () => {
    expect(mocks.redisClient.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("should put Redis and the deed-poll database on readiness together, since this app depends on both", async () => {
    expect(Object.keys(healthcheckOptions().readinessChecks)).toEqual(["postgres", "deedPollSchema", "redis"]);
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
});
