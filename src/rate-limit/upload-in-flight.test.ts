import { EventEmitter } from "node:events";
import { TooManyRequestsError } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { uploadInFlightCap } from "./upload-in-flight.js";

describe("rate-limit/upload-in-flight", () => {
  it("should admit uploads up to the cap while they are in flight", () => {
    const cap = uploadInFlightCap(2);

    const results = [run(cap, response()), run(cap, response())];

    expect(results).toEqual([undefined, undefined]);
  });

  it("should refuse beyond the cap with a five-second wait", () => {
    const cap = uploadInFlightCap(1);
    run(cap, response());

    const refused = run(cap, response());

    expect(refused).toBeInstanceOf(TooManyRequestsError);
    expect((refused as TooManyRequestsError).retryAfterSeconds).toBe(5);
  });

  it("should release the slot when the response finishes", () => {
    const cap = uploadInFlightCap(1);
    const first = response();
    run(cap, first);

    first.emit("finish");

    expect(run(cap, response())).toBeUndefined();
  });

  it("should release the slot when the connection closes before the response finishes", () => {
    const cap = uploadInFlightCap(1);
    const aborted = response();
    run(cap, aborted);

    aborted.emit("close");

    expect(run(cap, response())).toBeUndefined();
  });

  it("should release once when both finish and close fire, so one upload cannot free two slots", () => {
    const cap = uploadInFlightCap(2);
    const first = response();
    run(cap, first);
    run(cap, response());

    first.emit("finish");
    first.emit("close");
    run(cap, response());

    expect(run(cap, response())).toBeInstanceOf(TooManyRequestsError);
  });

  it("should not hold a slot for a refused upload", () => {
    const cap = uploadInFlightCap(1);
    const first = response();
    run(cap, first);
    const refused = response();
    run(cap, refused);

    refused.emit("close");

    expect(run(cap, response())).toBeInstanceOf(TooManyRequestsError);
  });
});

function response(): Response & EventEmitter {
  return new EventEmitter() as Response & EventEmitter;
}

/** Runs the middleware and answers what it passed to `next`: undefined to continue, or the error it raised. */
function run(handler: ReturnType<typeof uploadInFlightCap>, res: Response): unknown {
  let passed: unknown = "not called";
  handler({} as Request, res, ((error?: unknown) => {
    passed = error;
  }) as NextFunction);
  return passed;
}
