import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./accessibility-statement.js";

describe("accessibility-statement page", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    req = {};
    res = {
      render: vi.fn()
    };
  });

  describe("GET", () => {
    it("should render accessibility-statement template", async () => {
      await GET(req as Request, res as Response);

      expect(res.render).toHaveBeenCalledWith(
        "accessibility-statement",
        expect.objectContaining({
          en: expect.objectContaining({
            title: "Accessibility statement"
          }),
          cy: expect.objectContaining({
            title: "Datganiad hygyrchedd"
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
