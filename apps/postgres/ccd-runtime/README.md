# `ccd` schema — vendored decentralised-persistence runtime

The `migrations/` directory is **vendored verbatim** from
[`hmcts/ccd-config-generator`](https://github.com/hmcts/ccd-config-generator), path
`sdk/decentralised-runtime/src/main/resources/dataruntime-db/migration/`.

| | |
|---|---|
| Upstream commit | `b6bdfcde5f3b4edfa40692d51f690a8b60c4b507` |
| Upstream date | 2026-08-17 |
| Files | `V0001.sql` … `V0025.sql` (25 files) |

**Do not edit these files.** The runner checksums each one and fails if a file changes after it has
been applied. To take an upstream change, copy in the *new* migration file — never alter an applied
one.

## Why vendored rather than modelled in Prisma

This schema is the storage layer for CCD decentralised persistence. Prisma owns `public`; this owns
`ccd`; they never overlap — which is precisely the split CCD's decentralisation guidance requires
("SDK migrations target schema `ccd`; service app migrations must not overlap").

Three reasons it is not expressed as Prisma models:

1. **Prisma cannot express what this schema is made of** — 4 plpgsql functions, 4 triggers,
   `pg_notify`, and `CHECK (jsonb_typeof(...) = 'object')` constraints. The revision counter the
   CCD contract depends on *is* a trigger (`ccd.increment_case_revision`).
2. **`CREATE INDEX CONCURRENTLY` cannot run in a transaction**, and Prisma wraps migrations in one.
   Four files use it (V0012, V0015, V0023, V0025).
3. **The shape is not ours to redesign** — external systems read these tables directly:

   | Table | Read by |
   |---|---|
   | `ccd.es_queue` | Logstash, into CCD's central ES cluster (leases rows via `locked_until` / `lock_token`) |
   | `ccd.message_queue_candidates` | CCD's reusable message publisher → Work Allocation |
   | `ccd.task_outbox` | Work Allocation task management |
   | `ccd.case_event` | Strategic Data Platform (V0025 adds an index specifically for its extraction) |

   Hand-modelling would risk silent drift from consumers we do not control.

## Running

```bash
yarn db:migrate:ccd     # apply pending ccd migrations
yarn db:migrate         # Prisma (public) followed by ccd
```

Applied files are tracked in `ccd.schema_history` (version, filename, checksum, applied_at). This
is our own table, not upstream's — the SDK uses Flyway's `flyway_schema_history`, which we
deliberately do not create, so adopting Flyway later would need a one-off baseline.

## Re-syncing with upstream

```bash
git clone --depth 1 https://github.com/hmcts/ccd-config-generator.git /tmp/ccd-cfggen
diff -r /tmp/ccd-cfggen/sdk/decentralised-runtime/src/main/resources/dataruntime-db/migration \
        apps/postgres/ccd-runtime/migrations
```

Copy in any new `V00NN__*.sql` files, update the commit SHA above, and run `yarn db:migrate:ccd`.
Expect additions only — upstream treats these as append-only.

## Gotchas carried over from upstream

- **Two connection requirements for `UPDATE ... OF data ON ccd.case_event`.** Both are verified by
  `migrate.test.ts`. Only `data` updates trigger them — inserts are unaffected — so this passes
  casual testing and fails later.

  1. **`search_path` must include `ccd`.** The `audit_case_event_changes` trigger body inserts into
     `case_event_audit` **unqualified**, and plpgsql resolves that at execution time against the
     caller's `search_path`. V0001 does `SET search_path TO ccd`, but only for the session running
     the migration. A normal connection (`"$user", public`) fails with
     `relation "case_event_audit" does not exist`.
  2. **`ccd.user_idam_id` must be set.** The same trigger reads
     `current_setting('ccd.user_idam_id')::uuid` to attribute the audit row.

  So the enclosing transaction needs:

  ```sql
  set local search_path to public, ccd;
  set local "ccd.user_idam_id" = '<idam-user-uuid>';
  ```

  `public` stays first so Prisma's unqualified queries keep resolving to its own tables. We do not
  patch the vendored function to schema-qualify the insert, because that would fork the file from
  upstream and trip the checksum guard.
- **Two tables are created then dropped** across the migration history
  (`submitted_callback_queue` in V0003, `completed_events` in V0011), as is the `failed_jobs`
  view. They are not in the final schema; the files are kept so the history replays faithfully.
- **`case_event.case_reference` was renamed to `case_data_id` in V0005**, and now references
  `case_data.id` rather than `case_data.reference`. Both columns exist on `case_data`: `reference`
  is the 16-digit CCD case reference and primary key; `id` is CCD's internal integer ID, needed
  because it is the document ID used for Elasticsearch indexing.
- **`case_revision` is trigger-maintained** (V0007, renamed V0008). Do not set it from the
  application — `BEFORE UPDATE ON ccd.case_data` increments it. This is the `revision` value the
  `/ccd-persistence/*` contract exchanges with CCD.
