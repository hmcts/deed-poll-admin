import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ACCESS_GAZETTE, assertDeedPollApiSettings, deedPollApiStatus, MANAGE_PROCESS_CONFIG, plainHttpPermitted } from "@hmcts/deed-poll";
import { type HealthStatus, healthcheck, monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";
import { configureCookieManager, configureGovuk, configureHelmet, configureNonce, errorHandler, notFoundHandler } from "@hmcts-cft/express-govuk-starter";
import { expressSessionRedis } from "@hmcts-cft/express-session-redis";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import cookieParser from "cookie-parser";
import type { Express } from "express";
import express from "express";
import { createClient } from "redis";
import { GuardedSessionStore } from "./auth/guarded-session-store.js";
import { noStore } from "./auth/no-store.js";
import { personaSwitcherLocals } from "./auth/persona-switcher.js";
import { refreshMiddleware } from "./auth/refresh-middleware.js";
import { requireAuth } from "./auth/require-auth.js";
import { requireCapability, requireJudicial } from "./auth/require-role.js";
import { requireSameOrigin } from "./auth/same-origin.js";
import { assertRedisUrl, assertSessionSecret, assertSessionTimeouts, sessionCookieName, sessionStoreTtl } from "./auth/session.js";
import { sessionLifetime } from "./auth/session-lifetime.js";
import { assertIdamSettings, idamSettings } from "./auth/settings.js";
import { PDFJS_ASSET_MOUNT, pdfjsDevelopmentAssets } from "./document-viewer/pdfjs-assets.js";
import { domainErrorHandler } from "./errors.js";
import { addPathFilters } from "./path-filters.js";
import { createRateLimiter, rateLimitSettings } from "./rate-limit/limiter.js";
import { mountAbuseLimits } from "./rate-limit/routes.js";
import { uploadInFlightCap } from "./rate-limit/upload-in-flight.js";
import { recordArrival } from "./request-arrival.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = process.env.NODE_ENV !== "production" && process.env.VITE_MIDDLEWARE !== "false";
/**
 * How long startup waits for the first Redis connection before serving anyway. See `getRedisClient` —
 * this is a bound on the wait, not a connect timeout: the client keeps retrying after it elapses.
 */
const REDIS_CONNECT_TIMEOUT_MS = 2_000;
/**
 * How long a readiness probe waits for `PING` before calling Redis down. See `redisStatus` — a probe that
 * waits indefinitely reports nothing at all.
 */
const REDIS_PING_TIMEOUT_MS = 1_000;
/**
 * Keyed per component, because the shared root provisions **one** Redis for the whole product and
 * `deed-poll-web` reads the same `redis-url`. Under the library default of `sess:` a public-facing
 * service and this caseworker service would share one namespace — and this app's sessions hold IDAM
 * access and refresh tokens. Distinct signing secrets already stop a cookie being portable between the
 * two; this is the keyspace half of the same argument.
 *
 * `-v2` since the guarded store (`./auth/guarded-session-store.ts`): its records are hashes where connect-redis wrote
 * strings, and a separate keyspace is what keeps an instance still running the old store from reading, or
 * unconditionally rewriting, a guarded record during a rolling deploy. Old `admin-sess:` keys are never read again and
 * expire on their own TTL; the cost is one sign-in for everyone, and again for anyone moved between versions mid-rollout.
 */
const SESSION_KEY_PREFIX = "admin-sess-v2:";
/**
 * The most any one session store command may take. A command that times out fails its request rather than hanging it;
 * a write whose reply was lost is never retried, and the session object it came from can no longer satisfy the store's
 * revision check, so nothing is written blind.
 */
const SESSION_COMMAND_TIMEOUT_MS = 2_000;

export async function createApp(): Promise<Express> {
  // `server.ts` has already loaded the key vault secrets into the environment by the time this runs, and
  // it has to be that way round rather than a call from here: see ./secrets.ts.
  const { default: config } = await import("config");
  assertDeedPollApiSettings();
  const redisUrl = config.get<string>("redis.url");
  assertRedisUrl(redisUrl, config.get<boolean>("redis.plaintextPermitted") === true);
  const redisConnection = await getRedisClient(redisUrl);
  // Read before anything is mounted, so a bad mode or a limit that arrived as a string stops startup.
  const rateLimits = rateLimitSettings(config.get("rateLimit"));
  const app = express();

  app.set("trust proxy", 1);
  // First, so the Gazette send's deadline counts every layer below. See ./request-arrival.ts.
  app.use(recordArrival());
  // Up to 100 reviewed IDs and the signed confirmation must fit even at the API field-length limits.
  app.use("/deed-polls/gazette/batch", express.urlencoded({ extended: true, limit: "512kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(monitoringMiddleware(config.get("applicationInsights")));
  app.use(configureNonce());
  // No Google Tag Manager (review finding R12): admin uses none, and the starter's default admits its hosts, a known
  // CSP-bypass, to the policy. Adopting it later needs a real container, a nonce on its bootstrap and analytics consent.
  app.use(configureHelmet({ enableGoogleTagManager: false }));
  const sessionSecret = config.get<string>("session.secret");
  assertSessionSecret(sessionSecret);
  const sessionTimeouts = assertSessionTimeouts(config.get("session.idleTimeoutSeconds"), config.get("session.absoluteTimeoutSeconds"));
  // Checked here rather than at first use: a wrong redirect URI or an empty client secret fails only
  // when a caseworker tries to log in, and fails on IDAM's page, where no request reaches this app.
  assertIdamSettings(idamSettings());
  // Sessions live in this app's own Redis, and deliberately **not** behind `deed-poll-api`. This app is
  // losing its data access layer to that service, so the next reader will reasonably ask why session
  // state is the exception, and "consistency" is the wrong answer:
  //
  //   - A session is **transport state, not domain data**. It is keyed by a cookie this app issued, means
  //     nothing to any other service, and carries no business rule for api to enforce.
  //   - Putting it behind api would **invert authorisation**. Reading the session is how this app learns
  //     who the caller is — so api would have to serve that read authorised by a *service* credential,
  //     before any user has been identified. Any compromise of this app could then read any session.
  //     Held locally, the session id arrives in a signed cookie and never leaves the process.
  //   - There would be **nothing for this app to own** on the other side of the split. `express-session`'s
  //     store contract is `get`/`set`/`destroy`/`touch`, called by middleware before any code of ours
  //     runs. It would be a proxy, not a layer.
  //   - Every frontend in the estate holds its own sessions — `pcs-frontend`, `pt-frontend`,
  //     `deed-poll-web`. None holds its own case data.
  //
  // Every cookie flag is stated here rather than inherited from the library, and that is not verbosity:
  // `expressSessionRedis` spreads `sessionOptions` **over** its defaults, so a partial `cookie` replaces
  // the whole default object — passing only `maxAge` would silently drop `secure` and `httpOnly`. Stating
  // all four means no future edit to one of them can quietly remove the others.
  //
  // The store is passed in rather than left to the library, whose connect-redis store writes unconditionally and so
  // let a request still running after logout put the session back (review finding E01). The same spread is what lets
  // `store` replace the library's, so the library itself is unchanged; the store it still constructs is never called. See ./auth/guarded-session-store.ts.
  app.use(
    expressSessionRedis({
      redisConnection,
      sessionOptions: {
        store: new GuardedSessionStore({
          client: redisConnection.withCommandOptions({ timeout: SESSION_COMMAND_TIMEOUT_MS }),
          prefix: SESSION_KEY_PREFIX,
          ttl: sessionStoreTtl(sessionTimeouts)
        }),
        secret: sessionSecret,
        name: sessionCookieName(),
        cookie: {
          // The absolute limit: no cookie outlives the session it belongs to. A convenience, not the control.
          maxAge: sessionTimeouts.absoluteSeconds * 1000,
          // Stated, and no `domain`, because the `__Host-` name requires exactly that. See `sessionCookieName`.
          path: "/",
          httpOnly: true,
          // `plainHttpPermitted()` rather than `NODE_ENV === "production"`, which is what the library
          // uses: that reading leaves the cookie sent in cleartext in `aat`, in preview, and anywhere
          // `NODE_ENV` is simply unset. See `libs/deed-poll/src/auth/plain-http.ts` on the polarity.
          secure: !plainHttpPermitted(),
          // `express-session` sets no `sameSite` at all by default, which leaves the attribute to
          // per-browser defaults for a cookie that is this app's only authenticator. Lax and not Strict:
          // IDAM returns the user by a cross-site top-level GET to `/oauth2/callback`, and Strict would
          // withhold the cookie carrying the in-flight `flow`, failing every login at the callback.
          sameSite: "lax"
        }
      }
    })
  );
  // Every state-changing request must come from this app's own pages. `SameSite=Lax` above stops
  // `evil.example` and not a sibling CFT service: `SameSite` is decided on the registrable domain, so
  // anything under `platform.hmcts.net` posting here is same-site and the session cookie is attached in
  // full. Global and before the router for the same reason `requireAuth` is — a page added later is covered
  // by being a page — and before `requireAuth` so a forged post is refused as forged rather than bounced to
  // `/login`. After the session middleware, because the refusal renders an error view. See
  // ./auth/same-origin.ts for why it reads `Sec-Fetch-Site` rather than `Origin` — `configureHelmet()` above
  // sends `Referrer-Policy: no-referrer`, under which a browser sends the same `Origin: null` for this app's
  // own forms and for a sibling's forged post — and for why this is not a synchronizer token.
  app.use(requireSameOrigin());

  // Readiness only, never liveness. `healthcheck()` defaults `readinessChecks` to `checks`, so naming a
  // dependency here without the split would put it on **both** — which is what happened with Postgres:
  // a database blip failed liveness and Kubernetes restarted every web pod. Restarting cannot fix
  // someone else's outage, and a rolling restart turns a recoverable dependency failure into a
  // self-inflicted one. Liveness is empty on purpose: the process answering at all is the signal.
  //
  // **Redis and api, and no database — this app no longer has one.** Both are named because both are
  // load-bearing for every request: Redis holds the session each one is authenticated from, and api
  // holds the case data every page renders. A probe that named only Redis would go green on a pod that
  // 500s every case page, which is worse than no probe at all — Kubernetes would keep sending it
  // traffic and nothing would escalate. That is the failure task 5 of
  // `docs/plans/completed/02-dal-cutover-to-api.md` calls out, and `deedPollApiStatus` is what answers it.
  app.use(
    healthcheck({
      checks: {},
      readinessChecks: {
        deedPollApi: deedPollApiStatus,
        redis: () => redisStatus(redisConnection)
      }
    })
  );

  const assetOptions = isDev
    ? {
        entries: {
          index_js: "/src/assets/js/index.ts",
          index_css: "/src/assets/css/index.scss",
          footer_js: "/src/assets/js/footer.ts",
          footer_css: "/src/assets/css/footer.scss"
        },
        viteConfigFile: path.join(__dirname, "../vite.build.ts")
      }
    : { distPath: path.join(__dirname, "../dist") };

  const views = await configureGovuk(app, [__dirname], {
    nunjucksGlobals: {
      appAssetPath: isDev ? "/src/assets" : "/assets",
      dynatrace: config.get("dynatrace")
    },
    assetOptions
  });
  addPathFilters(views);
  if (isDev) app.use(PDFJS_ASSET_MOUNT, pdfjsDevelopmentAssets());

  configureCookieManager(app, {
    categories: {
      essential: [sessionCookieName()],
      analytics: ["_ga", "_gid", "dtCookie", "dtSa", "rxVisitor", "rxvt"],
      preferences: ["language"]
    }
  });

  // Idle and absolute session limits (OWASP plan 03). Before requireAuth, so a timed-out session is ended rather than
  // treated as signed in, and before refreshMiddleware, so no refresh can renew a session past its absolute limit.
  // After configureGovuk, because a timed-out POST renders a page. See ./auth/session-lifetime.ts.
  app.use(
    sessionLifetime({
      ...sessionTimeouts,
      logoutPathRegistered: config.get<boolean>("session.timeoutLogoutPathRegistered") === true
    })
  );

  // Before the router, so a page is authenticated unless it is on the allowlist rather than because
  // someone remembered to guard it. See ./auth/require-auth.ts for why the polarity is that way.
  app.use(requireAuth());
  // Straight after requireAuth, so every signed-in page and every refusal shown to a signed-in user is uncacheable.
  // See ./auth/no-store.ts.
  app.use(noStore());

  // After requireAuth, so it only fires for authenticated users. Refreshes tokens before they expire,
  // keeping sessions alive without forcing re-authentication. See ./auth/refresh-middleware.ts.
  app.use(refreshMiddleware);

  // The non-production persona switcher, put on `res.locals` for `src/pages/layouts/app.njk` to render.
  // Global and before the router, which is the only shape that puts it on *every* page — decision 7, a
  // switcher the judge cannot see is a trap door with no way back out. After `refreshMiddleware` so it reads
  // a settled session rather than one mid-renewal, and it assigns nothing at all unless both halves of the
  // gate agree. See ./auth/persona-switcher.ts.
  //
  // Before the judicial gate, and that ordering is load-bearing rather than tidy: `requireJudicial` refuses
  // with `next(err)`, which skips every remaining non-error middleware — so mounted after it, a refused
  // `/judicial/**` request would reach the error views with no strip on locals, for a second reason nothing
  // in the exception list records. The strip needs only a settled session, so there is nothing to gain by
  // waiting for the role decision.
  app.use(personaSwitcherLocals());

  // The judicial area is gated on the role for the whole prefix rather than page by page, so a judicial
  // page added later is covered by where it lives. Additive to `requireAuth` above and mounted after it:
  // an anonymous visitor is still sent to log in, and only an authenticated non-judge is refused here.
  // See ./auth/require-role.ts — and note that api gates the same routes itself; this is the UI boundary.
  app.use("/judicial", requireJudicial());
  app.use("/deed-polls/gazette", requireCapability(ACCESS_GAZETTE));
  app.use("/deed-polls/settings", requireCapability(MANAGE_PROCESS_CONFIG));

  // After the gates, so a refused user is not counted, and before the router, so the cap and the limiter run
  // before the upload page's multipart parser. See ./rate-limit/routes.ts. api is authoritative; this is UX.
  mountAbuseLimits(app, createRateLimiter(redisConnection, rateLimits), uploadInFlightCap(rateLimits.uploadInFlight));

  app.use(await createSimpleRouter({ path: `${__dirname}/pages` }));
  app.use(notFoundHandler());
  // Before the starter's handler, which renders a 500 for anything at all: a missing case is a 404,
  // not a fault. Delegates everything it does not recognise, so real errors still get the starter's
  // logging and 500 page. See ./errors.ts.
  app.use(domainErrorHandler());
  app.use(errorHandler());

  return app;
}

/**
 * Connected before the session middleware is mounted, not lazily on first use: `express-session` reads
 * the store on every request and `requireAuth` is global, so a client that has not connected yet would
 * fail the first page load rather than the first sign-in.
 *
 * **Waited for, but not waited for indefinitely**, and that distinction is the whole point of the race
 * below. node-redis's default reconnect strategy returns a backoff delay for every cause except a socket
 * timeout, and `RedisSocket#connect` loops until the client is ready — so against an unreachable Redis
 * `connect()` neither resolves nor rejects. Awaiting it bare means `createApp` never returns, `app.listen`
 * in `server.ts` never runs, and **no probe is answered at all**: Kubernetes then restarts every pod over
 * someone else's outage, which is exactly the failure the empty `checks: {}` above exists to prevent.
 *
 * Serving without a connected store is safe rather than merely better than crashlooping: readiness reports
 * `redis: DOWN` until the connection completes, so Kubernetes keeps the pod out of the Service, and the
 * client keeps retrying after the bound elapses — nothing here gives up. A request that does arrive first
 * gets the starter's 500 page, which is what `disableOfflineQueue` below buys.
 *
 * Takes the URL rather than the `config` instance — `deed-poll-web` passes `config` typed as `any`, which
 * this repo's rules do not allow, and the only thing wanted from it is one string.
 */
async function getRedisClient(url: string) {
  // `disableOfflineQueue` is not a tuning knob here, it is what stops a Redis outage hanging every request.
  // With node-redis's default queue, a command issued while the client is reconnecting — `isOpen` true,
  // `isReady` false — is buffered and its promise **neither resolves nor rejects** until Redis returns
  // (`RedisClient#sendCommand`). `express-session` reads the store on every request and `requireAuth` is
  // global, so the whole outage would present as browsers spinning indefinitely: no error page, no log line,
  // and an unbounded backlog of queued commands and held sockets, since the empty liveness checks mean
  // nothing restarts the pod either. Rejecting instead turns that into a `ClientOfflineError` that reaches
  // `errorHandler()` as a 500 — the ordinary "problem with the service" page, which is diagnosable.
  //
  // The cost is that a sub-second reconnect (an Azure Cache failover, a patching window) now 500s the
  // requests in flight rather than making them wait it out. That is the right way round: readiness already
  // takes the pod out of the Service for anything longer, and a bounded error beats an unbounded wait.
  const redisClient = createClient({ url, disableOfflineQueue: true });
  // Without a listener, a connection error after startup is an unhandled `error` event on an EventEmitter,
  // which takes the process down — so a Redis blip would restart every pod rather than fail readiness.
  redisClient.on("error", (error) => console.error("Redis Client Error", error));

  // `catch` on the connect and not on the race: whichever side wins, a rejection arriving later still has
  // a handler, so a bad URL cannot surface as an unhandled rejection after startup has moved on. The timer
  // is unreferenced so a fast connect does not hold the event loop open for the rest of the bound.
  await Promise.race([
    redisClient.connect().catch((error) => console.error("Redis Client Error", error)),
    delay(REDIS_CONNECT_TIMEOUT_MS, undefined, { ref: false })
  ]);
  return redisClient;
}

/**
 * Readiness from Redis, and deliberately not a bare `ping()`.
 *
 * `runChecks` in the healthcheck middleware is a bare `Promise.all` with no timeout of its own, so any check
 * that does not settle hangs `/health/readiness` for the whole outage — never a 503, and the api result
 * never reported either, since it is awaited alongside. Kubernetes would still take the pod out
 * of service on its own probe timeout, so the symptom is an endpoint that is useless to whoever is
 * diagnosing the outage rather than a pod serving traffic it cannot handle. A probe must therefore answer
 * on its own terms and never inherit the client's patience.
 *
 * `isReady` answers the ordinary case without touching the socket: a reconnecting client has `isOpen` true
 * and `isReady` false, which is the state that says "down" without a round trip. The bound covers the
 * connection that drops between that check and the reply. `disableOfflineQueue` in `getRedisClient` means
 * such a ping would reject rather than stall, but the probe does not rely on that — the whole point here is
 * that it settles regardless. Either way this is a bound on the *probe*, not on the client; nothing here
 * gives up on Redis.
 */
async function redisStatus(client: RedisConnection): Promise<HealthStatus> {
  if (!client.isReady) return "DOWN";

  // No `catch` on the ping itself: `Promise.race` subscribes to it either way, so a rejection arriving
  // after the timer has won is still handled and cannot surface as an unhandled rejection.
  return Promise.race([
    client.ping().then<HealthStatus>(() => "UP"),
    delay(REDIS_PING_TIMEOUT_MS, undefined, { ref: false }).then<HealthStatus>(() => "DOWN")
  ]).catch<HealthStatus>(() => "DOWN");
}

type RedisConnection = Awaited<ReturnType<typeof getRedisClient>>;
