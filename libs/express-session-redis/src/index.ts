import { RedisStore } from "connect-redis";
import type { RequestHandler } from "express";
import session, { type SessionOptions } from "express-session";

export function expressSessionRedis(options: ExpressSessionRedisOptions): RequestHandler {
  const { redisConnection, sessionOptions = {}, storeOptions = {} } = options;
  const secret = sessionOptions.secret || process.env.SESSION_SECRET || "default-secret-change-in-production";

  const defaultSessionOptions: SessionOptions = {
    store: new RedisStore({
      client: redisConnection,
      prefix: "sess:",
      ...storeOptions
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: options.cookieMaxAge || 1000 * 60 * 60 * 4 // 4 hours
    }
  };

  return session({
    ...defaultSessionOptions,
    ...sessionOptions
  });
}

export type ExpressSessionRedisOptions = {
  redisConnection: any; // Redis client instance from 'redis' package
  sessionOptions?: Partial<SessionOptions>;
  storeOptions?: {
    prefix?: string;
    ttl?: number;
    disableTouch?: boolean;
    disableTTL?: boolean;
  };
  cookieMaxAge?: number;
};
