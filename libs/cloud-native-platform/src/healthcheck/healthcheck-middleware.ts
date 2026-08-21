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
      const result = await runChecks(checks);
      return res.json(result).status(result.status === "UP" ? 200 : 503);
    }

    if (req.path === "/health" || req.path === "/health/readiness" || req.path === "/readiness") {
      const result = await runChecks(readinessChecks);
      return res.json(result).status(result.status === "UP" ? 200 : 503);
    }

    next();
  };
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
