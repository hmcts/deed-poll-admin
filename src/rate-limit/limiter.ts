/**
 * A fixed-window limit per user on the four actions api also limits (OWASP plan 06, M6).
 *
 * **api is authoritative; this is not the control.** It exists so a caseworker is refused here, on this app's page,
 * before a pod spends a multipart parse or an api round trip on a request api would refuse anyway. Its numbers
 * mirror api's so it never refuses what api would allow.
 *
 * Hand-rolled on the session Redis rather than a dependency: `INCR` and `EXPIRE` in one `MULTI`, under a key that
 * carries the window index. `EXPIRE` has no `NX` because Azure Cache may predate Redis 7, and with the index in the
 * key a repeated `EXPIRE` only restates the same window.
 *
 * Keyed on the IDAM subject, falling back to the session id. **Never on IP or `X-Forwarded-For`**: every caseworker
 * behind one office proxy would share a count, and the header is the client's to set.
 *
 * Fails open: when Redis errors the request passes with a warning, because a Redis outage already means no sessions
 * and refusing here would add nothing.
 */
import { TooManyRequestsError } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sessionSubject } from "../auth/session.js";
import { forLog } from "../for-log.js";

const KEY_PREFIX = "admin-rl";
const MODES: readonly RateLimitMode[] = ["off", "observe", "enforce"];
const BUCKETS: readonly RateLimitBucket[] = ["search", "email-preview", "email-send", "upload"];

/**
 * A factory per bucket, over a Redis client and settings read once at startup.
 *
 * `observe` counts and logs exactly what `enforce` would refuse, and refuses nothing.
 */
export function createRateLimiter(redis: RateLimitRedis, settings: RateLimitSettings, now: () => number = Date.now) {
  return (bucket: RateLimitBucket): RequestHandler =>
    async (req: Request, _res: Response, next: NextFunction) => {
      if (settings.mode === "off") return next();

      const { limit, windowSeconds } = settings.buckets[bucket];
      const nowSeconds = now() / 1000;
      const windowIndex = Math.floor(nowSeconds / windowSeconds);
      const subject = sessionSubject(req);
      const key = `${KEY_PREFIX}:${bucket}:${subject ?? req.sessionID}:${windowIndex}`;

      let count: number;
      try {
        const [incremented] = await redis.multi().incr(key).expire(key, windowSeconds).exec();
        count = Number(incremented);
      } catch (error) {
        console.warn(`rate_limit bucket=${bucket} unavailable, passing: ${forLog(error instanceof Error ? error.message : String(error))}`);
        return next();
      }
      if (count <= limit) return next();

      // The session id is a bearer credential, so a fallback-keyed refusal is logged without a subject.
      console.warn(`rate_limit bucket=${bucket} mode=${settings.mode} subject=${subject ?? "-"} count=${count} limit=${limit}`);
      if (settings.mode === "observe") return next();

      const retryAfterSeconds = Math.ceil((windowIndex + 1) * windowSeconds - nowSeconds);
      next(new TooManyRequestsError(`Rate limit reached for ${bucket}`, retryAfterSeconds));
    };
}

/**
 * The `rateLimit` config block, checked at startup.
 *
 * Refuses rather than defaults: a mode it does not recognise has no safe reading, and a limit that arrived as a
 * string (a missing `__format: json`) would compare as text.
 */
export function rateLimitSettings(raw: unknown): RateLimitSettings {
  const { mode, buckets } = (raw ?? {}) as { mode?: unknown; buckets?: Record<string, unknown> };
  if (!MODES.includes(mode as RateLimitMode)) {
    throw new Error(`rateLimit.mode must be one of ${MODES.join(", ")}, got ${JSON.stringify(mode)}`);
  }
  const checked = Object.fromEntries(BUCKETS.map((bucket) => [bucket, bucketSettings(bucket, buckets?.[bucket])]));
  return { mode: mode as RateLimitMode, buckets: checked as Record<RateLimitBucket, BucketSettings> };
}

function bucketSettings(bucket: RateLimitBucket, raw: unknown): BucketSettings {
  const { limit, windowSeconds } = (raw ?? {}) as { limit?: unknown; windowSeconds?: unknown };
  if (!isPositiveInteger(limit) || !isPositiveInteger(windowSeconds)) {
    throw new Error(`rateLimit.buckets.${bucket} needs a positive whole-number limit and windowSeconds`);
  }
  return { limit, windowSeconds };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

export type RateLimitMode = "off" | "observe" | "enforce";

export type RateLimitBucket = "search" | "email-preview" | "email-send" | "upload";

export interface BucketSettings {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitSettings {
  mode: RateLimitMode;
  buckets: Record<RateLimitBucket, BucketSettings>;
}

/** The slice of a node-redis client the limiter uses, so the logic is tested against a fake. */
export interface RateLimitRedis {
  multi(): RateLimitMulti;
}

interface RateLimitMulti {
  incr(key: string): RateLimitMulti;
  expire(key: string, seconds: number): RateLimitMulti;
  exec(): Promise<unknown[]>;
}
