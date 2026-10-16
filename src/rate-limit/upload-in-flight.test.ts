import { EventEmitter, once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TooManyRequestsError } from "@hmcts/deed-poll";
import express, { type NextFunction, type Request, type Response } from "express";
import { describe, expect, it } from "vitest";
import { uploadInFlightCap } from "./upload-in-flight.js";

describe("rate-limit/upload-in-flight", () => {
  it("should not leak a slot when a real client disconnects while earlier middleware is still waiting", async () => {
    // The shape the external review reproduced: an async step (a token refresh) ahead of the cap, and a client that
    // goes away during it, so `close` has fired before the cap runs.
    let releaseEarlierStep: () => void = () => {};
    const earlierStep = new Promise<void>((resolve) => {
      releaseEarlierStep = resolve;
    });
    const reachedEarlierStep = new EventEmitter();
    const app = express();
    app.post(
      "/upload",
      async (_req: Request, _res: Response, next: NextFunction) => {
        reachedEarlierStep.emit("arrived");
        await earlierStep;
        next();
      },
      uploadInFlightCap(1),
      (_req: Request, res: Response) => {
        res.status(204).end();
      }
    );
    const server: Server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    try {
      const arrived = once(reachedEarlierStep, "arrived");
      const abandoned = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/upload" });
      abandoned.on("error", () => {});
      abandoned.end();
      await arrived;
      abandoned.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseEarlierStep();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const status = await new Promise<number | undefined>((resolve, reject) => {
        const next = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/upload" }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        next.on("error", reject);
        next.end();
      });

      expect(status).toBe(204);
    } finally {
      server.close();
    }
  });

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

  it("should not hold a slot for a response already destroyed when the cap is reached", () => {
    const cap = uploadInFlightCap(1);
    const gone = Object.assign(response(), { destroyed: true });
    run(cap, gone);

    expect(run(cap, response())).toBeUndefined();
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
