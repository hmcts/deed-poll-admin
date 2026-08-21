import type { NextFunction, Request, Response } from "express";
import { MonitoringService } from "./monitoring-service.js";

export function monitoringMiddleware(config: MonitoringMiddlewareConfig): (req: Request, res: Response, next: NextFunction) => void {
  const { serviceName, connectionString, enabled = true } = config;

  if (!enabled) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const monitoringService = new MonitoringService(connectionString, serviceName);

  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - startTime;

      if (monitoringService) {
        monitoringService.trackRequest({
          name: `${req.method} ${req.route?.path || req.path}`,
          url: req.url,
          duration,
          resultCode: res.statusCode,
          success: res.statusCode < 400,
          properties: {
            method: req.method,
            path: req.path,
            userAgent: req.headers["user-agent"]
          }
        });
      }
    });

    res.on("error", (err) => {
      if (monitoringService) {
        monitoringService.trackException(err);
      }
    });

    next();
  };
}

export type MonitoringMiddlewareConfig = {
  serviceName: string;
  connectionString: string;
  enabled?: boolean;
};
