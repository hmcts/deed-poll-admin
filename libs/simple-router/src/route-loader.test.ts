import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RequestHandler } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractHandlers, loadRouteModule, normalizeHandlers } from "./route-loader.js";

describe("route-loader", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-loader-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testFile = join(testDir, "index.js");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadRouteModule", () => {
    it("should load a module with exports", async () => {
      const moduleContent = `
export const GET = (req, res) => res.send('GET');
export const POST = (req, res) => res.send('POST');
`;
      writeFileSync(testFile, moduleContent);

      const module = await loadRouteModule(testFile);

      expect(module.GET).toBeDefined();
      expect(module.POST).toBeDefined();
      expect(typeof module.GET).toBe("function");
    });

    it("should load a module with mixed case exports", async () => {
      const moduleContent = `
export const get = (req, res) => res.send('get');
export const Post = (req, res) => res.send('Post');
export const DELETE = (req, res) => res.send('DELETE');
`;
      writeFileSync(testFile, moduleContent);

      const module = await loadRouteModule(testFile);

      expect(module.get).toBeDefined();
      expect(module.Post).toBeDefined();
      expect(module.DELETE).toBeDefined();
    });
  });

  describe("extractHandlers", () => {
    it("should extract valid HTTP method handlers", () => {
      const module = {
        GET: vi.fn((_req, _res) => {}),
        POST: vi.fn((_req, _res) => {}),
        PUT: vi.fn((_req, _res) => {}),
        notAMethod: vi.fn()
      };

      const handlers = extractHandlers(module);

      expect(handlers.size).toBe(3);
      expect(handlers.has("get")).toBe(true);
      expect(handlers.has("post")).toBe(true);
      expect(handlers.has("put")).toBe(true);
      expect(handlers.has("notAMethod")).toBe(false);
    });

    it("should handle case-insensitive method names", () => {
      const module = {
        get: vi.fn((_req, _res) => {}),
        Post: vi.fn((_req, _res) => {}),
        DELETE: vi.fn((_req, _res) => {})
      };

      const handlers = extractHandlers(module);

      expect(handlers.size).toBe(3);
      expect(handlers.has("get")).toBe(true);
      expect(handlers.has("post")).toBe(true);
      expect(handlers.has("delete")).toBe(true);
    });

    it("should normalize 'del' to 'delete'", () => {
      const module = {
        del: vi.fn((_req, _res) => {})
      };

      const handlers = extractHandlers(module);

      expect(handlers.size).toBe(1);
      expect(handlers.has("delete")).toBe(true);
      expect(handlers.has("del")).toBe(false);
    });

    it("should handle array of handlers", () => {
      const handler1 = vi.fn((_req, _res, next) => next());
      const handler2 = vi.fn((_req, res) => res.send("ok"));

      const module = {
        GET: [handler1, handler2]
      };

      const handlers = extractHandlers(module);

      expect(handlers.size).toBe(1);
      const getHandler = handlers.get("get");
      expect(Array.isArray(getHandler)).toBe(true);
      expect(getHandler).toHaveLength(2);
    });

    it("should throw on duplicate method exports with different casing", () => {
      const module = {
        get: vi.fn((_req, _res) => {}),
        GET: vi.fn((_req, _res) => {})
      };

      expect(() => extractHandlers(module)).toThrow("Duplicate method export found: GET");
    });

    it("should throw on invalid handler (not a function)", () => {
      const module = {
        GET: "not a function"
      };

      expect(() => extractHandlers(module)).toThrow("Invalid handler for method GET");
    });

    it("should throw on invalid handler (function with wrong arity)", () => {
      const module = {
        GET: vi.fn(() => {})
      };

      expect(() => extractHandlers(module)).toThrow("Invalid handler for method GET");
    });

    it("should throw on empty array of handlers", () => {
      const module = {
        GET: []
      };

      expect(() => extractHandlers(module)).toThrow("Invalid handler for method GET");
    });

    it("should accept handlers with 2, 3, or 4 parameters", () => {
      const module = {
        GET: vi.fn((_req, _res) => {}),
        POST: vi.fn((_req, _res, _next) => {}),
        PUT: vi.fn((_err, _req, _res, _next) => {})
      };

      const handlers = extractHandlers(module);

      expect(handlers.size).toBe(3);
    });

    it("should handle 'all' method", () => {
      const module = {
        all: vi.fn((_req, _res) => {})
      };

      const handlers = extractHandlers(module);

      expect(handlers.size).toBe(1);
      expect(handlers.has("all")).toBe(true);
    });
  });

  describe("normalizeHandlers", () => {
    it("should wrap single handler in array", () => {
      const handler: RequestHandler = vi.fn((_req, _res) => {});

      const normalized = normalizeHandlers(handler);

      expect(Array.isArray(normalized)).toBe(true);
      expect(normalized).toHaveLength(1);
      expect(normalized[0]).toBe(handler);
    });

    it("should return array of handlers as-is", () => {
      const handler1: RequestHandler = vi.fn((_req, _res) => {});
      const handler2: RequestHandler = vi.fn((_req, _res) => {});
      const handlers = [handler1, handler2];

      const normalized = normalizeHandlers(handlers);

      expect(normalized).toBe(handlers);
      expect(normalized).toHaveLength(2);
    });
  });
});
