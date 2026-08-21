import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules before any imports
vi.mock("node:fs");
vi.mock("node:path");

describe("assets", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    // Important: Reset modules to clear the manifest cache between tests
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe("createAssetHelpers", () => {
    it("should load manifest and return hashed filenames", async () => {
      const manifestContent = JSON.stringify({
        "src/assets/js/main.ts": {
          file: "js/main-abc123.js",
          name: "mainJs",
          isEntry: true
        },
        "src/assets/css/main.scss": {
          file: "css/main-def456.css",
          name: "mainCss.css",
          isEntry: true
        }
      });

      vi.mocked(path.join).mockReturnValue("/dist/assets/.vite/manifest.json");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

      const { createAssetHelpers } = await import("./assets.js");
      const distPath = "/dist";

      const helpers = createAssetHelpers(distPath);

      expect(helpers.mainJs).toBe("/assets/js/main-abc123.js");
      expect(helpers.mainCss).toBe("/assets/css/main-def456.css");
    });

    it("should handle empty manifest", async () => {
      vi.mocked(path.join).mockReturnValue("/dist/assets/.vite/manifest.json");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { createAssetHelpers } = await import("./assets.js");
      const distPath = "/dist";

      const helpers = createAssetHelpers(distPath);

      expect(helpers).toEqual({});
    });

    it("should handle manifest with multiple names", async () => {
      const manifestContent = JSON.stringify({
        "src/assets/js/app.ts": {
          file: "js/app-xyz789.js",
          name: "app",
          names: ["appMain", "appBundle"],
          isEntry: true
        }
      });

      vi.mocked(path.join).mockReturnValue("/dist/assets/.vite/manifest.json");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

      const { createAssetHelpers } = await import("./assets.js");
      const distPath = "/dist";

      const helpers = createAssetHelpers(distPath);

      expect(helpers.app).toBe("/assets/js/app-xyz789.js");
      expect(helpers.appMain).toBe("/assets/js/app-xyz789.js");
      expect(helpers.appBundle).toBe("/assets/js/app-xyz789.js");
    });

    it("should handle manifest read errors", async () => {
      vi.mocked(path.join).mockReturnValue("/dist/assets/.vite/manifest.json");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("Read error");
      });

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { createAssetHelpers } = await import("./assets.js");
      const distPath = "/dist";

      const helpers = createAssetHelpers(distPath);

      expect(helpers).toEqual({});
      expect(consoleSpy).toHaveBeenCalledWith("Failed to load Vite manifest:", expect.any(Error));

      consoleSpy.mockRestore();
    });

    it("should strip .css suffix from helper names", async () => {
      const manifestContent = JSON.stringify({
        "src/assets/css/styles.scss": {
          file: "css/styles-hash.css",
          name: "styles.css",
          isEntry: true
        }
      });

      vi.mocked(path.join).mockReturnValue("/dist/assets/.vite/manifest.json");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

      const { createAssetHelpers } = await import("./assets.js");
      const distPath = "/dist";

      const helpers = createAssetHelpers(distPath);

      expect(helpers.styles).toBe("/assets/css/styles-hash.css");
      expect(helpers["styles.css"]).toBeUndefined();
    });

    it("should handle entries without name property", async () => {
      const manifestContent = JSON.stringify({
        "src/assets/js/vendor.ts": {
          file: "js/vendor-abc.js",
          isEntry: true
        }
      });

      vi.mocked(path.join).mockReturnValue("/dist/assets/.vite/manifest.json");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(manifestContent);

      const { createAssetHelpers } = await import("./assets.js");
      const distPath = "/dist";

      const helpers = createAssetHelpers(distPath);

      // Entry without name should be skipped
      expect(Object.keys(helpers)).toHaveLength(0);
    });
  });
});
