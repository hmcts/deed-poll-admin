import express, { type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { recordArrival } from "../request-arrival.js";
import { gazetteSendTimeLeft } from "./send-deadline.js";

const NOW = 100_000;

describe("gazetteSendTimeLeft", () => {
  let clock: MockInstance<() => number>;

  beforeEach(() => {
    clock = vi.spyOn(performance, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { spent: 0, left: 25_000 },
    { spent: 12_000, left: 13_000 },
    { spent: 20_000, left: 5_000 }
  ])("should leave $left ms of the 25 s budget when $spent ms have already been spent", ({ spent, left }) => {
    expect(gazetteSendTimeLeft(arrivedAt(NOW - spent))).toBe(left);
  });

  it.each([20_001, 25_000, 60_000])("should answer null, so nothing is sent, when %i ms have already been spent", (spent) => {
    expect(gazetteSendTimeLeft(arrivedAt(NOW - spent))).toBeNull();
  });

  it("should throw rather than grant the whole budget when no arrival time was recorded", () => {
    expect(() => gazetteSendTimeLeft(arrivedAt(undefined))).toThrow("mount recordArrival first");
  });

  it("should round down to whole milliseconds, because AbortSignal.timeout refuses a fraction", () => {
    expect(gazetteSendTimeLeft(arrivedAt(NOW - 12_000.4))).toBe(12_999);
  });

  it("should not grant more time when the wall clock is stepped back during the request", () => {
    vi.useFakeTimers({ now: 1_760_000_000_000, toFake: ["Date"] });
    const res = arrivedAt(NOW - 12_000);

    vi.setSystemTime(1_760_000_000_000 - 60_000);

    expect(gazetteSendTimeLeft(res)).toBe(13_000);
  });

  it("should count from the time recordArrival recorded, not from when the handler ran", async () => {
    const app = express();
    app.use(recordArrival());
    app.use((_req, _res, next) => {
      clock.mockReturnValue(NOW + 12_000);
      next();
    });
    app.get("/deadline", (_req, res) => {
      const first = gazetteSendTimeLeft(res);
      clock.mockReturnValue(NOW + 21_000);
      res.json({ first, late: gazetteSendTimeLeft(res) });
    });

    const answer = await request(app).get("/deadline");

    expect(answer.body).toEqual({ first: 13_000, late: null });
  });
});

function arrivedAt(receivedAt: unknown): Response {
  return { locals: { receivedAt } } as unknown as Response;
}
