/**
 * Integration tests for the vendored `ccd` schema.
 *
 * These pin the behaviour the CCD decentralised-persistence contract depends on. The SQL is
 * vendored verbatim from ccd-config-generator, so these tests are not testing our code so much as
 * asserting that replaying upstream's migration history outside Flyway produces a schema that
 * actually behaves — and documenting the two connection requirements that are easy to miss.
 *
 * Requires a reachable PostgreSQL. Skipped when there is none, because the CI test job does not
 * provision a database (`.github/workflows/job.test.yml` has no `services:` block) — so treat these
 * as local-only coverage until it does.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropCcdSchema, migrateCcdSchema } from "./migrate.js";

const CONNECTION_STRING = process.env.DATABASE_URL ?? "postgresql://hmcts@localhost:5432/postgres";

const databaseReachable = await canConnect();
const REF = 9900000000000001n;

describe.skipIf(!databaseReachable)("ccd schema migrations", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION_STRING });
    await dropCcdSchema(pool);
    await migrateCcdSchema(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("applies every vendored migration, and is a no-op on a second run", async () => {
    const secondRun = await migrateCcdSchema(pool);

    expect(secondRun).toEqual([]);
    const { rows } = await pool.query<{ n: number }>("select count(*)::int n from ccd.schema_history");
    expect(rows[0].n).toBe(25);
  });

  it("creates the schema objects the runtime needs", async () => {
    expect(await names("select table_name from information_schema.tables where table_schema='ccd'")).toEqual(
      expect.arrayContaining([
        "case_data",
        "case_event",
        "case_event_audit",
        "case_event_significant_items",
        "ccd_data_migration_progress",
        "es_dead_letter_queue",
        "es_queue",
        "message_queue_candidates",
        "task_outbox",
        "task_outbox_history"
      ])
    );
    // Created then dropped across the history — assert the replay really removed them.
    const tables = await names("select table_name from information_schema.tables where table_schema='ccd'");
    expect(tables).not.toContain("submitted_callback_queue");
    expect(tables).not.toContain("completed_events");

    expect(await names("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ccd'")).toEqual([
      "audit_case_event_changes",
      "enqueue_case_revision",
      "increment_case_revision",
      "notify_es_queue_changed"
    ]);
  });

  it("refuses to run when a vendored file has been edited since it was applied", async () => {
    await pool.query("update ccd.schema_history set checksum = 'tampered' where version = '0001'");

    await expect(migrateCcdSchema(pool)).rejects.toThrow(/was modified after it was applied/);

    // Restore so the remaining tests see a consistent history.
    await dropCcdSchema(pool);
    await migrateCcdSchema(pool);
  });

  describe("case_revision", () => {
    beforeAll(() => seedCase(pool, REF, 9001));

    it("is maintained by trigger, not the application", async () => {
      expect(await caseRevision(REF)).toBe("1");

      await pool.query("update ccd.case_data set state='Enroled' where reference=$1", [REF]);
      await pool.query("update ccd.case_data set state='Returned' where reference=$1", [REF]);

      expect(await caseRevision(REF)).toBe("3");
    });

    it("enqueues the latest revision for indexing, collapsed to one row per case", async () => {
      const { rows } = await pool.query<{ case_revision: string }>("select case_revision from ccd.es_queue where reference=$1", [REF]);

      expect(rows).toHaveLength(1);
      expect(rows[0].case_revision).toBe("3");
    });
  });

  describe("case_event constraints", () => {
    const ref = 9900000000000002n;
    const key = "11111111-1111-1111-1111-111111111111";

    beforeAll(async () => {
      await seedCase(pool, ref, 9002);
      await insertEvent(pool, 9002, key, 1);
    });

    it("rejects a replayed idempotency key for the same case", async () => {
      await expect(insertEvent(pool, 9002, key, 2)).rejects.toMatchObject({
        constraint: "case_event_idempotency_key_key"
      });
    });

    it("rejects a duplicate revision for the same case", async () => {
      await expect(insertEvent(pool, 9002, "33333333-3333-3333-3333-333333333333", 1)).rejects.toMatchObject({
        constraint: "idx_case_event_case_data_revision_unique"
      });
    });
  });

  describe("audit trigger on case_event data updates", () => {
    const ref = 9900000000000003n;

    beforeAll(async () => {
      await seedCase(pool, ref, 9003);
      await insertEvent(pool, 9003, "44444444-4444-4444-4444-444444444444", 1);
    });

    it("fails on a default search_path, because the trigger body is unqualified", async () => {
      // plpgsql resolves `case_event_audit` at execution time; a normal connection is
      // ("$user", public), so the insert inside the trigger cannot see the ccd table.
      await expect(pool.query(`update ccd.case_event set data='{"x":1}'::jsonb where case_data_id=9003`)).rejects.toThrow(
        /relation "case_event_audit" does not exist/
      );
    });

    it("writes an attributed audit row when search_path and ccd.user_idam_id are both set", async () => {
      const userId = "22222222-2222-2222-2222-222222222222";
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local search_path to public, ccd");
        await client.query(`set local "ccd.user_idam_id" = '${userId}'`);
        await client.query(`update ccd.case_event set data='{"x":2}'::jsonb where case_data_id=9003`);
        await client.query("commit");
      } finally {
        client.release();
      }

      const { rows } = await pool.query<{ user_id: string; data: unknown }>(
        `select a.user_id, a.data from ccd.case_event_audit a
         join ccd.case_event e on e.id = a.case_event_id where e.case_data_id = 9003`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(userId);
      expect(rows[0].data).toEqual({ x: 2 });
    });
  });

  it("enforces that supplementary_data is a JSON object", async () => {
    const ref = 9900000000000004n;
    await seedCase(pool, ref, 9004);

    await expect(pool.query("update ccd.case_data set supplementary_data='[]'::jsonb where reference=$1", [ref])).rejects.toMatchObject({
      constraint: "supplementary_data_must_be_object"
    });
  });

  it("cascades a case delete to its events and index queue", async () => {
    const ref = 9900000000000005n;
    await seedCase(pool, ref, 9005);
    await insertEvent(pool, 9005, "55555555-5555-5555-5555-555555555555", 1);

    await pool.query("delete from ccd.case_data where reference=$1", [ref]);

    expect(await count("select count(*)::int n from ccd.case_event where case_data_id=9005")).toBe(0);
    expect(await count(`select count(*)::int n from ccd.es_queue where reference=${ref}`)).toBe(0);
  });

  async function names(sql: string): Promise<string[]> {
    const { rows } = await pool.query<Record<string, string>>(sql);
    return rows.map((r) => Object.values(r)[0]).sort();
  }

  async function count(sql: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(sql);
    return rows[0].n;
  }

  async function caseRevision(reference: bigint): Promise<string> {
    const { rows } = await pool.query<{ case_revision: string }>("select case_revision from ccd.case_data where reference=$1", [reference]);
    return rows[0].case_revision;
  }
});

function seedCase(pool: pg.Pool, reference: bigint, internalId: number): Promise<unknown> {
  return pool.query(
    `insert into ccd.case_data (reference, id, security_classification, jurisdiction, case_type_id, state, data)
     values ($1, $2, 'RESTRICTED', 'DEEDPOLL', 'DeedPoll', 'Received', '{}'::jsonb)`,
    [reference, internalId]
  );
}

function insertEvent(pool: pg.Pool, caseDataId: number, idempotencyKey: string, revision: number): Promise<unknown> {
  return pool.query(
    `insert into ccd.case_event (case_data_id, case_type_version, event_id, user_id, case_type_id, state_id,
       data, user_first_name, user_last_name, event_name, security_classification, idempotency_key, version,
       case_revision)
     values ($1, 1, 'createCase', 'user-1', 'DeedPoll', 'Received', '{}'::jsonb, 'Ada', 'Lovelace', 'Create',
       'RESTRICTED', $2, 1, $3)`,
    [caseDataId, idempotencyKey, revision]
  );
}

async function canConnect(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: CONNECTION_STRING, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    console.warn("ccd schema tests skipped: no PostgreSQL reachable at the configured DATABASE_URL");
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}
