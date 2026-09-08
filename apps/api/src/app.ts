// API Application Entry Point
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deedPollDatabaseChecks } from "@hmcts/deed-poll";
import { healthcheck, monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import compression from "compression";
import cors from "cors";
import type { Express } from "express";
import express from "express";
import { authenticate } from "./auth/authenticate.js";
import { idamApiConfig } from "./auth/idam.js";
import { errorHandler } from "./errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp(): Promise<Express> {
  // `server.ts` has already loaded the key vault secrets into the environment by the time this runs, and
  // it has to be that way round rather than a call from here: see ./secrets.ts.
  const { default: config } = await import("config");
  const app = express();

  // Database checks are readiness only, never liveness. `healthcheck()` defaults `readinessChecks` to
  // `checks`, so passing them as `checks` would put them on both — and a Postgres blip would then fail
  // liveness and have Kubernetes restart every pod, which cannot fix someone else's database and turns
  // a recoverable dependency outage into a rolling one. Liveness is empty on purpose: the process
  // answering at all is the signal. This previously called `healthcheck()` bare, so readiness passed
  // unconditionally and AKS would route traffic to a pod that could not reach Postgres.
  app.use(healthcheck({ checks: {}, readinessChecks: deedPollDatabaseChecks() }));
  app.use(monitoringMiddleware(config.get("applicationInsights")));

  app.use(compression());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
      credentials: true
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Before the router, so a route is authenticated by default rather than when someone remembers.
  // After the healthcheck above, which must stay reachable without a token for AKS probes to work.
  app.use(authenticate(idamApiConfig(config.get("idam"))));

  app.use(await createSimpleRouter({ path: `${__dirname}/routes` }));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Maps domain errors onto status codes; falls through to a generic 500. Must be last.
  app.use(errorHandler());

  return app;
}
