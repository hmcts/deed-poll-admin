import path from "node:path";
import { fileURLToPath } from "node:url";
import { deedPollDatabaseChecks } from "@hmcts/deed-poll";
import { getPropertiesVolumeSecrets, hc, healthcheck, monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";
import { configureCookieManager, configureGovuk, configureHelmet, configureNonce, errorHandler, notFoundHandler } from "@hmcts-cft/express-govuk-starter";
import { expressSessionRedis } from "@hmcts-cft/express-session-redis";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import cookieParser from "cookie-parser";
import type { Express } from "express";
import express from "express";
import { createClient } from "redis";
import { refreshMiddleware } from "./auth/refresh-middleware.js";
import { requireAuth } from "./auth/require-auth.js";
import { assertSessionSecret } from "./auth/session.js";
import { assertIdamSettings, idamSettings } from "./auth/settings.js";
import { domainErrorHandler } from "./errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chartPath = path.join(__dirname, "../helm/values.yaml");
const isDev = process.env.NODE_ENV !== "production" && process.env.VITE_MIDDLEWARE !== "false";

export async function createApp(): Promise<Express> {
  await getPropertiesVolumeSecrets({ chartPath, omit: ["DATABASE_URL", "REDIS_URL"] });

  const { default: config } = await import("config");
  const redisConnection = await getRedisClient(config.get<string>("redis.url"));
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(monitoringMiddleware(config.get("applicationInsights")));
  app.use(configureNonce());
  app.use(configureHelmet());
  const sessionSecret = config.get<string>("session.secret");
  assertSessionSecret(sessionSecret);
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
  app.use(expressSessionRedis({ redisConnection, sessionOptions: { secret: sessionSecret } }));
  // Readiness only, never liveness. `healthcheck()` defaults `readinessChecks` to `checks`, so this
  // previously put Postgres on **both** — meaning a database blip failed liveness and Kubernetes
  // restarted every web pod. Restarting cannot fix someone else's database, and a rolling restart of
  // the deployment turns a recoverable dependency outage into a self-inflicted one. Liveness is empty
  // on purpose: the process answering at all is the signal.
  //
  // The checks also cover the deed-poll tables, not just the connection: an unmigrated pod passes
  // `select 1` while every request 500s, and a green probe means nothing escalates.
  //
  // Both Redis and the database, because this app depends on both until the api cutover — Redis holds
  // the session that every request is authenticated from, and case data is still read through Prisma
  // here. A probe that stopped naming the database would go green while every case page 500s.
  app.use(
    healthcheck({
      checks: {},
      readinessChecks: {
        ...deedPollDatabaseChecks(),
        redis: hc.raw(() => redisConnection.ping())
      }
    })
  );

  const assetOptions = isDev
    ? {
        entries: {
          index_js: "/src/assets/js/index.ts",
          index_css: "/src/assets/css/index.scss",
          footer_js: "/src/assets/js/footer.ts",
          footer_css: "/src/assets/css/footer.scss",
          onboarding_js: "/src/assets/js/onboarding.ts",
          onboarding_css: "/src/assets/css/onboarding.scss"
        },
        viteConfigFile: path.join(__dirname, "../vite.build.ts")
      }
    : { distPath: path.join(__dirname, "../dist") };

  await configureGovuk(app, [__dirname], {
    nunjucksGlobals: {
      gtm: config.get("gtm"),
      dynatrace: config.get("dynatrace")
    },
    assetOptions
  });

  await configureCookieManager(app, {
    categories: {
      essential: ["connect.sid"],
      analytics: ["_ga", "_gid", "dtCookie", "dtSa", "rxVisitor", "rxvt"],
      preferences: ["language"]
    }
  });

  // Before the router, so a page is authenticated unless it is on the allowlist rather than because
  // someone remembered to guard it. See ./auth/require-auth.ts for why the polarity is that way.
  app.use(requireAuth());

  // After requireAuth, so it only fires for authenticated users. Refreshes tokens before they expire,
  // keeping sessions alive without forcing re-authentication. See ./auth/refresh-middleware.ts.
  app.use(refreshMiddleware);

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
 * Takes the URL rather than the `config` instance — `deed-poll-web` passes `config` typed as `any`, which
 * this repo's rules do not allow, and the only thing wanted from it is one string.
 */
async function getRedisClient(url: string) {
  const redisClient = createClient({ url });
  // Without a listener, a connection error after startup is an unhandled `error` event on an EventEmitter,
  // which takes the process down — so a Redis blip would restart every pod rather than fail readiness.
  redisClient.on("error", (error) => console.error("Redis Client Error", error));

  await redisClient.connect();
  return redisClient;
}
