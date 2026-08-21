// API Application Entry Point
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPropertiesVolumeSecrets, healthcheck, monitoringMiddleware } from "@hmcts-cft/cloud-native-platform";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import compression from "compression";
import cors from "cors";
import type { Express } from "express";
import express from "express";

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

  app.use(await createSimpleRouter({ path: `${__dirname}/routes` }));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
