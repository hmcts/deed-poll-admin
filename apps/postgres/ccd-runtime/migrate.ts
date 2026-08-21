/**
 * Migration runner for the `ccd` schema.
 *
 * The `ccd` schema is the CCD decentralised-persistence runtime store. Its DDL is vendored
 * verbatim from hmcts/ccd-config-generator (see ./README.md) rather than re-expressed as Prisma
 * models, because several external systems read those tables directly and the shape is not ours
 * to redesign. Prisma owns the `public` schema only; the two never overlap, which is exactly the
 * split the CCD decentralisation guidance requires.
 *
 * Why a bespoke runner rather than Prisma Migrate: the vendored SQL uses plpgsql functions,
 * triggers, LISTEN/NOTIFY and CREATE INDEX CONCURRENTLY, none of which Prisma can express, and
 * CONCURRENTLY cannot run inside the transaction Prisma wraps migrations in.
 *
 * Applied files are tracked in ccd.schema_history with a checksum, so a vendored file edited
 * after it was applied fails loudly instead of drifting from the upstream SQL it is meant to
 * mirror.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Drop the whole `ccd` schema, including its history table.
 *
 * Needed by `migrate:reset`: `prisma migrate reset` only drops the schemas listed in Prisma's
 * datasource, and `ccd` deliberately is not one of them — so without this a "reset" would leave
 * the ccd tables and their schema_history behind, and the next migrate would skip every file
 * while the public schema was empty.
 */
export async function dropCcdSchema(pool: pg.Pool): Promise<void> {
  await pool.query("drop schema if exists ccd cascade");
}

export async function migrateCcdSchema(pool: pg.Pool): Promise<AppliedMigration[]> {
  await pool.query("create schema if not exists ccd");
  await pool.query(`
    create table if not exists ccd.schema_history (
      version     text primary key,
      filename    text not null,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);

  const { rows: history } = await pool.query<{ version: string; filename: string; checksum: string }>(
    "select version, filename, checksum from ccd.schema_history"
  );
  const applied = new Map(history.map((r) => [r.version, r]));

  const applications: AppliedMigration[] = [];

  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file.filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(file.version);

    if (previous) {
      if (previous.checksum !== checksum) {
        throw new Error(
          `ccd migration ${file.version} (${file.filename}) was modified after it was applied.\n` +
            `  applied checksum: ${previous.checksum}\n` +
            `  current checksum: ${checksum}\n` +
            "These files are vendored verbatim from ccd-config-generator and must not be edited. " +
            "To take an upstream change, add the new migration file rather than altering an applied one."
        );
      }
      continue;
    }

    await applyMigration(pool, file, sql);
    await pool.query("insert into ccd.schema_history (version, filename, checksum) values ($1, $2, $3)", [file.version, file.filename, checksum]);
    applications.push({ version: file.version, filename: file.filename });
  }

  return applications;
}

/**
 * Vendored filenames are `V<n>[__description].sql`. Sorted numerically, not lexically, so V0010
 * follows V0009 — and so the ordering does not silently change if upstream ever reaches V0100.
 */
function migrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((filename) => {
      const match = /^V(\d+)/.exec(filename);
      if (!match) throw new Error(`Unexpected file in ccd migrations directory: ${filename}`);
      return { filename, version: match[1], ordinal: Number(match[1]) };
    })
    .sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction, and node-postgres wraps a
 * multi-statement query in an implicit one. Those files are split and run statement by statement
 * with autocommit; every other file runs whole so that it is atomic.
 *
 * Splitting is only safe because no vendored file both uses CONCURRENTLY and contains a `$$`
 * quoted plpgsql body (a naive split on `;` would cut a function body in half). That invariant is
 * asserted here so it fails loudly if a future upstream migration breaks it.
 */
async function applyMigration(pool: pg.Pool, file: MigrationFile, sql: string): Promise<void> {
  const isConcurrent = /\bconcurrently\b/i.test(sql);

  if (!isConcurrent) {
    await pool.query(sql);
    return;
  }

  if (sql.includes("$$")) {
    throw new Error(
      `ccd migration ${file.filename} uses CONCURRENTLY and contains a $$-quoted body. ` +
        "It cannot be run whole (CONCURRENTLY forbids a transaction) nor split safely (splitting " +
        "would cut the quoted body). It needs handling by hand in migrate.ts."
    );
  }

  for (const statement of splitStatements(sql)) {
    await pool.query(statement);
  }
}

/** Strip comments and split on `;`. Only used for files known to contain no `$$` bodies. */
function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface MigrationFile {
  filename: string;
  version: string;
  ordinal: number;
}

interface AppliedMigration {
  version: string;
  filename: string;
}
