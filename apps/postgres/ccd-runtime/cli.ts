/**
 * CLI entry point for the `ccd` schema migrations — `yarn db:migrate:ccd`.
 *
 * Reuses the pool exported by @hmcts/postgres-prisma so the connection string is derived in
 * exactly one place (it builds DATABASE_URL from POSTGRES_* when those are set, which is how
 * preview environments supply it).
 */
import { pgPool } from "@hmcts/postgres-prisma";
import { dropCcdSchema, migrateCcdSchema } from "./migrate.js";

if (process.argv.includes("--reset")) {
  await dropCcdSchema(pgPool);
  console.log("ccd schema: dropped");
}

const applied = await migrateCcdSchema(pgPool);

if (applied.length === 0) {
  console.log("ccd schema: already up to date");
} else {
  console.log(`ccd schema: applied ${applied.length} migration(s)`);
  for (const m of applied) console.log(`  ${m.filename}`);
}

await pgPool.end();
