import type { RequestHandler } from "express";
import session, { type SessionOptions } from "express-session";
import type { Pool } from "pg";
import { PostgresStore } from "./postgres-store.js";

export function expressSessionPostgres(options: ExpressSessionPostgresOptions): RequestHandler {
  const { pgConnection, sessionOptions = {}, storeOptions = {} } = options;
  const secret = sessionOptions.secret || process.env.SESSION_SECRET || "default-secret-change-in-production";

  const store = new PostgresStore({
    pool: pgConnection,
    ...storeOptions
  });

  const defaultSessionOptions: SessionOptions = {
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: options.cookieMaxAge || 1000 * 60 * 60 * 24
    }
  };

  return session({
    ...defaultSessionOptions,
    ...sessionOptions,
    store
  });
}

export type ExpressSessionPostgresOptions = {
  pgConnection: Pool;
  sessionOptions?: Partial<SessionOptions>;
  cookieMaxAge?: number;
  storeOptions?: {
    tableName?: string;
    schemaName?: string;
    ttl?: number;
    disableTouch?: boolean;
    cleanupInterval?: number;
  };
};
