import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./start.js";

const mockRequest = () =>
  ({
    session: {}
  }) as Request;

const mockResponse = () => {
  const res = {} as Response;
  res.render = vi.fn();
  return res;
};

describe("Start page controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("should render the start page with locale content", async () => {
      const req = mockRequest();
      const res = mockResponse();

      await GET(req, res);

      expect(res.render).toHaveBeenCalledWith("start", {
        en: expect.objectContaining({
          title: "Onboarding form example",
          heading: "Onboarding form example",
          description: "Use this form to see how we collect information for onboarding.",
          beforeYouStart: "Before you start",
          youWillNeed: "You will need:",
          requirements: ["your personal details (name and date of birth)", "your address", "information about your role"],
          duration: "It takes around 5 minutes to complete.",
          startButton: "Start now"
        }),
        cy: expect.objectContaining({
          title: expect.any(String),
          startButton: "Dechrau nawr"
        })
      });
    });
  });
});
