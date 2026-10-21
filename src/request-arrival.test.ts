import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordArrival } from "./request-arrival.js";

describe("recordArrival", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should record the time the request arrived on res.locals", () => {
    vi.useFakeTimers({ now: 1_760_000_000_000 });
    const res = { locals: {} } as Response;
    const next: NextFunction = vi.fn();

    recordArrival()({} as Request, res, next);

    expect(res.locals.receivedAt).toBe(1_760_000_000_000);
    expect(next).toHaveBeenCalledOnce();
  });

  it("should keep the arrival time when later middleware spends time before the handler runs", async () => {
    vi.useFakeTimers({ now: 1_760_000_000_000, toFake: ["Date"] });
    const app = express();
    app.use(recordArrival());
    app.use((_req, _res, next) => {
      vi.setSystemTime(1_760_000_012_000);
      next();
    });
    app.get("/deed-polls/gazette/batch", (_req, res) => {
      res.json({ receivedAt: res.locals.receivedAt, now: Date.now() });
    });

    const answer = await request(app).get("/deed-polls/gazette/batch");

    expect(answer.body).toEqual({ receivedAt: 1_760_000_000_000, now: 1_760_000_012_000 });
  });
});
