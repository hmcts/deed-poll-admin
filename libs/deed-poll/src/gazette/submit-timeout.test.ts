/**
 * A Gazette send over real HTTP, end to end through the domain seam (finding R03).
 *
 * api prepares and sends the batch inside the submit request, so an admitted send can take longer than the
 * client's ten-second default and still succeed. These tests drive `sendGazetteSelection` against a local server
 * standing in for api. One waits in real time, because it is the reported case and proves the wiring with no
 * clock trick at all; the rest wrap `AbortSignal.timeout` to run `CLOCK_SCALE` times fast so they stay quick.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GazetteOutcomeUnknownError } from "./errors.js";
import { sendGazetteSelection } from "./service.js";

const CLOCK_SCALE = 100;
const SLOW_SEND_MS = 12_000;
const INPUT = { caseIds: ["00000000-0000-4000-8000-000000000001"], recipientRevision: 1, selectionFingerprint: "opaque" };
const CALLER = { accessToken: "delivery-manager-token" };
const SENT = { batchId: "00000000-0000-4000-8000-000000000009", state: "Sent", caseCount: 1 };

let server: Server | undefined;
let admitted: { key: string; body: string }[];
const originalUrl = process.env.DEED_POLL_API_URL;
const originalTimeout = process.env.DEED_POLL_API_TIMEOUT_MS;

beforeEach(() => {
  admitted = [];
  delete process.env.DEED_POLL_API_TIMEOUT_MS;
});

afterEach(async () => {
  vi.restoreAllMocks();
  restore("DEED_POLL_API_URL", originalUrl);
  restore("DEED_POLL_API_TIMEOUT_MS", originalTimeout);
  if (server === undefined) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

it(
  "should report a send api answers after twelve real seconds as sent, with exactly one admission",
  async () => {
    const key = randomUUID();
    await serve((_req, res) => setTimeout(() => answer(res, 200, SENT), SLOW_SEND_MS));

    const status = await sendGazetteSelection(INPUT, key, CALLER);

    expect(status).toEqual(SENT);
    expect(admitted).toEqual([{ key, body: JSON.stringify(INPUT) }]);
  },
  SLOW_SEND_MS + 8_000
);

describe("on a scaled clock", () => {
  beforeEach(() => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => realTimeout(ms / CLOCK_SCALE));
  });

  it("should report a send api never answers as an unknown outcome, after one admission under the original key", async () => {
    const key = randomUUID();
    await serve(() => {});

    await expect(sendGazetteSelection(INPUT, key, CALLER)).rejects.toBeInstanceOf(GazetteOutcomeUnknownError);
    expect(admitted).toEqual([{ key, body: JSON.stringify(INPUT) }]);
  });

  it("should report a gateway 504 as an unknown outcome, because the gateway's cut-off proves nothing about the send", async () => {
    const key = randomUUID();
    await serve((_req, res) => {
      res.writeHead(504, { "content-type": "text/html" });
      res.end("<html><body>504 Gateway Time-out</body></html>");
    });

    await expect(sendGazetteSelection(INPUT, key, CALLER)).rejects.toBeInstanceOf(GazetteOutcomeUnknownError);
    expect(admitted).toEqual([{ key, body: JSON.stringify(INPUT) }]);
  });

  it("should report a dropped connection as an unknown outcome", async () => {
    await serve((req) => req.socket.destroy());

    await expect(sendGazetteSelection(INPUT, randomUUID(), CALLER)).rejects.toBeInstanceOf(GazetteOutcomeUnknownError);
  });

  it("should let DEED_POLL_API_TIMEOUT_MS cut a send shorter than the submit's own timeout", async () => {
    process.env.DEED_POLL_API_TIMEOUT_MS = "5000";
    await serve((_req, res) => setTimeout(() => answer(res, 200, SENT), SLOW_SEND_MS / CLOCK_SCALE));

    await expect(sendGazetteSelection(INPUT, randomUUID(), CALLER)).rejects.toBeInstanceOf(GazetteOutcomeUnknownError);
    expect(vi.mocked(AbortSignal.timeout)).toHaveBeenCalledExactlyOnceWith(5_000);
  });
});

/** Start a stand-in api that records each submit's key and body before handing it to `respond`. */
async function serve(respond: (req: IncomingMessage, res: ServerResponse) => void): Promise<void> {
  server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      admitted.push({ key: String(req.headers["idempotency-key"]), body });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the test server did not bind a port");
  process.env.DEED_POLL_API_URL = `http://127.0.0.1:${address.port}`;
}

function answer(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
