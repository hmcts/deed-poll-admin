import * as appInsights from "applicationinsights";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Logger, MonitoringService } from "./monitoring-service.js";

vi.mock("applicationinsights", () => {
  const mockClient = {
    trackRequest: vi.fn(),
    trackException: vi.fn(),
    trackEvent: vi.fn(),
    trackMetric: vi.fn(),
    flush: vi.fn(),
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
    start: vi.fn(() => mockSetup)
  };

  return {
    setup: vi.fn(() => mockSetup),
    defaultClient: mockClient
  };
});

describe("MonitoringService", () => {
  let mockLogger: Logger;
  let service: MonitoringService;
  const connectionString = "InstrumentationKey=test";

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
  });

  describe("constructor", () => {
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

    it("should set cloud role name before starting", () => {
      service = new MonitoringService(connectionString, "test-service", mockLogger);

      expect(process.env.APPLICATIONINSIGHTS_ROLE_NAME).toBe("test-service");
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
      expect(appInsights.defaultClient.flush).toHaveBeenCalled();
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
