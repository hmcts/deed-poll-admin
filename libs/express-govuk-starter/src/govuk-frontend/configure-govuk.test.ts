import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureGovuk } from "./configure-govuk.js";

describe("configureGovuk", () => {
  let app: Express;
  let testDir: string;

  beforeEach(() => {
    app = express();
    // Create a temporary test directory for views and assets
    testDir = join(tmpdir(), `test-govuk-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up the test directory
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should configure nunjucks environment", async () => {
    // Create a minimal pages directory
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    expect(env).toBeDefined();
    expect(env.addFilter).toBeDefined();
    expect(env.addGlobal).toBeDefined();
    expect(app.get("view engine")).toBe("njk");
  });

  it("should add custom view paths", async () => {
    const customPagesPath = join(testDir, "pages");
    mkdirSync(customPagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    expect(env).toBeDefined();
    // The environment should be configured with the custom view path
    expect(env.loaders).toBeDefined();
  });

  it("should add filters to nunjucks environment", async () => {
    // Create a minimal pages directory
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    // Check that filters are added
    expect(env.getFilter("date")).toBeDefined();
    expect(env.getFilter("time")).toBeDefined();
    expect(env.getFilter("currency")).toBeDefined();
    expect(env.getFilter("kebabCase")).toBeDefined();
    expect(env.getFilter("govukErrorSummary")).toBeDefined();
  });

  it("should add globals to nunjucks environment", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    // Create a minimal pages directory
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    expect(env.getGlobal("isProduction")).toBe(true);

    process.env.NODE_ENV = originalNodeEnv;
  });

  it("should set up i18n middleware when i18nContentPath is provided", async () => {
    // Create test translation files
    const localesPath = join(testDir, "locales");
    mkdirSync(localesPath, { recursive: true });

    const enContent = `export const content = { welcome: "Welcome" };`;
    const cyContent = `export const content = { welcome: "Croeso" };`;

    writeFileSync(join(localesPath, "en.js"), enContent);
    writeFileSync(join(localesPath, "cy.js"), cyContent);

    const useSpy = vi.spyOn(app, "use");

    await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    // Check that middleware was added
    expect(useSpy).toHaveBeenCalled();
    // Should add locale middleware, render interceptor, translation middleware, static assets, and pageUrl middleware
    const middlewareCalls = useSpy.mock.calls;
    expect(middlewareCalls.length).toBeGreaterThanOrEqual(5); // 3 i18n middlewares + static assets + pageUrl middleware
  });

  it("should not set up i18n middleware when i18nContentPath is not provided", async () => {
    const useSpy = vi.spyOn(app, "use");

    // Create a minimal pages directory
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    // Should add the static assets middleware and pageUrl middleware (2 total)
    const middlewareCalls = useSpy.mock.calls;
    expect(middlewareCalls.length).toBe(2);
  });

  it("should configure assets when assets option is provided", async () => {
    const manifestPath = join(testDir, "manifest.json");
    const manifest = {
      "src/index.js": {
        file: "assets/index-abc123.js",
        css: ["assets/index-def456.css"]
      }
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const assetsPath = join(testDir, "assets");
    mkdirSync(assetsPath, { recursive: true });

    // Create images directory to avoid errors
    const imagesPath = join(testDir, "images");
    mkdirSync(imagesPath, { recursive: true });

    // Create js and css directories with files
    const jsPath = join(assetsPath, "js");
    const cssPath = join(assetsPath, "css");
    mkdirSync(jsPath, { recursive: true });
    mkdirSync(cssPath, { recursive: true });
    writeFileSync(join(jsPath, "main.js"), "// main.js");
    writeFileSync(join(cssPath, "main.css"), "/* main.css */");

    await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    // The assets should be configured (checking that no error was thrown)
    expect(app.get("view engine")).toBe("njk");
  });

  it("should add pageUrl and serviceUrl to res.locals", async () => {
    const useSpy = vi.spyOn(app, "use");

    // Create a minimal pages directory
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    // Get the last middleware added (pageUrl middleware)
    const lastMiddleware = useSpy.mock.calls[useSpy.mock.calls.length - 1][0] as any;

    // Create mock request and response
    const req = {
      path: "/test/path",
      protocol: "https",
      get: vi.fn((header: string) => {
        if (header === "host") return "example.com";
        return undefined;
      })
    };
    const res = { locals: {} };
    const next = vi.fn();

    // Call the middleware
    lastMiddleware(req, res, next);

    expect(res.locals.pageUrl).toBe("/test/path");
    expect(res.locals.serviceUrl).toBe("https://example.com");
    expect(next).toHaveBeenCalled();
  });

  it("should handle development mode settings", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    // Create a minimal pages directory
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    expect(env.getGlobal("isProduction")).toBe(false);
    // In development, nunjucks should have watch and noCache enabled
    // These are internal to nunjucks configuration

    process.env.NODE_ENV = originalNodeEnv;
  });

  it("should return nunjucks environment", async () => {
    // Create a minimal pages directory
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    // Verify it's a nunjucks environment
    expect(env).toBeDefined();
    expect(env.addFilter).toBeDefined();
    expect(env.addGlobal).toBeDefined();
    // These are the methods we know exist on the Nunjucks Environment
    expect(env.getFilter).toBeDefined();
    expect(env.getGlobal).toBeDefined();
  });

  it("should handle empty paths gracefully", async () => {
    const env = await configureGovuk(app, [], {
      assetOptions: { distPath: testDir }
    });

    expect(env).toBeDefined();
    expect(app.get("view engine")).toBe("njk");
  });

  it("should handle multiple module paths", async () => {
    const module1 = join(testDir, "module1");
    const module2 = join(testDir, "module2");
    const pages1 = join(module1, "pages");
    const pages2 = join(module2, "pages");
    mkdirSync(pages1, { recursive: true });
    mkdirSync(pages2, { recursive: true });

    const env = await configureGovuk(app, [module1, module2], {
      assetOptions: { distPath: testDir }
    });

    expect(env).toBeDefined();
    // Both view paths should be added to the environment
    expect(env.loaders).toBeDefined();
  });

  it("should resolve the lib's own view templates", async () => {
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir }
    });

    // default.njk ships with the lib; it must be loadable regardless of
    // whether the consumer installed via npm (dist/) or uses workspace-link (src/).
    expect(() => env.getTemplate("layouts/default.njk")).not.toThrow();
  });

  it("should add custom nunjucks globals", async () => {
    const pagesPath = join(testDir, "pages");
    mkdirSync(pagesPath, { recursive: true });

    const env = await configureGovuk(app, [testDir], {
      assetOptions: { distPath: testDir },
      nunjucksGlobals: {
        customGlobal: "test value",
        anotherGlobal: 123
      }
    });

    expect(env.getGlobal("customGlobal")).toBe("test value");
    expect(env.getGlobal("anotherGlobal")).toBe(123);
  });
});
