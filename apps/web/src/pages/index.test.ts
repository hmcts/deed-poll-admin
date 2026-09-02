import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./index.js";

describe("service root", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = {};
    res = {
      redirect: vi.fn(),
      render: vi.fn()
    };
  });

  describe("GET", () => {
    it("should redirect to the case list", async () => {
      await GET(req as Request, res as Response);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls");
    });

    // The template's marketing home page rendered here. Asserting it does not render guards against
    // it coming back in a re-scaffold, which is how the file arrived in the first place.
    it("should not render a page of its own", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).not.toHaveBeenCalled();
    });

    it("should redirect exactly once", async () => {
      await GET(req as Request, res as Response);

      expect(res.redirect).toHaveBeenCalledTimes(1);
    });

    it("should not modify request object", async () => {
      const originalReq = { ...req };

      await GET(req as Request, res as Response);

      expect(req).toEqual(originalReq);
    });
  });
});
