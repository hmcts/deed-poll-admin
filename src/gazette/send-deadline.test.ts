import type { Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gazetteSendTimeLeft } from "./send-deadline.js";

const NOW = 1_760_000_000_000;

describe("gazetteSendTimeLeft", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it.each([undefined, "1760000000000", Number.NaN])("should count the full budget when the arrival time is %s", (receivedAt) => {
    expect(gazetteSendTimeLeft(arrivedAt(receivedAt))).toBe(25_000);
  });

  it("should not grant more than the budget for an arrival time in the future", () => {
    expect(gazetteSendTimeLeft(arrivedAt(NOW + 10_000))).toBe(25_000);
  });
});

function arrivedAt(receivedAt: unknown): Response {
  return { locals: { receivedAt } } as unknown as Response;
}
