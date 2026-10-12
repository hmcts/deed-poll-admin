import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { noStore } from "./no-store.js";

function response() {
  return { setHeader: vi.fn() } as unknown as Response & { setHeader: ReturnType<typeof vi.fn> };
}

describe("noStore", () => {
  it("should forbid every cache from storing a signed-in page", () => {
    const res = response();
    const next: NextFunction = vi.fn();

    noStore()({ path: "/deed-polls" } as Request, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).toHaveBeenCalledWith("Pragma", "no-cache");
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(["/cookies", "/login", "/health/readiness", "/assets/main.css"])("should leave public %s cacheable, because it shows no case data", (path) => {
    const res = response();
    const next: NextFunction = vi.fn();

    noStore()({ path } as Request, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("should reach the response a real page sends", async () => {
    const app = express();
    app.use(noStore());
    app.get("/deed-polls/:id", (_req, res) => {
      res.send("case");
    });

    const answer = await request(app).get("/deed-polls/a-case-id");

    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(answer.headers.pragma).toBe("no-cache");
  });
});
