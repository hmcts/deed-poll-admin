import * as appInsights from "applicationinsights";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackException } from "./track-exception.js";

vi.mock("applicationinsights", () => {
  const mockClient = {
    trackException: vi.fn()
  };

  return {
    defaultClient: mockClient
  };
});

describe("trackException", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("when Application Insights is initialized", () => {
    it("should track exception and log error message", () => {
      const error = new Error("Test error");

      trackException(error);

      expect(console.error).toHaveBeenCalledWith("Test error", {
        error
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalledWith({
        exception: error,
        properties: undefined
      });
    });

    it("should track exception with properties", () => {
      const error = new Error("Database connection failed");
      const properties = {
        userId: "user-123",
        area: "database",
        operation: "connect"
      };

      trackException(error, properties);

      expect(console.error).toHaveBeenCalledWith("Database connection failed", {
        error,
        userId: "user-123",
        area: "database",
        operation: "connect"
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalledWith({
        exception: error,
        properties
      });
    });

    it("should track exception with empty properties object", () => {
      const error = new Error("Empty properties test");
      const properties = {};

      trackException(error, properties);

      expect(console.error).toHaveBeenCalledWith("Empty properties test", {
        error
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalledWith({
        exception: error,
        properties
      });
    });

    it("should handle error with special characters in message", () => {
      const error = new Error("Error with 'quotes' and \"double quotes\"");

      trackException(error);

      expect(console.error).toHaveBeenCalledWith("Error with 'quotes' and \"double quotes\"", {
        error
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalled();
    });

    it("should handle error with multiline message", () => {
      const error = new Error("Line 1\nLine 2\nLine 3");

      trackException(error);

      expect(console.error).toHaveBeenCalledWith("Line 1\nLine 2\nLine 3", {
        error
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalled();
    });
  });

  describe("when Application Insights is not initialized", () => {
    beforeEach(() => {
      // Mock defaultClient as null to simulate AI not being initialized
      vi.mocked(appInsights).defaultClient = null as any;
    });

    afterEach(() => {
      // Restore mock client for other tests
      vi.mocked(appInsights).defaultClient = {
        trackException: vi.fn()
      } as any;
    });

    it("should log error message when defaultClient is null", () => {
      const error = new Error("Test error without AI");

      trackException(error);

      expect(console.error).toHaveBeenCalledWith("Application Insights not initialized, cannot track exception:", "Test error without AI", undefined);

      // trackException should not be called when defaultClient is null
      expect(appInsights.defaultClient).toBeNull();
    });

    it("should log error with properties when defaultClient is null", () => {
      const error = new Error("Another error");
      const properties = {
        userId: "user-456",
        context: "testing"
      };

      trackException(error, properties);

      expect(console.error).toHaveBeenCalledWith("Application Insights not initialized, cannot track exception:", "Another error", properties);
    });
  });

  describe("edge cases", () => {
    it("should handle Error with empty message", () => {
      const error = new Error("");

      trackException(error);

      expect(console.error).toHaveBeenCalledWith("", {
        error
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalledWith({
        exception: error,
        properties: undefined
      });
    });

    it("should handle properties with nested objects", () => {
      const error = new Error("Nested properties test");
      const properties = {
        user: {
          id: "user-123",
          name: "Test User"
        },
        metadata: {
          timestamp: new Date().toISOString(),
          version: "1.0.0"
        }
      };

      trackException(error, properties);

      expect(console.error).toHaveBeenCalledWith("Nested properties test", {
        error,
        user: {
          id: "user-123",
          name: "Test User"
        },
        metadata: {
          timestamp: expect.any(String),
          version: "1.0.0"
        }
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalledWith({
        exception: error,
        properties
      });
    });

    it("should handle properties with null values", () => {
      const error = new Error("Null properties test");
      const properties = {
        userId: "user-789",
        optionalField: null,
        anotherField: undefined
      };

      trackException(error, properties);

      expect(console.error).toHaveBeenCalledWith("Null properties test", {
        error,
        userId: "user-789",
        optionalField: null,
        anotherField: undefined
      });

      expect(appInsights.defaultClient.trackException).toHaveBeenCalled();
    });
  });
});
