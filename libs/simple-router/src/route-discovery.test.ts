import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRoutes, sortRoutes } from "./route-discovery.js";

describe("route-discovery", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-routes-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("discoverRoutes", () => {
    it("should discover index.ts at root", () => {
      writeFileSync(join(testDir, "index.ts"), "");

      const routes = discoverRoutes(testDir);

      expect(routes).toHaveLength(1);
      expect(routes[0].urlPath).toBe("/");
      expect(routes[0].relativePath).toBe("index.ts");
    });

    it("should discover nested routes", () => {
      mkdirSync(join(testDir, "about"), { recursive: true });
      writeFileSync(join(testDir, "about", "index.ts"), "");

      mkdirSync(join(testDir, "posts"), { recursive: true });
      writeFileSync(join(testDir, "posts", "index.ts"), "");

      const routes = discoverRoutes(testDir);

      expect(routes).toHaveLength(2);
      const paths = routes.map((r) => r.urlPath).sort();
      expect(paths).toEqual(["/about", "/posts"]);
    });

    it("should handle dynamic route segments", () => {
      mkdirSync(join(testDir, "posts", "[id]"), { recursive: true });
      writeFileSync(join(testDir, "posts", "[id]", "index.ts"), "");

      const routes = discoverRoutes(testDir);

      expect(routes).toHaveLength(1);
      expect(routes[0].urlPath).toBe("/posts/:id");
    });

    it("should ignore dotfiles and dot directories", () => {
      writeFileSync(join(testDir, "index.ts"), "");
      writeFileSync(join(testDir, ".hidden.ts"), "");

      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "index.ts"), "");

      const routes = discoverRoutes(testDir);

      expect(routes).toHaveLength(1);
      expect(routes[0].urlPath).toBe("/");
    });

    it("should discover non-index .ts and .js files", () => {
      writeFileSync(join(testDir, "index.ts"), "");
      writeFileSync(join(testDir, "privacy-policy.ts"), "");
      writeFileSync(join(testDir, "terms-of-service.js"), "");

      mkdirSync(join(testDir, "about"), { recursive: true });
      writeFileSync(join(testDir, "about", "team.ts"), "");

      mkdirSync(join(testDir, "posts"), { recursive: true });
      writeFileSync(join(testDir, "posts", "index.js"), "");

      const routes = discoverRoutes(testDir);

      expect(routes).toHaveLength(5);
      const paths = routes.map((r) => r.urlPath).sort();
      expect(paths).toEqual(["/", "/about/team", "/posts", "/privacy-policy", "/terms-of-service"]);
    });

    it("should prefer .ts files over .js files for the same route", () => {
      // Create both .ts and .js files with the same name
      writeFileSync(join(testDir, "contact.ts"), "");
      writeFileSync(join(testDir, "contact.js"), "");

      const routes = discoverRoutes(testDir);

      expect(routes).toHaveLength(1);
      expect(routes[0].urlPath).toBe("/contact");
      // Should prefer .ts file
      expect(routes[0].relativePath).toBe("contact.ts");
    });

    it("should handle deeply nested routes", () => {
      mkdirSync(join(testDir, "admin", "users", "[id]", "settings"), { recursive: true });
      writeFileSync(join(testDir, "admin", "users", "[id]", "settings", "index.ts"), "");

      const routes = discoverRoutes(testDir);

      expect(routes).toHaveLength(1);
      expect(routes[0].urlPath).toBe("/admin/users/:id/settings");
    });
  });

  describe("real-world scenario", () => {
    it("should handle mixed index and non-index files like privacy-policy.ts", () => {
      // Simulate a real app structure
      writeFileSync(join(testDir, "index.ts"), "");
      writeFileSync(join(testDir, "privacy-policy.ts"), "");
      writeFileSync(join(testDir, "terms.ts"), "");

      mkdirSync(join(testDir, "admin"), { recursive: true });
      writeFileSync(join(testDir, "admin", "index.ts"), "");
      writeFileSync(join(testDir, "admin", "settings.ts"), "");

      mkdirSync(join(testDir, "api", "users"), { recursive: true });
      writeFileSync(join(testDir, "api", "users", "index.ts"), "");
      writeFileSync(join(testDir, "api", "users", "profile.ts"), "");

      const routes = discoverRoutes(testDir);
      const paths = routes.map((r) => r.urlPath).sort();

      expect(paths).toEqual(["/", "/admin", "/admin/settings", "/api/users", "/api/users/profile", "/privacy-policy", "/terms"]);
    });
  });

  describe("sortRoutes", () => {
    it("should sort static routes before dynamic routes", () => {
      const routes = [
        { relativePath: "posts/[id]/index.ts", urlPath: "/posts/:id", absolutePath: "" },
        { relativePath: "posts/index.ts", urlPath: "/posts", absolutePath: "" },
        { relativePath: "index.ts", urlPath: "/", absolutePath: "" }
      ];

      const sorted = sortRoutes(routes);

      expect(sorted.map((r) => r.urlPath)).toEqual(["/", "/posts", "/posts/:id"]);
    });

    it("should sort by number of parameters", () => {
      const routes = [
        { relativePath: "[a]/[b]/[c]/index.ts", urlPath: "/:a/:b/:c", absolutePath: "" },
        { relativePath: "[a]/index.ts", urlPath: "/:a", absolutePath: "" },
        { relativePath: "[a]/[b]/index.ts", urlPath: "/:a/:b", absolutePath: "" }
      ];

      const sorted = sortRoutes(routes);

      expect(sorted.map((r) => r.urlPath)).toEqual(["/:a", "/:a/:b", "/:a/:b/:c"]);
    });

    it("should sort by path length when param count is equal", () => {
      const routes = [
        { relativePath: "posts/[id]/edit/index.ts", urlPath: "/posts/:id/edit", absolutePath: "" },
        { relativePath: "posts/[id]/index.ts", urlPath: "/posts/:id", absolutePath: "" }
      ];

      const sorted = sortRoutes(routes);

      expect(sorted.map((r) => r.urlPath)).toEqual(["/posts/:id", "/posts/:id/edit"]);
    });

    it("should prioritize static segments over dynamic at same position", () => {
      const routes = [
        { relativePath: "posts/[id]/index.ts", urlPath: "/posts/:id", absolutePath: "" },
        { relativePath: "posts/new/index.ts", urlPath: "/posts/new", absolutePath: "" }
      ];

      const sorted = sortRoutes(routes);

      expect(sorted.map((r) => r.urlPath)).toEqual(["/posts/new", "/posts/:id"]);
    });
  });
});
