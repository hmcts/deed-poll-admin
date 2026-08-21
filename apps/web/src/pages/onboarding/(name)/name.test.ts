import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { GET, POST } from "./name.js";

vi.mock("@hmcts/onboarding", () => ({
  processNameSubmission: vi.fn(),
  getSessionDataForPage: vi.fn(),
  formatZodErrors: vi.fn(),
  createErrorSummary: vi.fn(),
  getPreviousPage: vi.fn(() => "/onboarding")
}));

import { createErrorSummary, formatZodErrors, getPreviousPage, getSessionDataForPage, processNameSubmission } from "@hmcts/onboarding";

const mockRequest = (overrides = {}) =>
  ({
    session: {},
    body: {},
    query: {},
    ...overrides
  }) as Request;

const mockResponse = () => {
  const res = {} as Response;
  res.render = vi.fn();
  res.redirect = vi.fn();
  return res;
};

describe("Name page controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionDataForPage).mockReturnValue(undefined);
    vi.mocked(getPreviousPage).mockReturnValue("/onboarding");
  });

  describe("GET", () => {
    it("should render the name page with empty form when no session data", async () => {
      const req = mockRequest();
      const res = mockResponse();

      await GET(req, res);

      expect(res.render).toHaveBeenCalledWith("name", {
        data: undefined,
        backLink: "/onboarding",
        en: expect.objectContaining({
          title: "What is your name?",
          firstNameLabel: "First name",
          lastNameLabel: "Last name",
          back: "Back",
          continue: "Continue"
        }),
        cy: expect.objectContaining({
          title: "Beth yw eich enw?",
          firstNameLabel: "Enw cyntaf"
        })
      });
    });

    it("should render with existing session data", async () => {
      const sessionData = { firstName: "John", lastName: "Doe" };
      vi.mocked(getSessionDataForPage).mockReturnValue(sessionData);

      const req = mockRequest();
      const res = mockResponse();

      await GET(req, res);

      expect(res.render).toHaveBeenCalledWith(
        "name",
        expect.objectContaining({
          data: { firstName: "John", lastName: "Doe" }
        })
      );
    });
  });

  describe("POST", () => {
    it("should validate and save valid form data", async () => {
      const req = mockRequest({
        body: { firstName: "John", lastName: "Doe" }
      });
      const res = mockResponse();

      await POST(req, res);

      expect(processNameSubmission).toHaveBeenCalledWith(req.session, {
        firstName: "John",
        lastName: "Doe"
      });
      expect(res.redirect).toHaveBeenCalledWith("/onboarding/date-of-birth");
    });

    it("should redirect to summary when return=summary query param", async () => {
      const req = mockRequest({
        body: { firstName: "John", lastName: "Doe" },
        query: { return: "summary" }
      });
      const res = mockResponse();

      await POST(req, res);

      expect(res.redirect).toHaveBeenCalledWith("/onboarding/summary");
    });

    it("should handle validation errors and render form with errors", async () => {
      const mockZodError = new ZodError([
        {
          code: "too_small",
          minimum: 1,
          origin: "string",
          inclusive: true,
          exact: false,
          message: "First name is required",
          path: ["firstName"]
        }
      ]);

      const mockErrors = {
        firstName: { field: "firstName", text: "First name is required", href: "#firstName" }
      };

      const mockErrorSummary = {
        titleText: "There is a problem",
        errorList: [{ field: "firstName", text: "First name is required", href: "#firstName" }]
      };

      vi.mocked(processNameSubmission).mockImplementation(() => {
        throw mockZodError;
      });
      vi.mocked(formatZodErrors).mockReturnValue(mockErrors);
      vi.mocked(createErrorSummary).mockReturnValue(mockErrorSummary);

      const req = mockRequest({
        body: { firstName: "", lastName: "Doe" }
      });
      const res = mockResponse();

      await POST(req, res);

      expect(formatZodErrors).toHaveBeenCalledWith(mockZodError);
      expect(createErrorSummary).toHaveBeenCalledWith(mockErrors);
      expect(res.render).toHaveBeenCalledWith(
        "name",
        expect.objectContaining({
          errors: mockErrors,
          errorSummary: mockErrorSummary,
          data: { firstName: "", lastName: "Doe" },
          backLink: "/onboarding"
        })
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should re-throw non-ZodError exceptions", async () => {
      const generalError = new Error("Database connection failed");
      vi.mocked(processNameSubmission).mockImplementation(() => {
        throw generalError;
      });

      const req = mockRequest({
        body: { firstName: "John", lastName: "Doe" }
      });
      const res = mockResponse();

      await expect(POST(req, res)).rejects.toThrow("Database connection failed");
      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
