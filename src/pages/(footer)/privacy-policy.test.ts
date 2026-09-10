import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./privacy-policy.js";

describe("privacy-policy page", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = {};
    res = {
      render: vi.fn()
    };
  });

  describe("GET", () => {
    it("should render privacy-policy template", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).toHaveBeenCalledWith(
        "privacy-policy",
        expect.objectContaining({
          en: expect.objectContaining({
            title: "Privacy policy"
          }),
          cy: expect.objectContaining({
            title: "Polisi preifatrwydd"
          })
        })
      );
    });

    it("should call render exactly once", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).toHaveBeenCalledTimes(1);
    });
  });
});
