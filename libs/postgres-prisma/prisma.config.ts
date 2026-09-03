import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

if (process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_PORT && process.env.POSTGRES_DATABASE) {
  const { POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_PORT, POSTGRES_DATABASE } = process.env;
  process.env.DATABASE_URL = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DATABASE}?sslmode=require`;
}

// Default to local PostgreSQL when DATABASE_URL is absent.
//
// **Empty counts as absent, which is why this is not `??=`.** `job.lint.yml` passes
// `DATABASE_URL: ${{ secrets.DATABASE_URL }}`, and an unset secret interpolates to the empty string
// rather than to nothing — so `??=` kept `""`, `env("DATABASE_URL")` below could not resolve it, and
// the whole config failed to load with `PrismaConfigEnvError`. That is why CI's lint job was red while
// `prisma validate` passed locally, where the variable is genuinely unset and the default applied.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://hmcts@localhost:5432/postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema"),
  datasource: {
    url: env("DATABASE_URL")
  }
});
