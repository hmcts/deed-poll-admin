import { describe, it, expect, beforeEach } from "vitest";
import type { Session } from "express-session";
import { getOnboardingSession, setSessionData, clearOnboardingSession, isSessionComplete, getAllSessionData } from "./session.js";

describe("session helpers", () => {
  let mockSession: Session;

  beforeEach(() => {
    mockSession = {
      id: "test-session",
      cookie: {} as any,
      regenerate: () => mockSession,
      destroy: () => mockSession,
      reload: () => mockSession,
      save: () => mockSession,
      touch: () => mockSession
    } as unknown as Session;
  });

  describe("getOnboardingSession", () => {
    it("should return empty object for new session", () => {
      const data = getOnboardingSession(mockSession);
      expect(data).toEqual({});
    });

    it("should return existing session data", () => {
      (mockSession as any).onboarding = {
        name: { firstName: "John", lastName: "Smith" }
      };

      const data = getOnboardingSession(mockSession);
      expect(data?.name).toEqual({ firstName: "John", lastName: "Smith" });
    });
  });

  describe("setSessionData", () => {
    it("should set session data for specific key", () => {
      const nameData = { firstName: "John", lastName: "Smith" };
      setSessionData(mockSession, "name", nameData);

      const sessionData = (mockSession as any).onboarding;
      expect(sessionData.name).toEqual(nameData);
    });

    it("should create onboarding object if it doesn't exist", () => {
      const nameData = { firstName: "John", lastName: "Smith" };
      setSessionData(mockSession, "name", nameData);

      expect((mockSession as any).onboarding).toBeDefined();
      expect((mockSession as any).onboarding.name).toEqual(nameData);
    });
  });

  describe("clearOnboardingSession", () => {
    it("should remove onboarding data from session", () => {
      (mockSession as any).onboarding = {
        name: { firstName: "John", lastName: "Smith" }
      };

      clearOnboardingSession(mockSession);

      expect((mockSession as any).onboarding).toBeUndefined();
    });
  });

  describe("isSessionComplete", () => {
    it("should return false for empty session", () => {
      expect(isSessionComplete(mockSession)).toBe(false);
    });

    it("should return false for incomplete session", () => {
      (mockSession as any).onboarding = {
        name: { firstName: "John", lastName: "Smith" }
      };

      expect(isSessionComplete(mockSession)).toBe(false);
    });

    it("should return true for complete session", () => {
      (mockSession as any).onboarding = {
        name: { firstName: "John", lastName: "Smith" },
        dateOfBirth: { day: 15, month: 6, year: 1990 },
        address: {
          addressLine1: "123 Main St",
          town: "London",
          postcode: "SW1A 1AA"
        },
        role: { roleType: "frontend-developer" }
      };

      expect(isSessionComplete(mockSession)).toBe(true);
    });
  });

  describe("getAllSessionData", () => {
    it("should return all session data", () => {
      const sessionData = {
        name: { firstName: "John", lastName: "Smith" },
        dateOfBirth: { day: 15, month: 6, year: 1990 },
        address: {
          addressLine1: "123 Main St",
          town: "London",
          postcode: "SW1A 1AA"
        },
        role: { roleType: "frontend-developer" }
      };

      (mockSession as any).onboarding = sessionData;

      const result = getAllSessionData(mockSession);
      expect(result).toEqual(sessionData);
    });
  });
});
