import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { HealthCheck } from "./healthcheck.js";

export interface HealthCheckConfig {
  checks?: Record<string, HealthCheck>;
  readinessChecks?: Record<string, HealthCheck>;
  buildInfo?: Record<string, any>;
}

export function configure(config: HealthCheckConfig = {}): RequestHandler {
  const { checks = {}, readinessChecks = checks } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health/liveness" || req.path === "/liveness") {
      return respond(res, await runChecks(checks));
    }

    if (req.path === "/health" || req.path === "/health/readiness" || req.path === "/readiness") {
      return respond(res, await runChecks(readinessChecks));
    }

    next();
  };
}

/**
 * Status first, then the body.
 *
 * This was `res.json(result).status(...)`, which sends the response and *then* sets a status Express
 * has already flushed — so every probe answered 200, including a DOWN one. Kubernetes reads the status
 * code and not the body, so a readiness probe could never take a pod out of service and a liveness
 * probe could never restart one: both failure modes silent, and both invisible to the unit tests below,
 * because a `mockReturnThis()` double accepts the two calls in either order. That is why
 * `healthcheck-middleware.wiring.test.ts` drives a real request.
 */
function respond(res: Response, result: { status: string }) {
  return res.status(result.status === "UP" ? 200 : 503).json(result);
}

const runChecks = async (checks: Record<string, HealthCheck>) => {
  const results: Record<string, string> = {};
  let allUp = true;

  await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        results[name] = await check();
        if (results[name] === "DOWN") allUp = false;
      } catch {
        results[name] = "DOWN";
        allUp = false;
      }
    })
  );

  return { status: allUp ? "UP" : "DOWN", services: results };
};
