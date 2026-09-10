import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./terms-and-conditions.js";

describe("terms-and-conditions page", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = {};
    res = {
      render: vi.fn()
    };
  });

  describe("GET", () => {
    it("should render terms-and-conditions template", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).toHaveBeenCalledWith(
        "terms-and-conditions",
        expect.objectContaining({
          en: expect.objectContaining({
            title: "Terms and conditions"
          }),
          cy: expect.objectContaining({
            title: "Telerau ac amodau"
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
