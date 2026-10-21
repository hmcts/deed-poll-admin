import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordArrival } from "./request-arrival.js";

describe("recordArrival", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should record the monotonic time the request arrived on res.locals", () => {
    vi.spyOn(performance, "now").mockReturnValue(4_000);
    const res = { locals: {} } as Response;
    const next: NextFunction = vi.fn();

    recordArrival()({} as Request, res, next);

    expect(res.locals.receivedAt).toBe(4_000);
    expect(next).toHaveBeenCalledOnce();
  });

  it("should keep the arrival time when later middleware spends time before the handler runs", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(4_000);
    const app = express();
    app.use(recordArrival());
    app.use((_req, _res, next) => {
      clock.mockReturnValue(16_000);
      next();
    });
    app.get("/deed-polls/gazette/batch", (_req, res) => {
      res.json({ receivedAt: res.locals.receivedAt, now: performance.now() });
    });

    const answer = await request(app).get("/deed-polls/gazette/batch");

    expect(answer.body).toEqual({ receivedAt: 4_000, now: 16_000 });
  });
});
