import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./summary.js";

vi.mock("@hmcts/onboarding", () => ({
  getAllSessionData: vi.fn(),
  isSessionComplete: vi.fn(),
  clearOnboardingSession: vi.fn(),
  submitOnboarding: vi.fn(),
  formatDateForDisplay: vi.fn(),
  formatAddressForDisplay: vi.fn(),
  formatRoleForDisplay: vi.fn(),
  getPreviousPage: vi.fn(),
  getChangePageRoute: vi.fn()
}));

import {
  clearOnboardingSession,
  formatAddressForDisplay,
  formatDateForDisplay,
  formatRoleForDisplay,
  getAllSessionData,
  getChangePageRoute,
  getPreviousPage,
  isSessionComplete,
  submitOnboarding
} from "@hmcts/onboarding";

const mockRequest = (overrides = {}) =>
  ({
    session: {},
    ...overrides
  }) as Request;

const mockResponse = () => {
  const res = {} as Response;
  res.render = vi.fn();
  res.redirect = vi.fn();
  res.status = vi.fn().mockReturnThis();
  return res;
};

describe("Summary page controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(formatDateForDisplay).mockReturnValue("1 January 1990");
    vi.mocked(formatAddressForDisplay).mockReturnValue(["123 Test Street", "London", "SW1A 1AA"]);
    vi.mocked(formatRoleForDisplay).mockReturnValue("Frontend Developer");
    vi.mocked(getPreviousPage).mockReturnValue("/onboarding/role");
    vi.mocked(getChangePageRoute).mockImplementation((page) => `/onboarding/${page}`);
  });

  describe("GET", () => {
    it("should redirect to start if session is incomplete", async () => {
      vi.mocked(isSessionComplete).mockReturnValue(false);
      const req = mockRequest();
      const res = mockResponse();

      await GET(req, res);

      expect(res.redirect).toHaveBeenCalledWith("/onboarding/start");
    });

    it("should render summary page with missing optional session data", async () => {
      vi.mocked(isSessionComplete).mockReturnValue(true);
      vi.mocked(getAllSessionData).mockReturnValue({
        name: { firstName: "John", lastName: "Doe" },
        dateOfBirth: undefined,
        address: undefined,
        role: undefined
      });

      const req = mockRequest();
      const res = mockResponse();

      await GET(req, res);

      expect(res.render).toHaveBeenCalledWith(
        "summary",
        expect.objectContaining({
          summaryData: expect.objectContaining({
            dateOfBirth: "",
            address: [],
            role: ""
          })
        })
      );
    });

    it("should render summary page with complete session data", async () => {
      vi.mocked(isSessionComplete).mockReturnValue(true);
      vi.mocked(getAllSessionData).mockReturnValue({
        name: { firstName: "John", lastName: "Doe" },
        dateOfBirth: { day: 1, month: 1, year: 1990 },
        address: { addressLine1: "123 Test Street", town: "London", postcode: "SW1A 1AA" },
        role: { roleType: "frontend-developer" }
      });

      const req = mockRequest();
      const res = mockResponse();

      await GET(req, res);

      expect(res.render).toHaveBeenCalledWith("summary", {
        summaryData: {
          name: "John Doe",
          dateOfBirth: "1 January 1990",
          address: ["123 Test Street", "London", "SW1A 1AA"],
          role: "Frontend Developer"
        },
        changeLinks: {
          name: "/onboarding/name?return=summary",
          dateOfBirth: "/onboarding/dateOfBirth?return=summary",
          address: "/onboarding/address?return=summary",
          role: "/onboarding/role?return=summary"
        },
        backLink: "/onboarding/role",
        en: expect.any(Object),
        cy: expect.any(Object)
      });
    });
  });

  describe("POST", () => {
    it("should redirect to start if session is incomplete", async () => {
      vi.mocked(isSessionComplete).mockReturnValue(false);
      const req = mockRequest();
      const res = mockResponse();

      await POST(req, res);

      expect(res.redirect).toHaveBeenCalledWith("/onboarding/start");
    });

    it("should submit onboarding and redirect to confirmation on success", async () => {
      vi.mocked(isSessionComplete).mockReturnValue(true);
      vi.mocked(submitOnboarding).mockResolvedValue("test-confirmation-id");

      const req = mockRequest();
      const res = mockResponse();

      await POST(req, res);

      expect(submitOnboarding).toHaveBeenCalledWith(req.session);
      expect(clearOnboardingSession).toHaveBeenCalledWith(req.session);
      expect(res.redirect).toHaveBeenCalledWith("/onboarding/confirmation/test-confirmation-id");
    });

    it("should handle submission errors", async () => {
      vi.mocked(isSessionComplete).mockReturnValue(true);
      vi.mocked(submitOnboarding).mockRejectedValue(new Error("Database error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const req = mockRequest();
      const res = mockResponse();

      await POST(req, res);

      expect(consoleSpy).toHaveBeenCalledWith("Error submitting onboarding:", expect.any(Error));
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.render).toHaveBeenCalledWith("errors/500");

      consoleSpy.mockRestore();
    });
  });
});
