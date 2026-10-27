/**
 * Pins the wiring in `createApp` that nothing else would notice going wrong.
 *
 * Chiefly **which session store this app builds**. A silent regression to the Postgres store works
 * locally and in every page test — sessions persist either way — and only surfaces much later as a
 * Flyway conflict when `deed-poll-api` takes ownership of the `public` schema, at which point the cause
 * is a long way from the symptom. Hence asserting on the store the app constructs rather than on
 * behaviour that both stores satisfy.
 *
 * The readiness probe is here for the same reason: it has to name **both** Redis and `deed-poll-api`,
 * and a probe missing one of them is green while half the app 500s. Nothing about running the app would
 * reveal it. It must also name **no** database — this app has none since the cutover, and a check
 * against one could only ever be DOWN.
 *
 * Everything `createApp` mounts that touches the filesystem or a network is doubled — this is a test of
 * the wiring, not of Nunjucks, Vite or api.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deedPollApiStatus } from "@hmcts/deed-poll";
import type { SessionData, Store } from "express-session";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { GuardedSessionStore } from "./auth/guarded-session-store.js";
import { refreshMiddleware } from "./auth/refresh-middleware.js";
import { assertSessionTimeouts } from "./auth/session.js";
import { sessionLifetime } from "./auth/session-lifetime.js";

/**
 * The URL the assertion below expects to reach `createClient`, set rather than assumed.
 *
 * `config/custom-environment-variables.json` maps `REDIS_URL` over `config/default.json`, so a machine that
 * exports one — the devcontainer does, pointing at `127.0.0.1` — failed a test about the wiring for a reason
 * that has nothing to do with the wiring.
 *
 * `vi.hoisted` because this has to happen before the imports above run: `auth/settings.ts` imports `config`
 * at module scope, and `config` reads the environment once, when it is first imported.
 */
vi.hoisted(() => {
  process.env.REDIS_URL = "redis://localhost:6379";
});

const mocks = vi.hoisted(() => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  const redisClient = {
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    // `isReady` and not just `ping`, because the readiness check consults it first — a reconnecting client
    // has `isOpen` true and `isReady` false, which answers "down" without a round trip. See `redisStatus`.
    isReady: true,
    ping: vi.fn(async () => "PONG"),
    withCommandOptions: vi.fn(() => sessionCommands)
  };
  const sessionCommands = { eval: vi.fn(async () => 1) };

  return {
    passthrough,
    redisClient,
    sessionCommands,
    createClient: vi.fn(() => redisClient),
    expressSessionRedis: vi.fn(() => passthrough),
    expressSessionPostgres: vi.fn(() => passthrough),
    healthcheck: vi.fn(() => passthrough)
  };
});

vi.mock("redis", () => ({ createClient: mocks.createClient }));
vi.mock("@hmcts-cft/express-session-redis", () => ({ expressSessionRedis: mocks.expressSessionRedis }));
vi.mock("@hmcts-cft/express-session-postgres", () => ({ expressSessionPostgres: mocks.expressSessionPostgres }));
vi.mock("@hmcts-cft/simple-router", () => ({ createSimpleRouter: vi.fn(async () => gates.router) }));
vi.mock("@hmcts-cft/express-govuk-starter", () => ({
  configureCookieManager: vi.fn(() => undefined),
  configureGovuk: vi.fn(async () => ({ addFilter: vi.fn() })),
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
// Wrapped, not replaced: the real check still runs, so this file also proves the defaults pass it. node-config freezes
// itself on first read, so a bad value cannot be injected through `config.get` once another test has started the app.
vi.mock("./auth/session.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./auth/session.js")>();
  return { ...original, assertSessionTimeouts: vi.fn(original.assertSessionTimeouts) };
});
// `@hmcts/deed-poll` is deliberately **not** mocked. Nothing reaches api until a check is called, and the
// readiness assertion below compares the mounted check against the real `deedPollApiStatus` by identity —
// mocking it was how the earlier version of that assertion came to check a hardcoded list against a
// hardcoded list, so a rename in the domain passed. `deed-poll-api.test.ts` covers what the check does.

type HealthcheckOptions = {
  checks: Record<string, () => Promise<"UP" | "DOWN">>;
  readinessChecks: Record<string, () => Promise<"UP" | "DOWN">>;
};

type SessionRedisOptions = {
  sessionOptions: { secret: string; name?: string; cookie: Record<string, unknown>; store: Store };
  storeOptions?: unknown;
};

function healthcheckOptions(): HealthcheckOptions {
  return mocks.healthcheck.mock.calls[0][0] as unknown as HealthcheckOptions;
}

function sessionRedisOptions(): SessionRedisOptions {
  return mocks.expressSessionRedis.mock.calls[0][0] as unknown as SessionRedisOptions;
}

/** A first write through the app's store, which the mocked client answers as created. */
function storeWrite(sid: string, sess: object): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionRedisOptions().sessionOptions.store.set(sid, sess as SessionData, (error) => (error ? reject(error) : resolve()));
  });
}

describe("createApp API configuration", () => {
  it.each(["not-a-url", "https://user:secret@api.example.test", "https://api.example.test/#secret", "https://api.example.test/?secret"])(
    "should refuse invalid API configuration before connecting to Redis: %s",
    async (address) => {
      vi.clearAllMocks();
      vi.stubEnv("DEED_POLL_API_URL", address);
      try {
        await expect(createApp()).rejects.toThrow("DEED_POLL_API_URL must be an absolute HTTP(S) URL without credentials, query or fragment");
        expect(mocks.createClient).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    }
  );
});

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
  // The cookie lasts as long as the absolute limit (10 hours by default). It is a convenience: sessionLifetime decides.
  // Path stated, and no domain, because the __Host- name used where cookies are secure requires both.
  it("should give the session cookie the absolute limit's lifetime, path=/, httpOnly and sameSite=lax explicitly", async () => {
    expect(sessionRedisOptions().sessionOptions.cookie).toEqual({ maxAge: 36_000_000, path: "/", httpOnly: true, secure: false, sameSite: "lax" });
  });

  // Not the library default `connect.sid`, which names the framework. Plain under vitest's NODE_ENV=test; the
  // __Host- form is session.test.ts's subject.
  it("should name the session cookie for this service, and list that name as an essential cookie", async () => {
    const { configureCookieManager } = await import("@hmcts-cft/express-govuk-starter");

    expect(sessionRedisOptions().sessionOptions.name).toBe("deed-poll-admin-sid");
    expect(vi.mocked(configureCookieManager).mock.calls[0][1]).toMatchObject({ categories: { essential: ["deed-poll-admin-sid"] } });
  });

  // One Redis per product, shared with `deed-poll-web`, so the library's default `sess:` prefix would put a
  // public service's sessions and this one's IDAM tokens in a single keyspace.
  // The `-v2` keyspace is the guarded store's own, so an old instance mid-rollout can neither read nor rewrite it.
  it("should prefix session keys per component, in the guarded store's own keyspace", async () => {
    await storeWrite("a-session", { cookie: {} });

    expect(mocks.sessionCommands.eval).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ keys: ["admin-sess-v2:a-session"] }));
  });

  // The library's connect-redis store writes unconditionally, which is how a request finishing after logout could put
  // the session back (E01). Its options are therefore not passed: the store is.
  it("should give express-session the guarded store, bounded per command, rather than the library's", async () => {
    expect(sessionRedisOptions().sessionOptions.store).toBeInstanceOf(GuardedSessionStore);
    expect(sessionRedisOptions().storeOptions).toBeUndefined();
    expect(mocks.redisClient.withCommandOptions).toHaveBeenCalledWith({ timeout: 2_000 });
  });

  // Derived from the session rather than the cookie, which every request slides. See sessionStoreTtl.
  it("should give the store a TTL that a signed-in session's activity cannot extend", async () => {
    await storeWrite("a-session", { cookie: {} });

    expect(mocks.sessionCommands.eval).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ arguments: [expect.any(String), '{"cookie":{}}', "600"] })
    );
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

  it("should put Redis and deed-poll-api on readiness together, since this app depends on both", async () => {
    // Exactly these two, and no database entry: this app has none, and a probe that named one would be
    // permanently DOWN. The api check is compared by identity rather than by name so the domain's real
    // function is what got mounted — a stub of it would let a rename here pass.
    expect(Object.keys(healthcheckOptions().readinessChecks)).toEqual(["deedPollApi", "redis"]);
    expect(healthcheckOptions().readinessChecks.deedPollApi).toBe(deedPollApiStatus);
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
   * whole outage rather than answering 503, taking the api result down with it.
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

/**
 * That the judicial role gate is actually mounted, and mounted on the right prefix and in the right place.
 *
 * Pinned here for the same reason the session store is: nothing about running the app reveals the failure.
 * An unmounted gate leaves every judicial page open to any signed-in caseworker, and the pages themselves
 * look identical either way — they never ask about the role. A gate mounted *before* `requireAuth` would be
 * worse than useless in the other direction: an anonymous visitor would be refused with a 403 instead of
 * being sent to log in, so the ordering is asserted rather than assumed.
 *
 * The two auth middlewares are doubled with named functions only so the mounted layers can be identified —
 * their behaviour is `require-auth.test.ts`'s and `require-role.test.ts`'s subject, not this file's.
 */
const gates = vi.hoisted(() => ({
  auth: function requireAuthDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  gazette: function requireGazetteDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  settings: function requireSettingsDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  judicial: function requireJudicialDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  noStore: function noStoreDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  persona: function personaSwitcherLocalsDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  sameOrigin: function requireSameOriginDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  arrival: function recordArrivalDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  sessionLifetime: function sessionLifetimeDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  },
  /** Named, unlike the other doubles in this file, only so the layer it mounts as can be told apart. */
  router: function simpleRouterDouble(_req: unknown, _res: unknown, next: () => void) {
    next();
  }
}));

vi.mock("./auth/require-auth.js", () => ({ requireAuth: () => gates.auth, isPublicPath: () => false }));
vi.mock("./auth/require-role.js", () => ({
  requireCapability: vi.fn((capability: string) => (capability === "MANAGE_PROCESS_CONFIG" ? gates.settings : gates.gazette)),
  requireJudicial: () => gates.judicial
}));
vi.mock("./auth/persona-switcher.js", () => ({ personaSwitcherLocals: () => gates.persona }));
vi.mock("./auth/same-origin.js", () => ({ requireSameOrigin: () => gates.sameOrigin }));
vi.mock("./auth/no-store.js", () => ({ noStore: () => gates.noStore }));
vi.mock("./auth/session-lifetime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth/session-lifetime.js")>()),
  sessionLifetime: vi.fn(() => gates.sessionLifetime)
}));
vi.mock("./request-arrival.js", () => ({ recordArrival: () => gates.arrival }));

describe("createApp's judicial gate", () => {
  let stack: MountedLayer[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.redisClient.isReady = true;
    const app = await createApp();
    stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;
  });

  it("should mount the judicial role gate", () => {
    expect(stack.filter((layer) => layer.handle === gates.judicial)).toHaveLength(1);
  });

  it("should mount it on the judicial prefix and nowhere else, so a page added under it is gated by where it lives", () => {
    const layer = stack.find((entry) => entry.handle === gates.judicial) as MountedLayer;

    for (const path of ["/judicial", "/judicial/referrals", "/judicial/referrals/abc/direction"]) {
      expect(
        layer.matchers.some((matches) => matches(path) !== false),
        path
      ).toBe(true);
    }
    for (const path of ["/deed-polls", "/deed-polls/abc", "/login", "/"]) {
      expect(
        layer.matchers.every((matches) => matches(path) === false),
        path
      ).toBe(true);
    }
  });

  it("should mount it after requireAuth, so an anonymous visitor is sent to log in rather than refused", () => {
    expect(stack.findIndex((layer) => layer.handle === gates.judicial)).toBeGreaterThan(stack.findIndex((layer) => layer.handle === gates.auth));
  });

  /**
   * Every judicial page, read off the filesystem rather than listed.
   *
   * This is where "a caseworker is refused the judicial area" is actually pinned: the pages themselves never ask
   * about the role, so no page test can show it, and a hand-written list of URLs would go stale the moment a page
   * is added — which is the failure that matters, since an ungated judicial page looks identical to a gated one.
   * `require-role.test.ts` proves the gate refuses a caseworker and admits a judge; this proves it is in front of
   * all of them.
   */
  it("should cover every page under src/pages/judicial, including ones added after this test was written", () => {
    const layer = stack.find((entry) => entry.handle === gates.judicial) as MountedLayer;
    const paths = judicialPagePaths();

    // A guard against the glob silently finding nothing and the loop below passing vacuously.
    expect(paths.length).toBeGreaterThanOrEqual(3);

    for (const path of paths) {
      expect(
        layer.matchers.some((matches) => matches(path) !== false),
        path
      ).toBe(true);
    }
  });
});

/**
 * That the persona switcher's locals middleware is mounted, globally and before the router.
 *
 * Here for the same reason as the judicial gate: nothing about running the app reveals the failure. An
 * unmounted middleware leaves every page rendering without the strip — which is also exactly what a correctly
 * mounted one does when the gate is shut — so no page test and no screenshot can tell the two apart. Mounted
 * *after* the router it would be dead code, since the router answers the request.
 *
 * Global rather than per area is decision 7: the judge needs the same control the caseworker has, or the
 * judicial chrome is a door that only opens one way.
 */
describe("createApp's persona switcher", () => {
  let stack: MountedLayer[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.redisClient.isReady = true;
    const app = await createApp();
    stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;
  });

  it("should mount the locals middleware before the router, so every page can render the strip", () => {
    const mounted = stack.findIndex((layer) => layer.handle === gates.persona);

    expect(mounted).toBeGreaterThanOrEqual(0);
    expect(mounted).toBeLessThan(stack.findIndex((layer) => layer.handle === gates.router));
  });

  /**
   * Before the judicial gate, because `requireJudicial` refuses with `next(err)`.
   *
   * An error `next()` skips every remaining non-error middleware, so mounted *after* the gate this would not
   * run at all for the one request a refused judge or caseworker makes — and the strip is what tells them how
   * to get back out. Nothing about the refusal reveals it either: the 403 renders on the 404 view, which is
   * the starter's template and carries no strip in any case.
   */
  it("should mount it before the judicial gate, whose refusal skips the middleware after it", () => {
    expect(stack.findIndex((layer) => layer.handle === gates.persona)).toBeLessThan(stack.findIndex((layer) => layer.handle === gates.judicial));
  });

  // `match` rather than `matchers`, unlike the judicial assertions above: a layer mounted at `/` without a
  // path takes the router's `slash` fast path and never consults its matchers, so reading those directly
  // reports `false` for every path but `/` and the test would pass for the wrong reason inverted.
  it("should mount it for every path rather than one area, so the judge gets the same control as the caseworker", () => {
    const layer = stack.find((entry) => entry.handle === gates.persona) as MountedLayer;

    for (const path of ["/", "/deed-polls", "/deed-polls/abc", "/judicial/referrals"]) {
      expect(layer.match(path), path).toBe(true);
    }
  });
});

/**
 * That the cross-origin gate is mounted, globally and in front of everything that writes.
 *
 * Here for the same reason as the two gates above: nothing about running the app reveals its absence. Every
 * page works, every form submits, and the hole only shows up as a write somebody's browser made from another
 * site's page — `SameSite=Lax` does not stop one, because every CFT service in an environment is a subdomain
 * of the same registrable domain. Mounted per route it would be missing from the next page somebody adds,
 * which is why the assertion is that it covers every path.
 */
describe("createApp's cross-origin gate", () => {
  let stack: MountedLayer[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.redisClient.isReady = true;
    const app = await createApp();
    stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;
  });

  // `match` rather than `matchers`, for the reason the persona switcher's equivalent gives.
  it("should mount it for every path, so a page added later is covered by being a page", () => {
    const layer = stack.find((entry) => entry.handle === gates.sameOrigin) as MountedLayer;

    expect(layer).toBeDefined();
    for (const path of ["/", "/switch-persona", "/deed-polls/new", "/judicial/referrals/abc/direction"]) {
      expect(layer.match(path), path).toBe(true);
    }
  });

  it("should mount it before the router, since the handler is what it has to run instead of", () => {
    expect(stack.findIndex((layer) => layer.handle === gates.sameOrigin)).toBeLessThan(stack.findIndex((layer) => layer.handle === gates.router));
  });

  // Before `requireAuth` so a forged post is refused as forged. Mounted after it, a cross-site post with no
  // session would be answered with a redirect to `/login` — which is not wrong, but it is an answer about
  // authentication to a question about where the request came from, and the log line would say so.
  it("should mount it before requireAuth", () => {
    expect(stack.findIndex((layer) => layer.handle === gates.sameOrigin)).toBeLessThan(stack.findIndex((layer) => layer.handle === gates.auth));
  });
});

/**
 * The URL of every judicial page, derived from the page files the way `simple-router` derives its routes: the
 * `pages` root is stripped, an `index` is the directory itself, and a `[param]` segment stands for any value.
 */
function judicialPagePaths(area = "judicial"): string[] {
  const root = path.join(fileURLToPath(import.meta.url), `../pages/${area}`);

  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map(
      (entry) =>
        `/${area}/${entry
          .replace(/\.ts$/, "")
          .replace(/(^|\/)index$/, "")
          .replace(/\[[^\]]+\]/g, "a-sample-id")}`
    )
    .map((path) => (path.endsWith("/") ? path.slice(0, -1) : path));
}

/** The part of an Express layer this file reads: what was mounted, and the paths it answers for. */
/**
 * That the session lifetime limits are enforced, for every path, before anything can renew the session.
 *
 * After the cross-origin gate, so a forged post is refused as forged rather than ending the victim's session. Before
 * `requireAuth`, so a timed-out request is ended rather than treated as signed in. And before `refreshMiddleware`,
 * which is the point: mounted after it, a session past its absolute limit would be renewed first, and the limit would
 * be no limit. Nothing about running the app shows the order. OWASP plan 03, decision 2.
 */
describe("createApp's session lifetime limits", () => {
  let stack: MountedLayer[];
  const at = (handle: unknown) => stack.findIndex((layer) => layer.handle === handle);

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.redisClient.isReady = true;
    const app = await createApp();
    stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;
  });

  it("should enforce the configured limits, with the timed-out return address not yet registered", () => {
    expect(sessionLifetime).toHaveBeenCalledWith({ idleSeconds: 1800, absoluteSeconds: 36_000, logoutPathRegistered: false });
  });

  it("should mount after the cross-origin gate and before requireAuth and the token refresh", () => {
    expect(at(gates.sessionLifetime)).toBeGreaterThan(at(gates.sameOrigin));
    expect(at(gates.sessionLifetime)).toBeLessThan(at(gates.auth));
    expect(at(gates.sessionLifetime)).toBeLessThan(at(refreshMiddleware));
  });

  it("should mount for every path, so a page added later is covered by existing", () => {
    const layer = stack.find((entry) => entry.handle === gates.sessionLifetime) as MountedLayer;

    for (const path of ["/", "/deed-polls", "/deed-polls/abc/notes", "/judicial/referrals", "/deed-polls/gazette"]) {
      expect(layer.match(path), path).toBe(true);
    }
  });
});

/**
 * That a request's arrival is recorded before anything can spend its time. The Gazette send's deadline is counted from
 * this moment, so a layer mounted ahead of it (a session read, a token refresh against IDAM, the body parser) would be
 * time the deadline never saw, and the frontend gateway's 30 s would cut the browser off first.
 */
describe("createApp's arrival time", () => {
  it("should be the first layer, for every path, ahead of the session and the token refresh", async () => {
    vi.clearAllMocks();
    mocks.redisClient.isReady = true;
    const app = await createApp();
    const stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;

    expect(stack.filter((layer) => layer.handle === gates.arrival)).toHaveLength(1);
    expect(stack[0].handle).toBe(gates.arrival);
    expect(stack.findIndex((layer) => layer.handle === mocks.passthrough)).toBeGreaterThan(0);
    expect(stack.findIndex((layer) => layer.handle === refreshMiddleware)).toBeGreaterThan(0);
    for (const path of ["/", "/deed-polls/gazette/batch", "/judicial/referrals", "/health/readiness"]) {
      expect(stack[0].match(path), path).toBe(true);
    }
  });
});

type MountedLayer = { handle: unknown; matchers: ((path: string) => unknown)[]; match: (path: string) => boolean };

describe("createApp's Gazette gate", () => {
  it("should require Gazette capability after authentication and before routing for every Gazette page", async () => {
    const { requireCapability } = await import("./auth/require-role.js");
    const { ACCESS_GAZETTE } = await import("@hmcts/deed-poll");
    mocks.redisClient.isReady = true;
    const app = await createApp();
    const stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;
    const index = stack.findIndex((entry) => entry.handle === gates.gazette);
    const paths = judicialPagePaths("deed-polls/gazette");

    expect(requireCapability).toHaveBeenCalledWith(ACCESS_GAZETTE);
    expect(stack.filter((entry) => entry.handle === gates.gazette)).toHaveLength(1);
    expect(index).toBeGreaterThan(stack.findIndex((entry) => entry.handle === gates.auth));
    expect(index).toBeGreaterThan(stack.findIndex((entry) => entry.handle === gates.persona));
    expect(index).toBeLessThan(stack.findIndex((entry) => entry.handle === gates.router));
    expect(paths.length).toBeGreaterThanOrEqual(6);
    for (const url of [...paths, "/deed-polls/gazette/history", "/deed-polls/gazette/future-page"]) {
      expect(
        stack[index].matchers.some((matches) => matches(url) !== false),
        url
      ).toBe(true);
    }
    for (const url of ["/deed-polls", "/deed-polls/abc", "/deed-polls/gazette-other", "/judicial", "/login"]) {
      expect(
        stack[index].matchers.every((matches) => matches(url) === false),
        url
      ).toBe(true);
    }
  });
});

describe("createApp's settings gate", () => {
  it("should require MANAGE_PROCESS_CONFIG after authentication and before routing for every settings page", async () => {
    const { requireCapability } = await import("./auth/require-role.js");
    const { MANAGE_PROCESS_CONFIG } = await import("@hmcts/deed-poll");
    mocks.redisClient.isReady = true;
    const app = await createApp();
    const stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;
    const index = stack.findIndex((entry) => entry.handle === gates.settings);
    const paths = judicialPagePaths("deed-polls/settings");

    expect(requireCapability).toHaveBeenCalledWith(MANAGE_PROCESS_CONFIG);
    expect(stack.filter((entry) => entry.handle === gates.settings)).toHaveLength(1);
    expect(index).toBeGreaterThan(stack.findIndex((entry) => entry.handle === gates.auth));
    expect(index).toBeGreaterThan(stack.findIndex((entry) => entry.handle === gates.persona));
    expect(index).toBeLessThan(stack.findIndex((entry) => entry.handle === gates.router));
    expect(paths).toEqual(expect.arrayContaining(["/deed-polls/settings", "/deed-polls/settings/gazette-recipient"]));
    for (const url of [...paths, "/deed-polls/settings/future-page"]) {
      expect(
        stack[index].matchers.some((matches) => matches(url) !== false),
        url
      ).toBe(true);
    }
    for (const url of ["/deed-polls", "/deed-polls/abc", "/deed-polls/settings-other", "/deed-polls/gazette", "/login"]) {
      expect(
        stack[index].matchers.every((matches) => matches(url) === false),
        url
      ).toBe(true);
    }
  });
});

describe("createApp's no-store layer", () => {
  let stack: MountedLayer[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.redisClient.isReady = true;
    const app = await createApp();
    stack = (app as unknown as { router: { stack: MountedLayer[] } }).router.stack;
  });

  it("should be mounted once, for every path, after requireAuth and before the router", () => {
    const layers = stack.filter((layer) => layer.handle === gates.noStore);
    const index = stack.findIndex((layer) => layer.handle === gates.noStore);

    expect(layers).toHaveLength(1);
    expect(layers[0].match("/deed-polls/a-sample-id")).toBe(true);
    expect(index).toBeGreaterThan(stack.findIndex((layer) => layer.handle === gates.auth));
    expect(index).toBeLessThan(stack.findIndex((layer) => layer.handle === gates.judicial));
    expect(index).toBeLessThan(stack.findIndex((layer) => layer.handle === gates.router));
  });

  // The header is skipped exactly where requireAuth's allowlist says a page is public, so this reads every page off
  // the filesystem and pins which ones those are. A new page is a signed-in page, and uncacheable, unless it is
  // added here on purpose.
  // `/session-timed-out` and `/signed-out` are for a user who is no longer signed in, and show no case data. The two `/session/` routes
  // answer an anonymous caller 401 themselves and set their own no-store.
  it("should treat every page but the sign-in flow, the home redirect, the timed-out and signed-out pages and the footer pages as signed-in", async () => {
    const { isPublicPath } = await vi.importActual<typeof import("./auth/require-auth.js")>("./auth/require-auth.js");
    const publicPages = new Set([
      "/",
      "/login",
      "/logout",
      "/oauth2/callback",
      "/session-timed-out",
      "/signed-out",
      "/session/keep-alive",
      "/session/status",
      "/accessibility-statement",
      "/contact-us",
      "/privacy-policy",
      "/terms-and-conditions"
    ]);
    const pages = pagePaths();

    expect(pages.length).toBeGreaterThanOrEqual(40);
    expect(pages.filter((page) => publicPages.has(page)).sort()).toEqual([...publicPages].sort());
    for (const page of pages) {
      expect(isPublicPath(page), page).toBe(publicPages.has(page));
    }
  });
});

// The limits are checked in `session.test.ts`; this pins that `createApp` checks them at all, before serving anything.
describe("createApp's session limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should check the configured limits, which default to 30 minutes idle and 10 hours absolute", async () => {
    await createApp();

    expect(assertSessionTimeouts).toHaveBeenCalledWith(1800, 36_000);
  });

  it("should refuse to start when the check refuses the limits", async () => {
    vi.mocked(assertSessionTimeouts).mockImplementationOnce(() => {
      throw new Error("SESSION_IDLE_TIMEOUT_SECONDS must be shorter than SESSION_ABSOLUTE_TIMEOUT_SECONDS");
    });

    await expect(createApp()).rejects.toThrow(/SESSION_IDLE_TIMEOUT_SECONDS/);
  });
});

/**
 * The URL of every page under `src/pages`, the way `simple-router` derives it: `index` is its directory, a
 * `(group)` directory is dropped, and a `[param]` segment stands for any value. Layouts and error templates are
 * not routes and have no `.ts` file.
 */
function pagePaths(): string[] {
  const root = path.join(fileURLToPath(import.meta.url), "../pages");

  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => {
      const route = entry
        .replace(/\.ts$/, "")
        .replace(/\([^)]+\)\//g, "")
        .replace(/(^|\/)index$/, "")
        .replace(/\[[^\]]+\]/g, "a-sample-id");
      return `/${route}`.replace(/\/$/, "") || "/";
    });
}

describe("createApp's abuse limits", () => {
  // Before the router is what puts the upload cap and limiter ahead of the page's multipart parser, and after the
  // Gazette gate so a refused user is not counted. See ./rate-limit/routes.ts.
  it("should mount the upload cap and limiter after the gates and before the router", async () => {
    mocks.redisClient.isReady = true;
    const app = await createApp();
    const stack = (app as unknown as { router: { stack: (MountedLayer & { route?: { path: string; stack: unknown[] } })[] } }).router.stack;

    const upload = stack.findIndex((layer) => layer.route?.path === "/deed-polls/:id/documents/upload");

    expect(stack[upload]?.route?.stack).toHaveLength(2);
    expect(upload).toBeGreaterThan(stack.findIndex((layer) => layer.handle === gates.gazette));
    expect(upload).toBeGreaterThan(stack.findIndex((layer) => layer.handle === gates.settings));
    expect(upload).toBeLessThan(stack.findIndex((layer) => layer.handle === gates.router));
  });
});
