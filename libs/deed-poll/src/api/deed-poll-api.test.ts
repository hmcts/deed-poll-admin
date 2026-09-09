/**
 * The readiness probe, against a real socket rather than a stubbed `fetch`.
 *
 * What is worth testing here is exactly what a stub would define away: that an api which refuses the
 * connection and an api which accepts it and then never answers both settle as DOWN. The second is the
 * one that matters — it is the shape of failure that hung `/health/readiness` for a whole outage when
 * the check was Postgres, and the reason the old `health.ts` needed the `guarded` machinery this
 * replaced.
 */
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deedPollApiStatus } from "./deed-poll-api.js";

/** An unreferenced timer's worth of slack over the probe's own 2s bound. */
const PROBE_TEST_TIMEOUT_MS = 10_000;

let server: Server | undefined;
const previousUrl = process.env.DEED_POLL_API_URL;
const previousTimeout = process.env.DEED_POLL_API_TIMEOUT_MS;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close(server);
  server = undefined;
  restore("DEED_POLL_API_URL", previousUrl);
  restore("DEED_POLL_API_TIMEOUT_MS", previousTimeout);
});

describe("deedPollApiStatus", () => {
  it("reports UP when api answers its health endpoint", async () => {
    await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "UP" }));
    });

    expect(await deedPollApiStatus()).toBe("UP");
  });

  it("probes the liveness group rather than the aggregate health, and presents no bearer token", async () => {
    // A probe has no session to read a token from, so a check that needed one could only ever be DOWN.
    // The path is pinned because the ungrouped `/health` aggregates api's `db` and `deedPollSchema`
    // contributors: probing it would let a blip in api's database drop every web pod out of its Service.
    const seen: { url?: string; authorization?: string }[] = [];
    await serve((request, response) => {
      seen.push({ url: request.url, authorization: request.headers.authorization });
      response.writeHead(200).end("{}");
    });

    await deedPollApiStatus();

    expect(seen).toEqual([{ url: "/health/liveness", authorization: undefined }]);
  });

  it("reports DOWN when api answers that it is unhealthy", async () => {
    await serve((_request, response) => {
      response.writeHead(503).end("{}");
    });

    expect(await deedPollApiStatus()).toBe("DOWN");
  });

  it("reports DOWN when api refuses the connection", async () => {
    // A port that was listening and is not any more, so this is a refusal rather than a blackhole.
    await serve((_request, response) => response.end("{}"));
    const url = process.env.DEED_POLL_API_URL;
    await close(server);
    server = undefined;
    process.env.DEED_POLL_API_URL = url;

    expect(await deedPollApiStatus()).toBe("DOWN");
  });

  it(
    "reports DOWN when api accepts the connection and never answers",
    async () => {
      // The failure the probe exists to bound. Nothing here can cancel the request, but the client's
      // `AbortSignal.timeout` settles it — which is why this check needs no shared-attempt machinery.
      await serve(() => {});

      expect(await deedPollApiStatus()).toBe("DOWN");
    },
    PROBE_TEST_TIMEOUT_MS
  );

  it(
    "bounds the probe on its own terms rather than inheriting the application timeout",
    async () => {
      // `runChecks` in the healthcheck middleware is a bare `Promise.all`, so a probe that waited the
      // application's patience out would report nothing at all and take the Redis result with it.
      process.env.DEED_POLL_API_TIMEOUT_MS = "60000";
      await serve(() => {});

      expect(await deedPollApiStatus()).toBe("DOWN");
    },
    PROBE_TEST_TIMEOUT_MS
  );

  it("names the classification in the log, because UP/DOWN loses it", async () => {
    // Being paged for "readiness DOWN" with no further detail is most of the diagnosis wasted.
    await serve((_request, response) => {
      response.writeHead(503).end("{}");
    });

    await deedPollApiStatus();

    expect(vi.mocked(console.error).mock.calls[0][0]).toContain("unavailable");
  });
});

/** Start a server on an ephemeral port and point the adapter at it. */
async function serve(handler: Parameters<typeof createServer>[1]): Promise<void> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the test server did not bind a port");
  process.env.DEED_POLL_API_URL = `http://127.0.0.1:${address.port}`;
}

/** Closes sockets as well as the listener: a request the handler never answered holds one open. */
async function close(target: Server | undefined): Promise<void> {
  if (target === undefined) return;

  target.closeAllConnections();
  await new Promise<void>((resolve) => target.close(() => resolve()));
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
