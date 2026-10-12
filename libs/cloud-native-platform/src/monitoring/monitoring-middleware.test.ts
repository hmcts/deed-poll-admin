import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MonitoringMiddlewareConfig, monitoringMiddleware, startMonitoring } from "./monitoring-middleware.js";
import { MonitoringService } from "./monitoring-service.js";

vi.mock("./monitoring-service.js");

describe("startMonitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should start and return the monitoring service when enabled", () => {
    const service = startMonitoring({ serviceName: "test-service", connectionString: "InstrumentationKey=test", enabled: true });

    expect(MonitoringService).toHaveBeenCalledWith("InstrumentationKey=test", "test-service");
    expect(service).toBe(vi.mocked(MonitoringService).mock.instances[0]);
  });

  it("should start the monitoring service when enabled is not given", () => {
    startMonitoring({ serviceName: "test-service", connectionString: "InstrumentationKey=test" });

    expect(MonitoringService).toHaveBeenCalledTimes(1);
  });

  it("should not start the monitoring service when disabled", () => {
    const service = startMonitoring({ serviceName: "test-service", connectionString: "InstrumentationKey=test", enabled: false });

    expect(MonitoringService).not.toHaveBeenCalled();
    expect(service).toBeUndefined();
  });
});

describe("monitoringMiddleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let config: MonitoringMiddlewareConfig;
  const trackException = vi.fn();
  const trackRequest = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MonitoringService).mockImplementation(function (this: unknown) {
      return { trackException, trackRequest };
    } as never);

    req = { method: "GET", path: "/test", originalUrl: "/test?q=Testperson" };
    res = { statusCode: 200, on: vi.fn() };
    next = vi.fn();
    config = { serviceName: "test-service", connectionString: "InstrumentationKey=test", enabled: true };
  });

  it("should call next function", () => {
    const middleware = monitoringMiddleware(config);

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it("should not initialize monitoring when disabled", () => {
    config.enabled = false;
    const middleware = monitoringMiddleware(config);

    middleware(req as Request, res as Response, next);

    expect(MonitoringService).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("should initialize monitoring service when enabled", () => {
    monitoringMiddleware(config);

    expect(MonitoringService).toHaveBeenCalledWith("InstrumentationKey=test", "test-service");
  });

  it("should not track the request itself, because the SDK already collects it", () => {
    const middleware = monitoringMiddleware(config);

    middleware(req as Request, res as Response, next);

    expect(res.on).not.toHaveBeenCalledWith("finish", expect.any(Function));
    expect(trackRequest).not.toHaveBeenCalled();
  });

  it("should track exception on error event", () => {
    const middleware = monitoringMiddleware(config);
    let errorCallback: ((err: Error) => void) | undefined;
    res.on = vi.fn((event: string, callback: (err: Error) => void) => {
      if (event === "error") errorCallback = callback;
    }) as never;

    middleware(req as Request, res as Response, next);
    const testError = new Error("Test error");
    errorCallback?.(testError);

    expect(trackException).toHaveBeenCalledWith(testError);
  });
});
