import type { Request, Response } from "express";
import type { Session } from "express-session";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { GET, POST } from "./date-of-birth.js";

vi.mock("@hmcts/onboarding", () => ({
  processDateOfBirthSubmission: vi.fn(),
  getSessionDataForPage: vi.fn(),
  formatZodErrors: vi.fn(),
  createErrorSummary: vi.fn(),
  getPreviousPage: vi.fn(() => "/onboarding/name")
}));

import { createErrorSummary, formatZodErrors, getSessionDataForPage, processDateOfBirthSubmission } from "@hmcts/onboarding";

describe("date-of-birth page", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockReq = {
      session: {} as Session,
      body: {},
      query: {}
    };
    mockRes = {
      render: vi.fn(),
      redirect: vi.fn()
    };
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should render the date of birth page", async () => {
      vi.mocked(getSessionDataForPage).mockReturnValue(undefined);
      await GET(mockReq as Request, mockRes as Response);

      expect(mockRes.render).toHaveBeenCalledWith("date-of-birth", {
        data: undefined,
        backLink: "/onboarding/name",
        en: expect.objectContaining({
          title: "What is your date of birth?",
          heading: "What is your date of birth?"
        }),
        cy: expect.objectContaining({
          title: "Beth yw eich dyddiad geni?",
          heading: "Beth yw eich dyddiad geni?"
        })
      });
    });
  });

  describe("POST", () => {
    it("should save valid date of birth and redirect to next step", async () => {
      mockReq.body = {
        dobDay: "15",
        dobMonth: "6",
        dobYear: "1990"
      };

      await POST(mockReq as Request, mockRes as Response);

      expect(processDateOfBirthSubmission).toHaveBeenCalledWith(mockReq.session, mockReq.body);
      expect(mockRes.redirect).toHaveBeenCalledWith("/onboarding/address");
    });

    it("should redirect to summary when return=summary query param is set", async () => {
      mockReq.query = { return: "summary" };

      await POST(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith("/onboarding/summary");
    });

    it("should rethrow non-Zod errors", async () => {
      const unexpectedError = new Error("Unexpected error");
      vi.mocked(processDateOfBirthSubmission).mockImplementation(() => {
        throw unexpectedError;
      });

      await expect(POST(mockReq as Request, mockRes as Response)).rejects.toThrow("Unexpected error");
    });

    it("should render errors for invalid date", async () => {
      mockReq.body = {
        dobDay: "32",
        dobMonth: "13",
        dobYear: "2030"
      };

      const mockZodError = new ZodError([
        {
          code: "custom",
          message: "Date of birth must be a real date",
          path: ["dateOfBirth"]
        }
      ]);

      const errors = {
        dateOfBirth: { field: "dateOfBirth", text: "Date of birth must be a real date", href: "#dobDay" }
      };

      const errorSummary = {
        titleText: "There is a problem",
        errorList: [{ field: "dateOfBirth", text: "Date of birth must be a real date", href: "#dobDay" }]
      };

      vi.mocked(processDateOfBirthSubmission).mockImplementation(() => {
        throw mockZodError;
      });
      vi.mocked(formatZodErrors).mockReturnValue(errors);
      vi.mocked(createErrorSummary).mockReturnValue(errorSummary);

      await POST(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).not.toHaveBeenCalled();
      expect(mockRes.render).toHaveBeenCalledWith("date-of-birth", {
        errors,
        errorSummary,
        data: mockReq.body,
        backLink: "/onboarding/name",
        en: expect.anything(),
        cy: expect.anything()
      });
    });

    it("should render errors for empty date fields", async () => {
      mockReq.body = {
        dobDay: "",
        dobMonth: "",
        dobYear: ""
      };

      const mockZodError = new ZodError([
        {
          code: "custom",
          message: "Enter your date of birth",
          path: ["dateOfBirth"]
        }
      ]);

      const errors = {
        dateOfBirth: { field: "dateOfBirth", text: "Enter your date of birth", href: "#dobDay" }
      };

      const errorSummary = {
        titleText: "There is a problem",
        errorList: [{ field: "dateOfBirth", text: "Enter your date of birth", href: "#dobDay" }]
      };

      vi.mocked(processDateOfBirthSubmission).mockImplementation(() => {
        throw mockZodError;
      });
      vi.mocked(formatZodErrors).mockReturnValue(errors);
      vi.mocked(createErrorSummary).mockReturnValue(errorSummary);

      await POST(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).not.toHaveBeenCalled();
      expect(mockRes.render).toHaveBeenCalledWith("date-of-birth", {
        errors,
        errorSummary,
        data: mockReq.body,
        backLink: "/onboarding/name",
        en: expect.anything(),
        cy: expect.anything()
      });
    });
  });
});
