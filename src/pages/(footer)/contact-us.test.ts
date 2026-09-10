import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./contact-us.js";

describe("contact-us page", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = {};
    res = {
      render: vi.fn()
    };
  });

  describe("GET", () => {
    it("should render contact-us template", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).toHaveBeenCalledWith(
        "contact-us",
        expect.objectContaining({
          en: expect.objectContaining({
            title: "Contact us"
          }),
          cy: expect.objectContaining({
            title: "Cysylltu â ni"
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
