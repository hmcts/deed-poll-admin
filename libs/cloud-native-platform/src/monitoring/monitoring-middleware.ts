import type { NextFunction, Request, Response } from "express";
import { MonitoringService } from "./monitoring-service.js";

/**
 * Start Application Insights before the app is imported. Request collection only works when the SDK starts before
 * express is loaded, and in an ES module every static import has loaded before the first line of the importer runs,
 * so starting it inside `createApp` collected no requests at all. Call this from the entrypoint, then import the app.
 */
export function startMonitoring(config: MonitoringMiddlewareConfig): void {
  if (config.enabled ?? true) new MonitoringService(config.connectionString, config.serviceName);
}

/**
 * Requests are not tracked here: the SDK collects them itself, with the URL, status and duration. A manual
 * `trackRequest` as well wrote a second row per request, with no URL and a result code of 0 (measured in AAT,
 * 2026-10-12), so every request counted twice and every failure also appeared as a "0".
 */
export function monitoringMiddleware(config: MonitoringMiddlewareConfig): (req: Request, res: Response, next: NextFunction) => void {
  const { serviceName, connectionString, enabled = true } = config;

  if (!enabled) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const monitoringService = new MonitoringService(connectionString, serviceName);

  return (_req: Request, res: Response, next: NextFunction) => {
    res.on("error", (err) => monitoringService.trackException(err));
    next();
  };
}

export type MonitoringMiddlewareConfig = {
  serviceName: string;
  connectionString: string;
  enabled?: boolean;
};
