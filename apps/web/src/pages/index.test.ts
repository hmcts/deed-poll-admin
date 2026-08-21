import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./index.js";

describe("index page", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = {};
    res = {
      render: vi.fn()
    };
  });

  describe("GET", () => {
    it("should render index template with language-specific content", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).toHaveBeenCalledWith("index", {
        en: expect.objectContaining({
          title: "HMCTS Express Monorepo Template",
          subtitle: "Production-ready Node.js starter with cloud-native capabilities",
          intro:
            "A comprehensive monorepo template that demonstrates best practices for building HMCTS digital services using Express.js, TypeScript, and GOV.UK Design System.",
          cloudNativeTitle: "Cloud Native Platform",
          govukStarterTitle: "GOV.UK Starter",
          architectureTitle: "Monorepo Architecture",
          gettingStartedTitle: "Getting Started",
          learnMoreTitle: "Learn More"
        }),
        cy: expect.objectContaining({
          title: "Templed Monorepo Express HMCTS",
          subtitle: "Dechreuwr Node.js barod i gynhyrchu gyda galluoedd cwmwl-gynhenid",
          cloudNativeTitle: "Platfform Cwmwl Cynhenid",
          govukStarterTitle: "Dechreuwr GOV.UK",
          architectureTitle: "Pensaernïaeth Monorepo",
          gettingStartedTitle: "Dechrau Arni",
          learnMoreTitle: "Dysgu Mwy"
        })
      });
    });

    it("should be an async function", () => {
      expect(GET).toBeInstanceOf(Function);
      expect(GET.constructor.name).toBe("AsyncFunction");
    });

    it("should call render exactly once", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).toHaveBeenCalledTimes(1);
    });

    it("should not modify request object", async () => {
      const originalReq = { ...req };

      await GET(req as Request, res as Response);

      expect(req).toEqual(originalReq);
    });
  });
});
