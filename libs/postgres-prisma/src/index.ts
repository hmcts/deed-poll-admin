import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Construct DATABASE_URL from individual env vars if available
if (process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_PORT && process.env.POSTGRES_DATABASE) {
  const { POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_PORT, POSTGRES_DATABASE } = process.env;
  process.env.DATABASE_URL = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DATABASE}?sslmode=require`;
}

// Default to local PostgreSQL when DATABASE_URL is absent. Empty counts as absent — the same reason
// `prisma.config.ts` does not use `??=`: a Helm `env:` value or a mounted vault secret that does not
// exist arrives as the empty string, which `??=` preserves. Here that would build a pool against `""`
// and fail at connect time rather than falling back, so the failure would be a connection error naming
// no host rather than anything pointing at the missing configuration.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://hmcts@localhost:5432/postgres";

// Create connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

// Shared so the session store reuses this pool and the DATABASE_URL derivation above,
// rather than rebuilding the connection string from POSTGRES_* itself.
export { pool as pgPool };

// Create driver adapter
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type { PrismaClient } from "../generated/prisma/client.js";
export * from "../generated/prisma/client.js";
