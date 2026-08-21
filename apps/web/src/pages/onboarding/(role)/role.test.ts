import type { Request, Response } from "express";
import type { Session } from "express-session";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { GET, POST } from "./role.js";

vi.mock("@hmcts/onboarding", () => ({
  processRoleSubmission: vi.fn(),
  getSessionDataForPage: vi.fn(),
  formatZodErrors: vi.fn(),
  createErrorSummary: vi.fn(),
  getPreviousPage: vi.fn(() => "/onboarding/date-of-birth")
}));

import { createErrorSummary, formatZodErrors, getSessionDataForPage, processRoleSubmission } from "@hmcts/onboarding";

describe("role page", () => {
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
    it("should render the role page", async () => {
      vi.mocked(getSessionDataForPage).mockReturnValue(undefined);
      await GET(mockReq as Request, mockRes as Response);

      expect(mockRes.render).toHaveBeenCalledWith(
        "role",
        expect.objectContaining({
          en: expect.objectContaining({
            title: "What is your role?",
            heading: "What is your role?",
            options: expect.objectContaining({
              frontendDeveloper: "Frontend Developer",
              backendDeveloper: "Backend Developer",
              testEngineer: "Test Engineer",
              other: "Other"
            })
          }),
          cy: expect.objectContaining({
            title: "Beth yw eich rôl?",
            heading: "Beth yw eich rôl?"
          })
        })
      );
    });
  });

  describe("POST", () => {
    it("should save valid role and redirect to next step", async () => {
      mockReq.body = {
        role: "frontendDeveloper"
      };

      await POST(mockReq as Request, mockRes as Response);

      expect(processRoleSubmission).toHaveBeenCalledWith(mockReq.session, mockReq.body);
      expect(mockRes.redirect).toHaveBeenCalledWith("/onboarding/summary");
    });

    it("should render errors when no role selected", async () => {
      mockReq.body = {};

      const mockZodError = new ZodError([
        {
          code: "custom",
          message: "Select a role",
          path: ["role"]
        }
      ]);

      const errors = {
        role: { field: "role", text: "Select a role", href: "#role" }
      };

      const errorSummary = {
        titleText: "There is a problem",
        errorList: [{ field: "role", text: "Select a role", href: "#role" }]
      };

      vi.mocked(processRoleSubmission).mockImplementationOnce(() => {
        throw mockZodError;
      });
      vi.mocked(formatZodErrors).mockReturnValue(errors);
      vi.mocked(createErrorSummary).mockReturnValue(errorSummary);

      await POST(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).not.toHaveBeenCalled();
      expect(mockRes.render).toHaveBeenCalledWith("role", {
        errors,
        errorSummary,
        data: mockReq.body,
        backLink: "/onboarding/date-of-birth",
        en: expect.anything(),
        cy: expect.anything()
      });
    });

    it("should rethrow non-Zod errors", async () => {
      const unexpectedError = new Error("Unexpected error");
      vi.mocked(processRoleSubmission).mockImplementationOnce(() => {
        throw unexpectedError;
      });

      await expect(POST(mockReq as Request, mockRes as Response)).rejects.toThrow("Unexpected error");
    });

    it("should handle other role options", async () => {
      mockReq.body = {
        role: "other"
      };

      await POST(mockReq as Request, mockRes as Response);

      expect(processRoleSubmission).toHaveBeenCalledWith(mockReq.session, mockReq.body);
      expect(mockRes.redirect).toHaveBeenCalledWith("/onboarding/summary");
    });
  });
});
