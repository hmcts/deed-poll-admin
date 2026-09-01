// API Application Entry Point
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPropertiesVolumeSecrets, healthcheck, monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";
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
const chartPath = path.join(__dirname, "../helm/values.yaml");

export async function createApp(): Promise<Express> {
  await getPropertiesVolumeSecrets({ chartPath, omit: ["DATABASE_URL"] });

  const { default: config } = await import("config");
  const app = express();

  app.use(healthcheck());
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
