/**
 * What a failure carrying a caseworker's search reaches the log as, end to end (review finding E03).
 *
 * The unit tests pin each message where it is built. This drives the chain `app.ts` mounts — the CSRF gate, the
 * area gates, a page calling the real domain function against a real local HTTP answer, `domainErrorHandler`, then
 * the starter's `errorHandler` writing to the real `console` — and inspects what the sink was handed, so a
 * diagnostic composed anywhere along the way cannot carry a marker through unnoticed.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";
import { ACCESS_GAZETTE, findDeedPolls } from "@hmcts/deed-poll";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { errorHandler } from "@hmcts-cft/express-govuk-starter";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireCapability, requireJudicial } from "./auth/require-role.js";
import { requireSameOrigin } from "./auth/same-origin.js";
import { domainErrorHandler } from "./errors.js";

vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const QUERY = `?q=${encodeURIComponent("MARKER-Q Smith & Jones")}&where=${encodeURIComponent('surname = "MARKER-WHERE"')}&other=MARKER-OTHER`;

describe("error diagnostics at the final logging boundary", () => {
  let api: Server;
  let answer: string;
  let received: string[];
  let reached: Error[];
  let logged: ReturnType<typeof vi.spyOn>;
  let previousUrl: string | undefined;

  const app = express()
    .use((req, res, next) => {
      Object.assign(req, { session: {} });
      Object.assign(res, { render: (view: string) => res.send(view) });
      next();
    })
    .use(requireSameOrigin())
    .use("/judicial", requireJudicial())
    .use("/deed-polls/gazette", requireCapability(ACCESS_GAZETTE))
    .get("/deed-polls", async (req, res, next) => {
      try {
        const q = String(req.query.q);
        await findDeedPolls({ filter: "open", q, conditions: [{ field: "masterDirections", operator: "contains", values: ["MARKER-WHERE"] }] }, {});
        res.send("listed");
      } catch (error) {
        next(error);
      }
    })
    .use((err: Error, _req: Request, _res: Response, next: NextFunction) => {
      reached.push(err);
      next(err);
    })
    .use(domainErrorHandler())
    .use(errorHandler());

  beforeAll(async () => {
    api = createServer((req, res) => {
      received.push(req.url ?? "");
      res.writeHead(200, { "Content-Type": "application/json" }).end(answer);
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    previousUrl = process.env.DEED_POLL_API_URL;
    process.env.DEED_POLL_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env.DEED_POLL_API_URL = previousUrl;
    await new Promise((resolve) => api.close(resolve));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    received = [];
    reached = [];
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("when api answers a search with a body this app cannot use", () => {
    it.each([
      ["malformed JSON", '{"items": [', "GET /caseworker/cases returned a body that is not JSON"],
      ["valid JSON of the wrong shape", '{"items": "MARKER-BODY"}', "GET /caseworker/cases returned an unexpected shape ("]
    ])("should log the operation and failure category for %s and no search or body value", async (_case, body, diagnostic) => {
      answer = body;

      const response = await request(app).get(`/deed-polls${QUERY}`);

      expect(response.status).toBe(500);
      expect(reached).toHaveLength(1);
      const [error] = reached;
      expect(error.message).toContain(`deed-poll-api call failed (invalid-response): ${diagnostic}`);
      expect(logged.mock.calls).toHaveLength(1);
      expect(logged.mock.calls[0][0]).toBe("Error:");
      expect(String(logged.mock.calls[0][1])).toContain(diagnostic);
      const sink = [
        inspect(logged.mock.calls, { depth: null }),
        error.message,
        error.stack,
        inspect(error, { depth: null }),
        inspect(error.cause, { depth: null })
      ];
      expect(sink.join("\n")).not.toContain("MARKER");
    });

    it("should still send api the search and the condition the caseworker asked for", async () => {
      answer = "not json";

      await request(app).get(`/deed-polls${QUERY}`);

      expect(received).toHaveLength(1);
      const sent = new URL(received[0], "http://api.test").searchParams;
      expect(sent.get("q")).toBe("MARKER-Q Smith & Jones");
      expect(sent.getAll("where").join(" ")).toContain("MARKER-WHERE");
      expect(sent.get("filter")).toBe("open");
    });
  });

  describe("when a gate refuses a request carrying search values", () => {
    it.each([
      [
        "a cross-site write",
        () => request(app).post(`/deed-polls${QUERY}`).set("Sec-Fetch-Site", "cross-site"),
        "POST /deed-polls from a cross-site initiator"
      ],
      [
        "a write with an unrecognised Sec-Fetch-Site",
        () => request(app).post(`/deed-polls${QUERY}`).set("Sec-Fetch-Site", "MARKER-SITE"),
        "POST /deed-polls from an unrecognised Sec-Fetch-Site value"
      ],
      ["a non-judge on the judicial area", () => request(app).get(`/judicial/referrals${QUERY}`), "GET /judicial/referrals requires judicial access"],
      [
        "a caller without Gazette access",
        () => request(app).get(`/deed-polls/gazette/history${QUERY}`),
        `GET /deed-polls/gazette/history requires ${ACCESS_GAZETTE}`
      ]
    ])("should end at the 403 log line for %s, naming the route and reason and no request value", async (_case, send, line) => {
      const response = await send();

      expect(response.status).toBe(403);
      expect(response.text).toBe("errors/404");
      expect(logged.mock.calls).toEqual([[`forbidden: ${line}`]]);
      expect(received).toEqual([]);
      const [error] = reached;
      const sink = [inspect(logged.mock.calls), error.message, error.stack, inspect(error), inspect(vi.mocked(trackEvent).mock.calls, { depth: null })];
      expect(sink.join("\n")).not.toContain("MARKER");
    });
  });
});
