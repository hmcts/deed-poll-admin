import path from "node:path";
import { fileURLToPath } from "node:url";
import { deedPollDatabaseChecks } from "@hmcts/deed-poll";
import { pgPool } from "@hmcts/postgres-prisma";
import { getPropertiesVolumeSecrets, healthcheck, monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";
import { configureCookieManager, configureGovuk, configureHelmet, configureNonce, errorHandler, notFoundHandler } from "@hmcts-cft/express-govuk-starter";
import { expressSessionPostgres } from "@hmcts-cft/express-session-postgres";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import cookieParser from "cookie-parser";
import type { Express } from "express";
import express from "express";
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
  await getPropertiesVolumeSecrets({ chartPath, omit: ["DATABASE_URL"] });

  const { default: config } = await import("config");
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
  app.use(expressSessionPostgres({ pgConnection: pgPool, sessionOptions: { secret: sessionSecret } }));
  // Readiness only, never liveness. `healthcheck()` defaults `readinessChecks` to `checks`, so this
  // previously put Postgres on **both** — meaning a database blip failed liveness and Kubernetes
  // restarted every web pod. Restarting cannot fix someone else's database, and a rolling restart of
  // the deployment turns a recoverable dependency outage into a self-inflicted one. Liveness is empty
  // on purpose: the process answering at all is the signal.
  //
  // The checks now also cover the deed-poll tables, not just the connection: an unmigrated pod passes
  // `select 1` while every request 500s, and a green probe means nothing escalates.
  app.use(healthcheck({ checks: {}, readinessChecks: deedPollDatabaseChecks() }));

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
