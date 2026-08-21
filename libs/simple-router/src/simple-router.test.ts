import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSimpleRouter } from "./simple-router.js";

describe("simple-router", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-router-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("createSimpleRouter", () => {
    it("should throw if no mount specs provided", async () => {
      await expect(() => createSimpleRouter()).rejects.toThrow("At least one mount specification is required");
    });

    it("should return an Express router", async () => {
      const router = await createSimpleRouter({ path: testDir });

      expect(router).toBeDefined();
      expect(typeof router).toBe("function");
      expect(router.stack).toBeDefined();
    });

    it("should mount simple GET route", async () => {
      const routeContent = `
export const GET = (req, res) => res.send('Hello World');
`;
      writeFileSync(join(testDir, "index.ts"), routeContent);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir }));

      const response = await request(app).get("/");

      expect(response.status).toBe(200);
      expect(response.text).toBe("Hello World");
    });

    it("should handle multiple HTTP methods", async () => {
      const routeContent = `
export const GET = (req, res) => res.send('GET response');
export const POST = (req, res) => res.send('POST response');
export const PUT = (req, res) => res.send('PUT response');
`;
      writeFileSync(join(testDir, "index.ts"), routeContent);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir }));

      const getResponse = await request(app).get("/");
      const postResponse = await request(app).post("/");
      const putResponse = await request(app).put("/");

      expect(getResponse.text).toBe("GET response");
      expect(postResponse.text).toBe("POST response");
      expect(putResponse.text).toBe("PUT response");
    });

    it("should handle nested routes", async () => {
      mkdirSync(join(testDir, "about"), { recursive: true });
      mkdirSync(join(testDir, "posts"), { recursive: true });

      writeFileSync(join(testDir, "index.ts"), `export const GET = (req, res) => res.send('Home');`);
      writeFileSync(join(testDir, "about", "index.ts"), `export const GET = (req, res) => res.send('About');`);
      writeFileSync(join(testDir, "posts", "index.ts"), `export const GET = (req, res) => res.send('Posts');`);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir }));

      const homeResponse = await request(app).get("/");
      const aboutResponse = await request(app).get("/about");
      const postsResponse = await request(app).get("/posts");

      expect(homeResponse.text).toBe("Home");
      expect(aboutResponse.text).toBe("About");
      expect(postsResponse.text).toBe("Posts");
    });

    it("should handle dynamic routes", async () => {
      mkdirSync(join(testDir, "posts", "[id]"), { recursive: true });

      writeFileSync(join(testDir, "posts", "[id]", "index.ts"), `export const GET = (req, res) => res.send('Post: ' + req.params.id);`);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir }));

      const response = await request(app).get("/posts/123");

      expect(response.text).toBe("Post: 123");
    });

    it("should apply prefix to routes", async () => {
      writeFileSync(join(testDir, "index.ts"), `export const GET = (req, res) => res.send('Admin Home');`);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir, prefix: "/admin" }));

      const response = await request(app).get("/admin");

      expect(response.text).toBe("Admin Home");
    });

    it("should handle multiple mount points", async () => {
      const pagesDir = join(testDir, "pages");
      const adminDir = join(testDir, "admin");

      mkdirSync(pagesDir, { recursive: true });
      mkdirSync(adminDir, { recursive: true });

      writeFileSync(join(pagesDir, "index.ts"), `export const GET = (req, res) => res.send('Main');`);
      writeFileSync(join(adminDir, "index.ts"), `export const GET = (req, res) => res.send('Admin');`);

      const app = express();
      app.use(await createSimpleRouter({ path: pagesDir }, { path: adminDir, prefix: "/admin" }));

      const mainResponse = await request(app).get("/");
      const adminResponse = await request(app).get("/admin");

      expect(mainResponse.text).toBe("Main");
      expect(adminResponse.text).toBe("Admin");
    });

    it("should handle array of middleware", async () => {
      const routeContent = `
const middleware1 = (req, res, next) => {
  req.data = 'Hello';
  next();
};

const middleware2 = (req, res, next) => {
  req.data += ' World';
  next();
};

const handler = (req, res) => res.send(req.data);

export const GET = [middleware1, middleware2, handler];
`;
      writeFileSync(join(testDir, "index.ts"), routeContent);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir }));

      const response = await request(app).get("/");

      expect(response.text).toBe("Hello World");
    });

    it("should handle case-insensitive method exports", async () => {
      const routeContent = `
export const get = (req, res) => res.send('lowercase get');
export const Post = (req, res) => res.send('mixed case post');
`;
      writeFileSync(join(testDir, "index.ts"), routeContent);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir }));

      const getResponse = await request(app).get("/");
      const postResponse = await request(app).post("/");

      expect(getResponse.text).toBe("lowercase get");
      expect(postResponse.text).toBe("mixed case post");
    });

    it("should strip (group) segments from url", async () => {
      mkdirSync(join(testDir, "(footer)"), { recursive: true });
      writeFileSync(join(testDir, "(footer)", "privacy-policy.ts"), `export const GET = (req, res) => res.send('Privacy');`);

      const app = express();
      app.use(await createSimpleRouter({ path: testDir }));

      const response = await request(app).get("/privacy-policy");
      const groupPath = await request(app).get("/(footer)/privacy-policy");

      expect(response.status).toBe(200);
      expect(response.text).toBe("Privacy");
      expect(groupPath.status).toBe(404);
    });

    it("should normalize prefix correctly", async () => {
      writeFileSync(join(testDir, "index.ts"), `export const GET = (req, res) => res.send('Test');`);

      const variations = [
        { prefix: "api", expected: "/api" },
        { prefix: "/api", expected: "/api" },
        { prefix: "/api/", expected: "/api" },
        { prefix: "", expected: "/" },
        { prefix: "/", expected: "/" }
      ];

      for (const { prefix, expected } of variations) {
        const testApp = express();
        testApp.use(await createSimpleRouter({ path: testDir, prefix }));

        const path = expected === "/" ? "/" : expected;
        const response = await request(testApp).get(path);

        expect(response.status).toBe(200);
      }
    });
  });
});
