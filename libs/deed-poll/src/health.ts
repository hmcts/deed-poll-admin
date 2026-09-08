/**
 * Whether this database can actually serve deed-poll traffic.
 *
 * A connection check — `select 1` — proves only that Postgres answers. It says nothing about whether
 * the migrations have run, and an unmigrated pod passes it while every request 500s. That is the worst
 * shape of readiness failure: the probe is green, so Kubernetes keeps sending traffic and nothing
 * escalates. Hence checking for the tables themselves.
 *
 * One query against `information_schema`, not one per table, and it returns the **missing** names
 * rather than a boolean, so whatever reports the failure can say which tables — a health check reduces
 * to UP/DOWN, and "readiness DOWN" with no further detail is most of the diagnosis wasted.
 *
 * In the domain rather than in each app because both apps ask the same question of the same schema, and
 * it needs nothing from Express to answer it.
 */
import { setTimeout as delay } from "node:timers/promises";
import { pgPool, prisma } from "@hmcts/postgres-prisma";

/**
 * How long a readiness check waits for the database before reporting it down. See `guarded` — this bounds
 * the *probe*, not the pool, for the same reason as the Redis ping bound in `apps/web/src/app.ts`: a probe
 * that outlives Kubernetes' own timeout tells whoever is diagnosing the outage nothing.
 *
 * Three seconds rather than the Redis ping's one, because these two are not pings: the first probe after a
 * pod starts opens a pool connection, and a TLS handshake to Azure Postgres plus an `information_schema`
 * query is comfortably slower than a round trip on an established socket. The failure to avoid is a bound
 * tight enough to report a healthy database down and take the pod out of the Service on a cold start.
 */
const CHECK_TIMEOUT_MS = 3_000;

/**
 * How long an attempt that has not settled is reused by later probes before one starts a fresh attempt.
 * See `guarded` — reuse is what stops a blackholed database leaving one pool acquisition behind per probe,
 * but reuse without a bound is worse than the leak: liveness carries no database check by deliberate
 * choice (`checks: {}` in both apps), so a readiness check that can never answer UP again is a pod out of
 * the Service until someone notices and restarts it by hand.
 *
 * A minute, against a probe period of seconds: long enough that a stuck attempt is reused across many
 * probes rather than one, short enough that readiness follows the database back within a minute of it
 * recovering. The attempts that accumulate are bounded by the outage length over this window — well under
 * `pgPool`'s ten connections for any outage the OS resolves itself, which a blackholed connect does at the
 * TCP layer whatever `connectionTimeoutMillis` says.
 */
const STALE_ATTEMPT_MS = 60_000;

/**
 * Distinguishes "the timer won" from "the check answered DOWN", which want different log lines — see
 * `guarded`. A symbol rather than a third string, so it cannot collide with a `HealthCheck` status.
 */
const TIMED_OUT = Symbol("health check timed out");

/**
 * Every table the deed-poll domain reads or writes, as named by the `@@map`s in
 * `libs/postgres-prisma/prisma/schema/deed-poll.prisma`.
 *
 * Listed explicitly rather than derived, because Prisma exposes no runtime schema introspection — so
 * **this has to be updated by hand when a model is added.** A missing entry is a silent gap: readiness
 * would pass on a database lacking the new table. `health.test.ts` guards against that by
 * checking this list against the schema file itself.
 */
export const DEED_POLL_TABLES = [
  "deedpoll_deedpoll",
  "deedpoll_notes",
  "deedpoll_witness",
  "deedpoll_supportingdocument",
  "deedpoll_supportingdocumenttype",
  "deedpoll_referencecounter"
] as const;

/**
 * The deed-poll tables that are not present, in the schema this connection actually resolves to.
 *
 * `current_schema()` rather than a literal `'public'`, so it follows the connection's `search_path`
 * and answers for the schema Prisma is querying — this database also carries a `ccd` schema, and a
 * check that looked in the wrong one would be worse than no check.
 *
 * Throws if the database is unreachable. That is deliberate: "cannot connect" and "connected but
 * unmigrated" are different faults, and flattening them here would lose the distinction the caller
 * wants to log.
 */
export async function missingDeedPollTables(): Promise<string[]> {
  const expected = [...DEED_POLL_TABLES];

  const found = await prisma.$queryRaw<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = current_schema() and table_name = any(${expected})
  `;

  const present = new Set(found.map((row) => row.table_name));
  return expected.filter((table) => !present.has(table));
}

/**
 * The checks a deed-poll service is not ready without, shared by both apps.
 *
 * Shared rather than a wrapper per app, for the reason `plain-http.ts` gives: two copies of the same
 * decision are two things free to drift, and "what does this service need from its database" has one
 * answer. **Whether these are readiness or liveness is the app's call, not this file's** — that depends
 * on the deployment, and both apps get it wrong in the same direction if this decides for them. See
 * each `app.ts`.
 *
 * Plain `() => Promise<"UP" | "DOWN">` functions, which is what `@hmcts-cft/cloud-native-platform`'s
 * `HealthCheck` is — so the domain needs no dependency on the app framework to supply them.
 */
export function deedPollDatabaseChecks(): Record<string, () => Promise<"UP" | "DOWN">> {
  return {
    postgres: guarded(async () => {
      await pgPool.query("select 1");
    }),
    deedPollSchema: guarded(async () => {
      const missing = await missingDeedPollTables();
      if (missing.length === 0) return;

      // `HealthCheck` collapses to UP/DOWN, so these names are logged here or lost — and being paged
      // for "readiness DOWN" with no further detail is most of the diagnosis wasted.
      throw new Error(`the deed-poll schema is incomplete, missing: ${missing.join(", ")}. Has the migration job run?`);
    })
  };
}

/**
 * Any throw is DOWN, with the reason logged rather than swallowed as `hc.raw` would — and any wait longer
 * than `CHECK_TIMEOUT_MS` is DOWN too.
 *
 * The bound is not belt-and-braces. `runChecks` in `@hmcts-cft/cloud-native-platform` is a bare
 * `Promise.all`, so a check that never settles hangs `/health/readiness` for the whole outage and takes
 * every sibling result down with it — including the bounded Redis one in `apps/web/src/app.ts`, which is
 * then reported nowhere. And these two checks can hang: `pgPool` is built with `connectionTimeoutMillis`
 * left at its default of `0`, meaning wait forever, so a database that stops answering rather than
 * refusing — an NSG change, a failover, a dropped route — never settles either query. The pool default is
 * deliberately not changed here: that would put a deadline on every application query, including the CCD
 * schema CLI's, to fix a probe. A probe must answer on its own terms; nothing here gives up on Postgres.
 *
 * Which is why the outstanding attempt is **shared rather than restarted, but only for `STALE_ATTEMPT_MS`**.
 * The bound above ends the *probe*, not the query behind it — nothing here can cancel work already handed
 * to `pgPool` — while Kubernetes probes on a fixed period whether the last one answered or not. Started
 * afresh each time, every probe during a blackholed outage would leave another acquisition behind: the
 * pool's ten connections all sit in a connect that never times out, and the pending queue behind them
 * grows for as long as the outage lasts. Reused forever, the opposite failure: readiness is then pinned to
 * one attempt that may never settle, and since only *that* attempt holds a connection the database coming
 * back would be invisible — nine connections free, and nothing asking. Liveness carries no database check,
 * so nothing restarts the pod either. Rotating on staleness keeps both bounded: at most one attempt per
 * minute of outage, and readiness follows the database back inside a minute of it answering again.
 */
function guarded(check: () => Promise<void>): () => Promise<"UP" | "DOWN"> {
  let outstanding: Attempt | undefined;

  return async () => {
    if (outstanding === undefined || Date.now() - outstanding.startedAt >= STALE_ATTEMPT_MS) {
      const started: Attempt = { status: attempt(check), startedAt: Date.now() };

      // Cleared only while it is still the current attempt: a stale one that settles after being replaced
      // must not discard the fresh attempt standing in for it, or the next probe would start a third.
      void started.status.finally(() => {
        if (outstanding === started) outstanding = undefined;
      });

      outstanding = started;
    }

    // No `catch` here, and none needed: `attempt` reports a rejection as DOWN rather than rethrowing, so
    // the shared promise cannot reject after the timer has won and cannot surface as an unhandled
    // rejection. The timer is unreferenced so a fast check does not hold the event loop open for the rest
    // of the bound.
    const result = await Promise.race([outstanding.status, delay(CHECK_TIMEOUT_MS, TIMED_OUT, { ref: false })]);

    // Logged out here rather than inside the timer branch, which resolves on every call — including the
    // ones the check won — and would otherwise report a healthy database as timed out a bound later.
    if (result === TIMED_OUT) {
      console.error(`Health check failed: no answer within ${CHECK_TIMEOUT_MS}ms`);
      return "DOWN";
    }

    return result;
  };
}

/**
 * The check's own verdict, never a rejection — see `guarded` on why the shared promise must not reject.
 */
async function attempt(check: () => Promise<void>): Promise<"UP" | "DOWN"> {
  try {
    await check();
    return "UP";
  } catch (error) {
    console.error("Health check failed:", error instanceof Error ? error.message : error);
    return "DOWN";
  }
}

/** One in-flight run of a check, with when it started — see `STALE_ATTEMPT_MS` for what that is for. */
interface Attempt {
  status: Promise<"UP" | "DOWN">;
  startedAt: number;
}
