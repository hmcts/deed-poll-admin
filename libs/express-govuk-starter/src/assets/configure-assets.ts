import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import express from "express";
import type nunjucks from "nunjucks";
import type { AssetOptions } from "./assets.js";
import { createAssetHelpers } from "./assets.js";

export async function configureAssets(app: Express, env: nunjucks.Environment, config: AssetOptions): Promise<void> {
  if ("entries" in config) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: config.viteConfigFile,
      server: { middlewareMode: true },
      appType: "custom"
    });
    app.use(vite.middlewares);

    const govukFrontendPath = path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", "..");
    const govukAssets = path.join(govukFrontendPath, "govuk/assets");
    app.use("/assets/fonts", express.static(path.join(govukAssets, "fonts")));
    app.use("/assets/images", express.static(path.join(govukAssets, "images")));

    for (const [name, value] of Object.entries(config.entries)) {
      env.addGlobal(name, value);
    }
    return;
  }

  app.use("/assets", express.static(path.join(config.distPath, "assets")));
  const assetHelpers = createAssetHelpers(config.distPath);
  for (const [name, value] of Object.entries(assetHelpers)) {
    env.addGlobal(name, value);
  }
}
