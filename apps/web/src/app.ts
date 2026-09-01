import path from "node:path";
import { fileURLToPath } from "node:url";
import { pgPool } from "@hmcts/postgres-prisma";
import { getPropertiesVolumeSecrets, hc, healthcheck, monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";
import { configureCookieManager, configureGovuk, configureHelmet, configureNonce, errorHandler, notFoundHandler } from "@hmcts-cft/express-govuk-starter";
import { expressSessionPostgres } from "@hmcts-cft/express-session-postgres";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import cookieParser from "cookie-parser";
import type { Express } from "express";
import express from "express";
import { requireAuth } from "./auth/require-auth.js";
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
  app.use(expressSessionPostgres({ pgConnection: pgPool, sessionOptions: { secret: config.get<string>("session.secret") } }));
  app.use(
    healthcheck({
      checks: {
        postgres: hc.raw(() => pgPool.query("select 1"))
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

  app.use(await createSimpleRouter({ path: `${__dirname}/pages` }));
  app.use(notFoundHandler());
  // Before the starter's handler, which renders a 500 for anything at all: a missing case is a 404,
  // not a fault. Delegates everything it does not recognise, so real errors still get the starter's
  // logging and 500 page. See ./errors.ts.
  app.use(domainErrorHandler());
  app.use(errorHandler());

  return app;
}
