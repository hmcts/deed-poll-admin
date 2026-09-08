import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pgPool, prisma } from "@hmcts/postgres-prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEED_POLL_TABLES, deedPollDatabaseChecks, missingDeedPollTables } from "./health.js";

vi.mock("@hmcts/postgres-prisma", () => ({ prisma: { $queryRaw: vi.fn() }, pgPool: { query: vi.fn() } }));

const SCHEMA = fileURLToPath(new URL("../../postgres-prisma/prisma/schema/deed-poll.prisma", import.meta.url));

describe("DEED_POLL_TABLES", () => {
  it("lists exactly the tables the Prisma schema maps", () => {
    // The list cannot be derived — Prisma has no runtime schema introspection — so this is what stops
    // it silently falling behind. A model added without updating it would leave readiness passing on a
    // database that lacks the new table, which is the failure this whole check exists to prevent.
    const mapped = [...readFileSync(SCHEMA, "utf8").matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]);

    expect([...DEED_POLL_TABLES].sort()).toEqual(mapped.sort());
  });
});

describe("missingDeedPollTables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports nothing missing when every table is present", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(DEED_POLL_TABLES.map((table) => ({ table_name: table })) as never);

    expect(await missingDeedPollTables()).toEqual([]);
  });

  it("names the tables that are absent", async () => {
    // An unmigrated database, which `select 1` would pass. The names are the whole point: "readiness
    // DOWN" with no detail is a bad thing to be woken up for.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ table_name: "deedpoll_deedpoll" }] as never);

    const missing = await missingDeedPollTables();

    expect(missing).toContain("deedpoll_notes");
    expect(missing).not.toContain("deedpoll_deedpoll");
    expect(missing).toHaveLength(DEED_POLL_TABLES.length - 1);
  });

  it("reports all of them missing against an empty database", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    expect(await missingDeedPollTables()).toEqual([...DEED_POLL_TABLES]);
  });

  it("ignores tables the query returns that are not ours", async () => {
    // Defensive: the `any()` bind should make this impossible, but a stray row must not be read as
    // satisfying one of ours.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([...DEED_POLL_TABLES.map((table) => ({ table_name: table })), { table_name: "ccd_case_data" }] as never);

    expect(await missingDeedPollTables()).toEqual([]);
  });

  it("propagates a connection failure rather than reporting an unmigrated database", async () => {
    // Two different faults. "Cannot connect" and "connected but unmigrated" want different responses,
    // and flattening them here would lose the distinction the caller logs.
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(missingDeedPollTables()).rejects.toThrow("ECONNREFUSED");
  });

  it("looks in the schema the connection resolves to, not a hardcoded public", async () => {
    // This database also carries a `ccd` schema. A check against the wrong one would be worse than none.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    await missingDeedPollTables();

    expect(vi.mocked(prisma.$queryRaw).mock.calls[0][0].join("?")).toContain("current_schema()");
  });
});

describe("deedPollDatabaseChecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports UP when the database answers and the schema is complete", async () => {
    vi.mocked(pgPool.query).mockResolvedValue({} as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue(DEED_POLL_TABLES.map((table) => ({ table_name: table })) as never);

    const checks = deedPollDatabaseChecks();

    expect(await checks.postgres()).toBe("UP");
    expect(await checks.deedPollSchema()).toBe("UP");
  });

  it("reports DOWN on an unreachable database rather than throwing into the middleware", async () => {
    vi.mocked(pgPool.query).mockRejectedValue(new Error("ECONNREFUSED"));
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("ECONNREFUSED"));

    const checks = deedPollDatabaseChecks();

    expect(await checks.postgres()).toBe("DOWN");
    expect(await checks.deedPollSchema()).toBe("DOWN");
  });

  it("reports DOWN on an unmigrated database, which select 1 alone would pass", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    expect(await deedPollDatabaseChecks().deedPollSchema()).toBe("DOWN");
  });

  /**
   * The bound, and why it is not belt-and-braces: `runChecks` in `@hmcts-cft/cloud-native-platform` is a bare
   * `Promise.all`, so a check that never settles hangs `/health/readiness` and takes every sibling result
   * with it — including the bounded Redis one in `apps/web/src/app.ts`. `pgPool` is built with
   * `connectionTimeoutMillis` at its default of `0`, meaning wait forever, so a database that stops answering
   * rather than refusing is exactly this: a query that neither resolves nor rejects.
   */
  it.each(["postgres", "deedPollSchema"] as const)("reports DOWN when the %s query never settles", async (check) => {
    vi.mocked(pgPool.query).mockReturnValue(new Promise(() => {}) as never);
    vi.mocked(prisma.$queryRaw).mockReturnValue(new Promise(() => {}) as never);

    await expect(deedPollDatabaseChecks()[check]()).resolves.toBe("DOWN");
  });

  it("leaves only one query outstanding while the database is not answering", async () => {
    // The bound above ends the probe, not the query behind it, and nothing here can cancel work already
    // handed to `pgPool`. Kubernetes probes on a fixed period regardless, so restarting the query each
    // time would leave one more acquisition behind on every probe for the length of the outage — against
    // a pool of ten whose `connectionTimeoutMillis` is `0`, and a pending queue with no bound at all.
    vi.mocked(pgPool.query).mockReturnValue(new Promise(() => {}) as never);
    const checks = deedPollDatabaseChecks();

    // Concurrently rather than in sequence only to keep the test to one bound rather than three — the
    // reuse being pinned is the same either way, since the first query never settles to release it.
    const statuses = await Promise.all([checks.postgres(), checks.postgres(), checks.postgres()]);

    expect(statuses).toEqual(["DOWN", "DOWN", "DOWN"]);
    expect(pgPool.query).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh query once the outstanding one has been unanswered for a minute", async () => {
    // Reuse bounded, because reuse without a bound is the worse failure: liveness carries no database
    // check, so readiness pinned to an attempt that never settles is a pod out of the Service until
    // someone restarts it by hand — while the other nine pool connections sit idle and nothing asks.
    // Only `Date` is faked — the bound is a `node:timers/promises` sleep, which vitest's fake timers do
    // not patch, so faking the lot would leave the first probe waiting on a timer nothing advances.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.mocked(pgPool.query).mockReturnValue(new Promise(() => {}) as never);
      const checks = deedPollDatabaseChecks();

      expect(await checks.postgres()).toBe("DOWN");

      // Past the staleness window, and the database is answering again — which nothing but a fresh query
      // can discover, since the first one is still holding its connection and will never settle.
      vi.setSystemTime(Date.now() + 60_000);
      vi.mocked(pgPool.query).mockResolvedValue({} as never);

      expect(await checks.postgres()).toBe("UP");
      expect(pgPool.query).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it("queries again once the outstanding one has settled", async () => {
    // The other half of the same decision: sharing must not turn into caching. A check that answered has
    // to be asked again, or readiness would report the first probe's verdict forever.
    vi.mocked(pgPool.query).mockResolvedValue({} as never);
    const checks = deedPollDatabaseChecks();

    expect(await checks.postgres()).toBe("UP");

    vi.mocked(pgPool.query).mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await checks.postgres()).toBe("DOWN");
    expect(pgPool.query).toHaveBeenCalledTimes(2);
  });
});
