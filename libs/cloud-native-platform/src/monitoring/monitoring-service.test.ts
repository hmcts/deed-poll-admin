import appInsights from "applicationinsights";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Logger, MonitoringService } from "./monitoring-service.js";
import { queryRedactingSpanProcessor } from "./query-redacting-span-processor.js";

vi.mock("applicationinsights", () => {
  const mockClient = {
    trackRequest: vi.fn(),
    trackException: vi.fn(),
    trackEvent: vi.fn(),
    trackMetric: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    context: {
      tags: {},
      keys: {
        cloudRole: "cloudRole"
      }
    }
  };

  const mockSetup = {
    setAutoCollectRequests: vi.fn(() => mockSetup),
    setAutoCollectPerformance: vi.fn(() => mockSetup),
    setAutoCollectExceptions: vi.fn(() => mockSetup),
    setAutoCollectDependencies: vi.fn(() => mockSetup),
    setAutoCollectConsole: vi.fn(() => mockSetup),
    setUseDiskRetryCaching: vi.fn(() => mockSetup),
    setAzureMonitorOptions: vi.fn(() => mockSetup),
    start: vi.fn(() => {
      sdk.defaultClient = mockClient;
      return mockSetup;
    })
  };

  // The client exists only once start() has run, as in the real SDK, and is read off the default export: a test that
  // mocked it as a named export would pass while the real namespace import saw nothing.
  const sdk: { defaultClient: typeof mockClient | undefined; setup: () => typeof mockSetup } = {
    defaultClient: undefined,
    setup: vi.fn(() => mockSetup)
  };

  return { default: sdk };
});

describe("MonitoringService", () => {
  let mockLogger: Logger;
  let service: MonitoringService;
  const connectionString = "InstrumentationKey=test";

  beforeEach(() => {
    vi.clearAllMocks();
    (appInsights as { defaultClient: unknown }).defaultClient = undefined;
    mockLogger = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
  });

  describe("constructor", () => {
    it("should register the query-redacting span processor before Application Insights starts", () => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);

      const setupMock = vi.mocked(appInsights.setup)(connectionString);
      expect(setupMock.setAzureMonitorOptions).toHaveBeenCalledWith({ spanProcessors: [queryRedactingSpanProcessor] });
      // Options are read when the client initialises at start(), so a later call would register nothing.
      expect(vi.mocked(setupMock.setAzureMonitorOptions).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(setupMock.start).mock.invocationCallOrder[0]);
    });

    it("should setup Application Insights with correct configuration", () => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);

      expect(appInsights.setup).toHaveBeenCalledWith(connectionString);

      const setupMock = vi.mocked(appInsights.setup)(connectionString);
      expect(setupMock.setAutoCollectRequests).toHaveBeenCalledWith(true);
      expect(setupMock.setAutoCollectPerformance).toHaveBeenCalledWith(true, true);
      expect(setupMock.setAutoCollectExceptions).toHaveBeenCalledWith(true);
      expect(setupMock.setAutoCollectDependencies).toHaveBeenCalledWith(true);
      expect(setupMock.setAutoCollectConsole).toHaveBeenCalledWith(true, true);
      expect(setupMock.setUseDiskRetryCaching).toHaveBeenCalledWith(true);
      expect(setupMock.start).toHaveBeenCalled();
    });

    it("should set the OpenTelemetry service name, which the SDK reports as the cloud role name", () => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);

      expect(process.env.OTEL_SERVICE_NAME).toBe("test-service");
    });

    it("should reuse the running client rather than set the SDK up twice", () => {
      new MonitoringService(connectionString, "test-service", mockLogger);
      vi.mocked(appInsights.setup).mockClear();

      service = new MonitoringService(connectionString, "test-service", mockLogger);
      service.trackEvent("Reused");

      expect(appInsights.setup).not.toHaveBeenCalled();
      expect(appInsights.defaultClient.trackEvent).toHaveBeenCalledWith({ name: "Reused", properties: undefined });
    });

    it("should use console as default logger", () => {
      service = new MonitoringService(connectionString, "test-service");

      expect(appInsights.setup).toHaveBeenCalledWith(connectionString);
    });
  });

  describe("trackRequest", () => {
    beforeEach(() => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);
    });

    it("should track request with correct parameters", () => {
      const options = {
        name: "GET /api/test",
        url: "/api/test",
        duration: 100,
        resultCode: 200,
        success: true,
        properties: {
          userId: "user-123",
          tenantId: "tenant-456"
        }
      };

      service.trackRequest(options);

      expect(appInsights.defaultClient.trackRequest).toHaveBeenCalledWith({
        name: "GET /api/test",
        url: "/api/test",
        duration: 100,
        resultCode: "200",
        success: true,
        properties: {
          userId: "user-123",
          tenantId: "tenant-456"
        }
      });
    });

    it("should convert resultCode to string", () => {
      const options = {
        name: "POST /api/test",
        url: "/api/test",
        duration: 50,
        resultCode: 404,
        success: false
      };

      service.trackRequest(options);

      expect(appInsights.defaultClient.trackRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          resultCode: "404"
        })
      );
    });
  });

  describe("trackException", () => {
    beforeEach(() => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);
    });

    it("should track exception and log error", () => {
      const error = new Error("Test error");
      const properties = { userId: "user-123" };

      service.trackException(error, properties);

      expect(mockLogger.error).toHaveBeenCalledWith("Test error", {
        error,
        userId: "user-123"
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalledWith({
        exception: error,
        properties
      });
    });

    it("should track exception without properties", () => {
      const error = new Error("Another error");

      service.trackException(error);

      expect(mockLogger.error).toHaveBeenCalledWith("Another error", {
        error
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalledWith({
        exception: error,
        properties: undefined
      });
    });
  });

  describe("trackEvent", () => {
    beforeEach(() => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);
    });

    it("should track event and log info", () => {
      const eventName = "UserLogin";
      const properties = { userId: "user-123", method: "oauth" };

      service.trackEvent(eventName, properties);

      expect(mockLogger.info).toHaveBeenCalledWith("Event: UserLogin", properties);

      expect(appInsights.defaultClient.trackEvent).toHaveBeenCalledWith({
        name: eventName,
        properties
      });
    });

    it("should track event without properties", () => {
      const eventName = "PageView";

      service.trackEvent(eventName);

      expect(mockLogger.info).toHaveBeenCalledWith("Event: PageView", undefined);

      expect(appInsights.defaultClient.trackEvent).toHaveBeenCalledWith({
        name: eventName,
        properties: undefined
      });
    });
  });

  describe("trackMetric", () => {
    beforeEach(() => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);
    });

    it("should track metric with properties", () => {
      const metricName = "ResponseTime";
      const value = 150;
      const properties = { endpoint: "/api/users" };

      service.trackMetric(metricName, value, properties);

      expect(appInsights.defaultClient.trackMetric).toHaveBeenCalledWith({
        name: metricName,
        value,
        properties
      });
    });

    it("should track metric without properties", () => {
      const metricName = "ActiveUsers";
      const value = 42;

      service.trackMetric(metricName, value);

      expect(appInsights.defaultClient.trackMetric).toHaveBeenCalledWith({
        name: metricName,
        value,
        properties: undefined
      });
    });
  });

  describe("flush", () => {
    beforeEach(() => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);
    });

    it("should flush and return a promise", async () => {
      const promise = service.flush();

      expect(promise).toBeInstanceOf(Promise);
      await expect(promise).resolves.toBeUndefined();
      expect(appInsights.defaultClient.flush).toHaveBeenCalledTimes(1);
    });

    it("should wait for the telemetry client to finish flushing", async () => {
      const flush = Promise.withResolvers<void>();
      vi.mocked(appInsights.defaultClient.flush).mockReturnValueOnce(flush.promise);
      const completed = vi.fn();

      const result = service.flush().then(completed);
      await Promise.resolve();
      const completedBeforeClient = completed.mock.calls.length;
      flush.resolve();
      await result;

      expect(completedBeforeClient).toBe(0);
      expect(completed).toHaveBeenCalledTimes(1);
      expect(appInsights.defaultClient.flush).toHaveBeenCalledTimes(1);
    });

    it("should propagate the telemetry client's flush rejection", async () => {
      const flush = Promise.withResolvers<void>();
      vi.mocked(appInsights.defaultClient.flush).mockReturnValueOnce(flush.promise);
      const error = new Error("Telemetry flush failed");
      // Observe the SDK rejection too so the source-unchanged regression run cannot leak an unhandled rejection.
      const clientRejection = expect(flush.promise).rejects.toBe(error);
      const serviceRejection = expect(service.flush()).rejects.toBe(error);

      flush.reject(error);

      await Promise.all([clientRejection, serviceRejection]);
      expect(appInsights.defaultClient.flush).toHaveBeenCalledTimes(1);
    });

    it("should resolve when SDK startup leaves no telemetry client", async () => {
      const setupMock = vi.mocked(appInsights.setup)(connectionString);
      const client = appInsights.defaultClient;
      (appInsights as { defaultClient: unknown }).defaultClient = undefined;
      vi.mocked(setupMock.start).mockImplementationOnce(() => setupMock);
      const serviceWithoutClient = new MonitoringService(connectionString, "test-service", mockLogger);

      await expect(serviceWithoutClient.flush()).resolves.toBeUndefined();
      expect(client.flush).not.toHaveBeenCalled();
    });
  });

  describe("Logger interface", () => {
    it("should work with custom logger implementation", () => {
      const customLogger: Logger = {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      service = new MonitoringService(connectionString, "test-service", customLogger);

      const error = new Error("Custom logger test");
      service.trackException(error);

      expect(customLogger.error).toHaveBeenCalledWith("Custom logger test", {
        error
      });
    });
  });
});
