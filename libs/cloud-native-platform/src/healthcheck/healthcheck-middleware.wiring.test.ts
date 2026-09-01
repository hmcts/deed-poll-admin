/**
 * The health endpoints over a real request, because the unit tests structurally cannot see the thing
 * that was broken.
 *
 * `healthcheck-middleware.test.ts` asserts `expect(res.status).toHaveBeenCalledWith(503)` against a
 * double whose `status` and `json` both `mockReturnThis()`. That passes whether the code calls
 * `res.status(503).json(body)` or `res.json(body).status(503)` — and only the first works, because
 * Express has already flushed the response by the time the second sets a status. So the middleware
 * answered **200 for a DOWN check** and every unit test agreed it was fine.
 *
 * Kubernetes reads the status code, not the body. A readiness probe that always returns 200 can never
 * take a pod out of service, and a liveness probe that always returns 200 can never restart one: the
 * checks run, the result is reported, and nothing acts on it.
 *
 * Do not delete this file on the grounds that it duplicates the unit tests. It tests what they cannot.
 */
import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { HealthCheck } from "./healthcheck.js";
import { configure } from "./healthcheck-middleware.js";

function app(checks: Record<string, HealthCheck>, readinessChecks?: Record<string, HealthCheck>): Express {
  const built = express();
  built.use(configure({ checks, readinessChecks }));
  return built;
}

const up: HealthCheck = async () => "UP";
const down: HealthCheck = async () => "DOWN";

describe("the health endpoints over a real request", () => {
  describe.each(["/health", "/health/readiness", "/readiness"])("%s", (path) => {
    it("answers 200 when every check passes", async () => {
      const response = await request(app({}, { database: up })).get(path);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "UP", services: { database: "UP" } });
    });

    it("answers 503 when a check fails, so Kubernetes stops routing traffic", async () => {
      const response = await request(app({}, { database: down })).get(path);

      expect(response.status).toBe(503);
      expect(response.body.status).toBe("DOWN");
    });

    it("answers 503 when a check throws", async () => {
      const thrower: HealthCheck = async () => {
        throw new Error("connection refused");
      };

      const response = await request(app({}, { database: thrower })).get(path);

      expect(response.status).toBe(503);
      expect(response.body.services.database).toBe("DOWN");
    });
  });

  describe.each(["/health/liveness", "/liveness"])("%s", (path) => {
    it("answers 200 when every check passes", async () => {
      expect((await request(app({ database: up })).get(path)).status).toBe(200);
    });

    it("answers 503 when a check fails, so Kubernetes restarts the pod", async () => {
      expect((await request(app({ database: down })).get(path)).status).toBe(503);
    });
  });

  it("runs readiness checks on readiness and liveness checks on liveness, not both on both", async () => {
    // The two are separate levers and the difference matters: a failing readiness check should stop
    // traffic, a failing liveness check should restart the process. An app that puts its database on
    // liveness turns a database blip into a rolling restart of every pod.
    const both = app({ liveness: up }, { readiness: down });

    expect((await request(both).get("/health/liveness")).status).toBe(200);
    expect((await request(both).get("/health")).status).toBe(503);
  });

  it("defaults readiness to the liveness checks when none are given separately", async () => {
    const response = await request(app({ database: down })).get("/health");

    expect(response.status).toBe(503);
  });

  it("answers 200 with no checks at all, which is why an empty config is not a safe default", async () => {
    // `apps/api` called `healthcheck()` bare and so reported ready unconditionally. Recorded here
    // because it is the library behaving as designed, not a bug — an app has to supply its own checks.
    expect((await request(app({}, {})).get("/health")).status).toBe(200);
  });

  it("passes other paths through, rather than swallowing the request", async () => {
    const built = express();
    built.use(configure({ checks: { database: down } }));
    built.get("/other", (_req, res) => {
      res.json({ reached: true });
    });

    const response = await request(built).get("/other");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reached: true });
  });
});
