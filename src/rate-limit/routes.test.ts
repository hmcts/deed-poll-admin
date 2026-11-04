import { AWAITING_CONFIRMATION_FILTER, caseListSearch, returnedForActionConditions, TooManyRequestsError } from "@hmcts/deed-poll";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadSingleFile } from "../documents/upload.js";
import { createRateLimiter, type RateLimitMode, type RateLimitRedis } from "./limiter.js";
import { mountAbuseLimits } from "./routes.js";
import { uploadInFlightCap } from "./upload-in-flight.js";

const NOW = Date.UTC(2026, 9, 16, 10, 0, 30);
const UPLOAD_PATH = "/deed-polls/case-1/documents/upload";

describe("rate-limit/routes", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe("search", () => {
    it("should count a list read that carries a search term", async () => {
      const { app, redis } = appWith({ mode: "observe" });

      await supertest(app).get("/deed-polls?q=Smith").expect(200);

      expect([...redis.counts.keys()]).toEqual([expect.stringMatching(/^admin-rl:search:user-a:/)]);
    });

    it("should not count the dashboard, a worklist tab or a saved-query link, none of which carries q", async () => {
      const { app, redis } = appWith({ mode: "observe" });
      const worklistTab = caseListSearch({ filter: AWAITING_CONFIRMATION_FILTER });
      const savedQuery = caseListSearch({ conditions: returnedForActionConditions() });

      await supertest(app).get("/deed-polls").expect(200);
      await supertest(app).get(`/deed-polls${worklistTab}`).expect(200);
      await supertest(app).get(`/deed-polls${savedQuery}`).expect(200);
      await supertest(app).get("/deed-polls?q=%20%20").expect(200);

      expect(redis.counts.size).toBe(0);
    });

    it("should refuse a search beyond the limit in enforce mode", async () => {
      const { app, errors } = appWith({ mode: "enforce", limit: 1 });
      await supertest(app).get("/deed-polls?q=Smith").expect(200);

      await supertest(app).get("/deed-polls?q=Jones").expect(429);

      expect(errors[0]?.error).toBeInstanceOf(TooManyRequestsError);
    });
  });

  describe("email", () => {
    it.each([
      ["email-preview", "/deed-polls/case-1/emails/application-rejected/preview"],
      ["email-send", "/deed-polls/case-1/emails/application-rejected/send"]
    ])("should count the %s POST in its own bucket", async (bucket, url) => {
      const { app, redis } = appWith({ mode: "observe" });

      await supertest(app).post(url).expect(200);

      expect([...redis.counts.keys()]).toEqual([expect.stringMatching(new RegExp(`^admin-rl:${bucket}:user-a:`))]);
    });
  });

  describe("upload", () => {
    it("should refuse an upload over the limit before multer parses it", async () => {
      const { app, errors, reached } = appWith({ mode: "enforce", limit: 0 });

      await anUpload(app).expect(429);

      expect(reached).toEqual([]);
      expect(errors[0]?.error).toBeInstanceOf(TooManyRequestsError);
      expect(errors[0]?.file).toBeUndefined();
    });

    it("should refuse an upload over the in-flight cap before multer parses it, and without counting it", async () => {
      const { app, errors, reached, redis, hold } = appWith({ mode: "enforce", inFlight: 1 });
      const held = anUpload(app, "held").then((res) => res);
      await hold.started;

      await anUpload(app).expect(429);
      hold.release();
      await held;

      expect(reached).toEqual(["held"]);
      expect(errors[0]?.error).toMatchObject({ name: "TooManyRequestsError", retryAfterSeconds: 5 });
      expect(errors[0]?.file).toBeUndefined();
      expect([...redis.counts.values()]).toEqual([1]);
    });

    it.each<RateLimitMode>(["off", "observe", "enforce"])("should enforce the in-flight cap in %s mode", async (mode) => {
      const { app, hold } = appWith({ mode, inFlight: 1 });
      const held = anUpload(app, "held").then((res) => res);
      await hold.started;

      const refused = await anUpload(app);
      hold.release();
      await held;

      expect(refused.status).toBe(429);
    });

    it("should release the in-flight slot when an upload finishes", async () => {
      const { app, reached } = appWith({ mode: "enforce", inFlight: 1 });

      await anUpload(app).expect(200);

      await anUpload(app).expect(200);

      expect(reached).toEqual(["upload", "upload"]);
    });

    it("should release the in-flight slot when an upload fails", async () => {
      const { app, reached } = appWith({ mode: "enforce", inFlight: 1 });

      await anUpload(app, "fail").expect(500);

      await anUpload(app).expect(200);

      expect(reached).toEqual(["fail", "upload"]);
    });
  });
});

/**
 * The limits as `createApp` mounts them, ahead of a router standing in for the pages. The upload route is the real
 * multipart parser followed by a probe, so a refusal that reached multer would show up as a parsed file.
 */
function appWith({ mode, limit = 30, inFlight = 4 }: { mode: RateLimitMode; limit?: number; inFlight?: number }) {
  const redis = fakeRedis();
  const errors: { error: unknown; file: unknown }[] = [];
  const reached: string[] = [];
  const hold = deferredHold();
  const bucket = { limit, windowSeconds: 600 };
  const limiter = createRateLimiter(
    redis,
    { mode, buckets: { search: bucket, "email-preview": bucket, "email-send": bucket, upload: bucket }, uploadInFlight: inFlight },
    () => NOW
  );
  const app = express();

  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { session: { deedPoll: { subject: "user-a" } }, sessionID: "session-1" });
    next();
  });
  mountAbuseLimits(app, limiter, uploadInFlightCap(inFlight));
  app.get("/deed-polls", (_req, res) => {
    res.send("list");
  });
  app.post("/deed-polls/:id/emails/:template/:step", (_req, res) => {
    res.send("email");
  });
  app.post("/deed-polls/:id/documents/upload", uploadSingleFile(), async (req: Request, res: Response) => {
    const name = (req.body as { name?: string }).name ?? "upload";
    reached.push(name);
    if (name === "fail") throw new Error("api is down");
    if (name === "held") await hold.wait();
    res.send("uploaded");
  });
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    errors.push({ error, file: req.file });
    res.status(error instanceof TooManyRequestsError ? 429 : 500).send("refused");
  });

  return { app, redis, errors, reached, hold };
}

function anUpload(app: express.Express, name = "upload") {
  return supertest(app)
    .post(UPLOAD_PATH)
    .field("name", name)
    .attach("file", Buffer.from("%PDF-1.4"), { filename: "birth.pdf", contentType: "application/pdf" });
}

function deferredHold() {
  let markStarted: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started,
    release,
    wait: () => {
      markStarted();
      return released;
    }
  };
}

function fakeRedis(): RateLimitRedis & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    multi() {
      const replies: number[] = [];
      const chain = {
        incr(key: string) {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          replies.push(count);
          return chain;
        },
        expire() {
          replies.push(1);
          return chain;
        },
        exec: async () => replies
      };
      return chain;
    }
  };
}
