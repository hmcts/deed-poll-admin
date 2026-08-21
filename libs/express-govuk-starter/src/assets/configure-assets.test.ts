import { existsSync } from "node:fs";
import type { Express } from "express";
import express from "express";
import type nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureAssets } from "./configure-assets.js";

vi.mock("vite", () => ({
  createServer: vi.fn().mockResolvedValue({
    middlewares: (_req: unknown, _res: unknown, next: () => void) => next()
  })
}));

vi.mock("./assets.js", () => ({
  createAssetHelpers: vi.fn().mockReturnValue({ index_js: "/assets/js/index-abc.js", index_css: "/assets/css/index-def.css" })
}));

describe("configureAssets", () => {
  let app: Express;
  let env: nunjucks.Environment;

  beforeEach(() => {
    app = express();
    env = { addGlobal: vi.fn() } as unknown as nunjucks.Environment;
    vi.clearAllMocks();
  });

  describe("entries config (dev mode)", () => {
    it("should create a vite dev server and mount its middleware", async () => {
      const { createServer } = await import("vite");

      await configureAssets(app, env, {
        entries: { index_js: "/src/assets/js/index.ts" },
        viteConfigFile: "/path/to/vite.config.ts"
      });

      expect(createServer).toHaveBeenCalledWith({
        configFile: "/path/to/vite.config.ts",
        server: { middlewareMode: true },
        appType: "custom"
      });
    });

    it("should add entry values as nunjucks globals", async () => {
      const entries = {
        index_js: "/src/assets/js/index.ts",
        index_css: "/src/assets/css/index.scss"
      };

      await configureAssets(app, env, {
        entries,
        viteConfigFile: "/path/to/vite.config.ts"
      });

      expect(env.addGlobal).toHaveBeenCalledWith("index_js", "/src/assets/js/index.ts");
      expect(env.addGlobal).toHaveBeenCalledWith("index_css", "/src/assets/css/index.scss");
    });

    it("should mount static routes for govuk fonts and images", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureAssets(app, env, {
        entries: { index_js: "/src/assets/js/index.ts" },
        viteConfigFile: "/path/to/vite.config.ts"
      });

      const staticCalls = useSpy.mock.calls.filter((call) => typeof call[0] === "string" && call[0].startsWith("/assets/"));
      expect(staticCalls.some((call) => call[0] === "/assets/fonts")).toBe(true);
      expect(staticCalls.some((call) => call[0] === "/assets/images")).toBe(true);
    });

    it("should resolve govuk-frontend asset paths that exist on disk", async () => {
      const staticSpy = vi.spyOn(express, "static");

      await configureAssets(app, env, {
        entries: { index_js: "/src/assets/js/index.ts" },
        viteConfigFile: "/path/to/vite.config.ts"
      });

      const fontPath = staticSpy.mock.calls.find((call) => typeof call[0] === "string" && call[0].endsWith("/fonts"))?.[0] as string;
      const imagePath = staticSpy.mock.calls.find((call) => typeof call[0] === "string" && call[0].endsWith("/images"))?.[0] as string;

      expect(existsSync(fontPath)).toBe(true);
      expect(existsSync(imagePath)).toBe(true);
    });
  });

  describe("distPath config (production mode)", () => {
    it("should mount static assets from dist", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureAssets(app, env, { distPath: "/app/dist" });

      const staticCalls = useSpy.mock.calls.filter((call) => typeof call[0] === "string" && call[0] === "/assets");
      expect(staticCalls).toHaveLength(1);
    });

    it("should add asset helpers as nunjucks globals", async () => {
      await configureAssets(app, env, { distPath: "/app/dist" });

      expect(env.addGlobal).toHaveBeenCalledWith("index_js", "/assets/js/index-abc.js");
      expect(env.addGlobal).toHaveBeenCalledWith("index_css", "/assets/css/index-def.css");
    });
  });
});
