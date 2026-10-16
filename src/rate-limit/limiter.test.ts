import { TooManyRequestsError } from "@hmcts/deed-poll";
import type { NextFunction, Request, Response } from "express";
import { createClient } from "redis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, type RateLimitRedis, type RateLimitSettings, rateLimitSettings } from "./limiter.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
/** 10:00:30 on the day of the plan: thirty seconds into a one-minute window. */
const NOW = Date.UTC(2026, 9, 16, 10, 0, 30);
const BUCKETS = {
  search: { limit: 2, windowSeconds: 60 },
  "email-preview": { limit: 30, windowSeconds: 600 },
  "email-send": { limit: 20, windowSeconds: 3600 },
  upload: { limit: 30, windowSeconds: 600 }
};

const redisReachable = await canConnect();

describe("rate-limit/limiter", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe("createRateLimiter", () => {
    it("should count per IDAM subject, not per address, so two users behind one proxy are separate", async () => {
      const redis = fakeRedis();
      const limit = createRateLimiter(redis, settings("enforce"), () => NOW)("search");

      await run(limit, request({ subject: "user-a", ip: "10.0.0.1" }));
      await run(limit, request({ subject: "user-a", ip: "10.0.0.1" }));
      const other = await run(limit, request({ subject: "user-b", ip: "10.0.0.1" }));

      expect(other).toBeUndefined();
      expect([...redis.counts.keys()]).toEqual([`admin-rl:search:user-a:${windowIndex(60)}`, `admin-rl:search:user-b:${windowIndex(60)}`]);
    });

    it("should key on the session id when the session holds no subject", async () => {
      const redis = fakeRedis();
      const limit = createRateLimiter(redis, settings("enforce"), () => NOW)("search");

      await run(limit, request({ sessionID: "session-1" }));

      expect([...redis.counts.keys()]).toEqual([`admin-rl:search:session-1:${windowIndex(60)}`]);
    });

    it("should set the key's expiry to the window on every hit", async () => {
      const redis = fakeRedis();
      const limit = createRateLimiter(redis, settings("enforce"), () => NOW)("upload");

      await run(limit, request({ subject: "user-a" }));

      expect(redis.expiries.get(`admin-rl:upload:user-a:${windowIndex(600)}`)).toBe(600);
    });

    it("should start counting again in the next window", async () => {
      const redis = fakeRedis();
      let now = NOW;
      const limit = createRateLimiter(redis, settings("enforce"), () => now)("search");
      await run(limit, request({ subject: "user-a" }));
      await run(limit, request({ subject: "user-a" }));

      now = NOW + 30_000;
      const next = await run(limit, request({ subject: "user-a" }));

      expect(next).toBeUndefined();
    });

    it("should refuse beyond the limit in enforce mode with the seconds left in the window", async () => {
      const limit = createRateLimiter(fakeRedis(), settings("enforce"), () => NOW)("search");
      await run(limit, request({ subject: "user-a" }));
      await run(limit, request({ subject: "user-a" }));

      const refused = await run(limit, request({ subject: "user-a" }));

      expect(refused).toBeInstanceOf(TooManyRequestsError);
      expect((refused as TooManyRequestsError).retryAfterSeconds).toBe(30);
      expect(warn).toHaveBeenCalledWith("rate_limit bucket=search mode=enforce subject=user-a count=3 limit=2");
    });

    it("should pass the requests up to and including the limit without a log line", async () => {
      const limit = createRateLimiter(fakeRedis(), settings("enforce"), () => NOW)("search");

      const results = [await run(limit, request({ subject: "user-a" })), await run(limit, request({ subject: "user-a" }))];

      expect(results).toEqual([undefined, undefined]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("should log exactly what enforce would refuse and pass it in observe mode", async () => {
      const limit = createRateLimiter(fakeRedis(), settings("observe"), () => NOW)("search");
      await run(limit, request({ subject: "user-a" }));
      await run(limit, request({ subject: "user-a" }));

      const observed = await run(limit, request({ subject: "user-a" }));

      expect(observed).toBeUndefined();
      expect(warn).toHaveBeenCalledWith("rate_limit bucket=search mode=observe subject=user-a count=3 limit=2");
    });

    it("should not log the session id it falls back to", async () => {
      const limit = createRateLimiter(fakeRedis(), settings("observe"), () => NOW)("search");
      for (let i = 0; i < 3; i++) await run(limit, request({ sessionID: "session-secret-id" }));

      expect(warn).toHaveBeenCalledWith("rate_limit bucket=search mode=observe subject=- count=3 limit=2");
    });

    it("should touch nothing in off mode", async () => {
      const redis = fakeRedis();
      const limit = createRateLimiter(redis, settings("off"), () => NOW)("search");

      for (let i = 0; i < 5; i++) expect(await run(limit, request({ subject: "user-a" }))).toBeUndefined();

      expect(redis.counts.size).toBe(0);
    });

    it("should pass and warn when Redis fails, since a Redis outage already means no sessions", async () => {
      const limit = createRateLimiter(failingRedis(), settings("enforce"), () => NOW)("search");

      const result = await run(limit, request({ subject: "user-a" }));

      expect(result).toBeUndefined();
      expect(warn).toHaveBeenCalledWith("rate_limit bucket=search unavailable, passing: The client is closed");
    });

    it("should pass and warn when Redis replies with something that is not a count, rather than refusing on NaN", async () => {
      const redis: RateLimitRedis = {
        multi: () => {
          const chain = { incr: () => chain, expire: () => chain, exec: async () => [new Error("WRONGTYPE")] };
          return chain;
        }
      };
      const limit = createRateLimiter(redis, settings("enforce"), () => NOW)("search");

      const result = await run(limit, request({ subject: "user-a" }));

      expect(result).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("rate_limit bucket=search unavailable, passing"));
    });
  });

  describe("rateLimitSettings", () => {
    it("should accept the three modes and positive whole-number limits", () => {
      expect(rateLimitSettings({ mode: "observe", buckets: BUCKETS, uploadInFlight: 4 })).toEqual({ mode: "observe", buckets: BUCKETS, uploadInFlight: 4 });
    });

    it("should refuse an unknown mode, rather than guess which way to fail", () => {
      expect(() => rateLimitSettings({ mode: "enforcing", buckets: BUCKETS, uploadInFlight: 4 })).toThrow(/rateLimit.mode/);
    });

    it("should refuse a limit config handed back as a string", () => {
      expect(() => rateLimitSettings({ mode: "observe", buckets: { ...BUCKETS, upload: { limit: "30", windowSeconds: 600 } }, uploadInFlight: 4 })).toThrow(
        /rateLimit.buckets.upload/
      );
    });

    it("should refuse a missing bucket", () => {
      const { upload: _upload, ...rest } = BUCKETS;

      expect(() => rateLimitSettings({ mode: "observe", buckets: rest, uploadInFlight: 4 })).toThrow(/rateLimit.buckets.upload/);
    });

    it("should refuse an in-flight upload cap that is not a positive whole number", () => {
      expect(() => rateLimitSettings({ mode: "observe", buckets: BUCKETS, uploadInFlight: "4" })).toThrow(/rateLimit.uploadInFlight/);
      expect(() => rateLimitSettings({ mode: "observe", buckets: BUCKETS, uploadInFlight: 0 })).toThrow(/rateLimit.uploadInFlight/);
    });
  });
});

/**
 * Through a real Redis, because the fake cannot show that MULTI/INCR/EXPIRE as node-redis sends them counts and
 * sets a TTL. Skipped when there is none, as `src/session-store.test.ts` is.
 */
describe.skipIf(!redisReachable)("rate-limit/limiter through a real Redis", () => {
  const subject = `limiter-test-${process.pid}-${NOW}`;
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    client = createClient({ url: REDIS_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.del(`admin-rl:search:${subject}:${windowIndex(60)}`);
    await client?.quit();
  });

  it("should count two requests in one window as two, under a key that expires", async () => {
    const limit = createRateLimiter(client, settings("observe"), () => NOW)("search");
    const key = `admin-rl:search:${subject}:${windowIndex(60)}`;

    await run(limit, request({ subject }));
    await run(limit, request({ subject }));

    expect(await client.get(key)).toBe("2");
    expect(await client.ttl(key)).toBeGreaterThan(0);
    expect(await client.ttl(key)).toBeLessThanOrEqual(60);
  });
});

function settings(mode: RateLimitSettings["mode"]): RateLimitSettings {
  return { mode, buckets: BUCKETS, uploadInFlight: 4 };
}

function windowIndex(windowSeconds: number): number {
  return Math.floor(NOW / 1000 / windowSeconds);
}

function request({ subject, sessionID = "a-session", ip }: { subject?: string; sessionID?: string; ip?: string }): Request {
  return {
    session: subject ? { deedPoll: { subject } } : {},
    sessionID,
    ip,
    headers: ip ? { "x-forwarded-for": ip } : {}
  } as unknown as Request;
}

/** Runs the middleware and answers what it passed to `next`: undefined to continue, or the error it raised. */
function run(handler: ReturnType<ReturnType<typeof createRateLimiter>>, req: Request): Promise<unknown> {
  return new Promise((resolve) => {
    handler(req, {} as Response, ((error?: unknown) => resolve(error)) as NextFunction);
  });
}

function fakeRedis(): RateLimitRedis & { counts: Map<string, number>; expiries: Map<string, number> } {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  return {
    counts,
    expiries,
    multi() {
      const replies: number[] = [];
      const chain = {
        incr(key: string) {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          replies.push(count);
          return chain;
        },
        expire(key: string, seconds: number) {
          expiries.set(key, seconds);
          replies.push(1);
          return chain;
        },
        exec: async () => replies
      };
      return chain;
    }
  } as unknown as RateLimitRedis & { counts: Map<string, number>; expiries: Map<string, number> };
}

function failingRedis(): RateLimitRedis {
  const chain = {
    incr: () => chain,
    expire: () => chain,
    exec: async () => {
      throw new Error("The client is closed");
    }
  };
  return { multi: () => chain } as unknown as RateLimitRedis;
}

async function canConnect(): Promise<boolean> {
  const client = createClient({ url: REDIS_URL, socket: { connectTimeout: 500, reconnectStrategy: false } });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.quit();
    return true;
  } catch {
    return false;
  }
}
