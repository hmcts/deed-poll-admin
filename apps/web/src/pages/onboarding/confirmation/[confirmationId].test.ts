import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./[confirmationId].js";

describe("confirmation page with dynamic route", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockReq = {
      params: {} as Record<string, string>
    };
    mockRes = {
      render: vi.fn(),
      redirect: vi.fn()
    };
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should render confirmation page with reference number from params", async () => {
      mockReq.params = {
        confirmationId: "test-id-123"
      };

      await GET(mockReq as Request, mockRes as Response);

      expect(mockRes.render).toHaveBeenCalledWith(
        "[confirmationId]",
        expect.objectContaining({
          confirmationId: "test-id-123",
          en: expect.objectContaining({
            title: "Onboarding complete",
            heading: "Onboarding complete",
            panelTitle: "Onboarding complete",
            referenceLabel: "Your reference number",
            whatHappensNext: "What happens next"
          }),
          cy: expect.objectContaining({
            title: "Ymgymryd wedi'i gwblhau"
          })
        })
      );
    });

    it("should redirect to start when no confirmation ID in params", async () => {
      mockReq.params = {};

      await GET(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith("/onboarding/start");
      expect(mockRes.render).not.toHaveBeenCalled();
    });

    it("should redirect to start when params is undefined", async () => {
      mockReq.params = undefined;

      await GET(mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith("/onboarding/start");
      expect(mockRes.render).not.toHaveBeenCalled();
    });
  });
});
