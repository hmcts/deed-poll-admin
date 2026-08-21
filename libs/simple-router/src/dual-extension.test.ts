import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRoutes } from "./route-discovery.js";

describe("route-discovery dual extension support", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-dual-ext-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should discover both .ts and .js files", () => {
    // Create .ts file in one directory
    mkdirSync(join(testDir, "typescript-route"), { recursive: true });
    writeFileSync(join(testDir, "typescript-route", "index.ts"), "");

    // Create .js file in another directory
    mkdirSync(join(testDir, "javascript-route"), { recursive: true });
    writeFileSync(join(testDir, "javascript-route", "index.js"), "");

    // Create directory with both (should prefer .ts in dev, but discover both)
    mkdirSync(join(testDir, "mixed-route"), { recursive: true });
    writeFileSync(join(testDir, "mixed-route", "index.ts"), "");
    writeFileSync(join(testDir, "mixed-route", "index.js"), "");

    const routes = discoverRoutes(testDir);

    // Should discover all three routes
    expect(routes).toHaveLength(3);

    const paths = routes.map((r) => r.urlPath).sort();
    expect(paths).toEqual(["/javascript-route", "/mixed-route", "/typescript-route"]);

    // Check file extensions
    const tsRoute = routes.find((r) => r.urlPath === "/typescript-route");
    const jsRoute = routes.find((r) => r.urlPath === "/javascript-route");
    const mixedRoute = routes.find((r) => r.urlPath === "/mixed-route");

    expect(tsRoute?.relativePath).toContain("index.ts");
    expect(jsRoute?.relativePath).toContain("index.js");
    // When both exist, .ts is discovered (appears first in condition)
    expect(mixedRoute?.relativePath).toContain("index.ts");
  });

  it("should work with only .js files (production mode)", () => {
    mkdirSync(join(testDir, "prod-route"), { recursive: true });
    writeFileSync(join(testDir, "prod-route", "index.js"), "");

    mkdirSync(join(testDir, "api", "users"), { recursive: true });
    writeFileSync(join(testDir, "api", "users", "index.js"), "");

    const routes = discoverRoutes(testDir);

    expect(routes).toHaveLength(2);
    const paths = routes.map((r) => r.urlPath).sort();
    expect(paths).toEqual(["/api/users", "/prod-route"]);

    // All should be .js files
    routes.forEach((route) => {
      expect(route.relativePath).toContain(".js");
    });
  });

  it("should work with only .ts files (development mode)", () => {
    mkdirSync(join(testDir, "dev-route"), { recursive: true });
    writeFileSync(join(testDir, "dev-route", "index.ts"), "");

    mkdirSync(join(testDir, "api", "posts"), { recursive: true });
    writeFileSync(join(testDir, "api", "posts", "index.ts"), "");

    const routes = discoverRoutes(testDir);

    expect(routes).toHaveLength(2);
    const paths = routes.map((r) => r.urlPath).sort();
    expect(paths).toEqual(["/api/posts", "/dev-route"]);

    // All should be .ts files
    routes.forEach((route) => {
      expect(route.relativePath).toContain(".ts");
    });
  });
});
