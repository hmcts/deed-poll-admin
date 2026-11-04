import { spawnSync } from "node:child_process";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresStore } from "./postgres-store.js";

const mockPool = {
  connect: vi.fn()
};

const mockClient = {
  query: vi.fn(),
  release: vi.fn()
};

describe("PostgresStore", () => {
  let store: PostgresStore;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [] });

    store = await PostgresStore.create({
      pool: mockPool as unknown as Pool,
      tableName: "test_session",
      schemaName: "public",
      ttl: 3600,
      cleanupInterval: 0 // Disable auto cleanup for tests
    });
  });

  afterEach(() => {
    store.stopCleanup();
    vi.useRealTimers();
  });

  describe("create", () => {
    it("should reject if pool is not provided", async () => {
      await expect(PostgresStore.create({})).rejects.toThrow("PostgreSQL connection pool is required");
    });

    it("should use the default table name", async () => {
      const defaultStore = await PostgresStore.create({
        pool: mockPool as unknown as Pool,
        cleanupInterval: 0
      });
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS public.session"));
      defaultStore.stopCleanup();
    });

    it("should initialize the table and index before returning", async () => {
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS"));
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("CREATE INDEX IF NOT EXISTS"));
    });
  });

  describe("get", () => {
    it.each(["stored session", "missing session"])("returns void and delivers %s once after releasing the client", async (outcome) => {
      vi.clearAllMocks();
      const sessionData = { cookie: { maxAge: 3600000 }, userId: "123" };
      const rows = outcome === "stored session" ? [{ sess: sessionData }] : [];
      const result = Promise.withResolvers<{ rows: typeof rows }>();
      mockClient.query.mockReturnValueOnce(result.promise);
      const callback = vi.fn();

      expect(store.get("session123", callback)).toBeUndefined();
      await nextTurn();
      expect(mockClient.query).toHaveBeenCalledExactlyOnceWith("SELECT sess FROM public.test_session WHERE sid = $1 AND expire > NOW()", ["session123"]);
      expect(callback).not.toHaveBeenCalled();
      expect(mockClient.release).not.toHaveBeenCalled();

      result.resolve({ rows });
      await nextTurn();
      expect(callback).toHaveBeenCalledExactlyOnceWith(null, outcome === "stored session" ? sessionData : null);
      expect(callback.mock.calls[0][1]).toBe(outcome === "stored session" ? sessionData : null);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(mockClient.release.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0]);
    });

    it.each(["connection", "query"])("delivers a %s failure exactly once without a session", async (stage) => {
      vi.clearAllMocks();
      const error = new Error("Database unavailable");
      if (stage === "connection") mockPool.connect.mockRejectedValueOnce(error);
      else mockClient.query.mockRejectedValueOnce(error);
      const callback = vi.fn();

      store.get("session123", callback);
      await nextTurn();

      expect(callback).toHaveBeenCalledExactlyOnceWith(error);
      expect(mockClient.query).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
      expect(mockClient.release).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
      if (stage === "query") {
        expect(mockClient.release.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0]);
      }
    });

    it.each(["stored session", "missing session", "query failure"])("keeps a throwing consumer separate after %s", (outcome) => {
      // Real uncaught consumer errors must be isolated from Vitest's own exception handlers.
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
        import { PostgresStore } from ${JSON.stringify(new URL("./postgres-store.ts", import.meta.url).href)};
        let calls = 0;
        let releases = 0;
        const client = { query: async () => ({ rows: [] }), release: () => { releases++; } };
        const store = await PostgresStore.create({ pool: { connect: async () => client }, cleanupInterval: 0 });
        releases = 0;
        const outcome = ${JSON.stringify(outcome)};
        client.query = async () => {
          if (outcome === "query failure") throw new Error("Read failed");
          return { rows: outcome === "stored session" ? [{ sess: { userId: "123" } }] : [] };
        };
        process.on("uncaughtExceptionMonitor", (error, origin) => {
          console.log(JSON.stringify({ message: error.message, origin, calls, releases }));
        });
        store.get("session123", () => { calls++; throw new Error("Consumer failed"); });
      `
        ],
        { encoding: "utf8", timeout: 5000 }
      );

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(JSON.parse(run.stdout.trim())).toEqual({ message: "Consumer failed", origin: "uncaughtException", calls: 1, releases: 1 });
    });
  });

  describe("set", () => {
    it("should upsert session with TTL from cookie maxAge", async () => {
      const sessionData = { cookie: { maxAge: 7200000 }, userId: "123" };
      mockClient.query.mockResolvedValue({ rows: [] });

      await new Promise<void>((resolve) => {
        store.set("session123", sessionData, (err) => {
          expect(err).toBeNull();
          expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO"), ["session123", JSON.stringify(sessionData), expect.any(Date)]);
          resolve();
        });
      });
    });

    it("should handle errors", async () => {
      const error = new Error("Database error");
      mockClient.query.mockRejectedValueOnce(error);

      await new Promise<void>((resolve) => {
        store.set("session123", {}, (err) => {
          expect(err).toBe(error);
          resolve();
        });
      });
    });
  });

  describe("destroy", () => {
    it("should delete session from database", async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await new Promise<void>((resolve) => {
        store.destroy("session123", (err) => {
          expect(err).toBeNull();
          expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM"), ["session123"]);
          resolve();
        });
      });
    });
  });

  describe("touch", () => {
    it.each([
      { source: "cookie maxAge", sessionData: { cookie: { maxAge: 7200000 } }, seconds: 7200 },
      { source: "store TTL", sessionData: {}, seconds: 3600 }
    ])("should update session expiration using $source", async ({ sessionData, seconds }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = new Date("2026-10-22T12:00:00Z");
      vi.setSystemTime(now);
      mockClient.query.mockResolvedValue({ rows: [] });
      const callback = vi.fn();

      store.touch("session123", sessionData, callback);
      await nextTurn();

      expect(callback).toHaveBeenCalledExactlyOnceWith(null);
      expect(mockClient.query).toHaveBeenCalledWith("UPDATE public.test_session SET expire = $2 WHERE sid = $1", [
        "session123",
        new Date(now.getTime() + seconds * 1000)
      ]);
    });

    it("should skip if disableTouch is true", async () => {
      const touchStore = await PostgresStore.create({
        pool: mockPool as unknown as Pool,
        disableTouch: true,
        cleanupInterval: 0
      });

      vi.clearAllMocks();

      await new Promise<void>((resolve) => {
        touchStore.touch("session123", {}, (err) => {
          expect(err).toBeNull();
          expect(mockClient.query).not.toHaveBeenCalled();
          resolve();
        });
      });

      touchStore.stopCleanup();
    });

    it("returns void and completes once, after the update settles and the client is released", async () => {
      vi.clearAllMocks();
      const update = Promise.withResolvers<{ rows: never[] }>();
      mockClient.query.mockReturnValueOnce(update.promise);
      const callback = vi.fn();

      expect(store.touch("session123", {}, callback)).toBeUndefined();
      await nextTurn();
      expect(callback).not.toHaveBeenCalled();
      expect(mockClient.release).not.toHaveBeenCalled();

      update.resolve({ rows: [] });
      await nextTurn();
      expect(callback).toHaveBeenCalledExactlyOnceWith(null);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(mockClient.release.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0]);
    });

    it.each(["connection", "query"])("delivers a %s failure to the callback exactly once", async (stage) => {
      vi.clearAllMocks();
      const error = new Error("Database unavailable");
      if (stage === "connection") mockPool.connect.mockRejectedValueOnce(error);
      else mockClient.query.mockRejectedValueOnce(error);
      const callback = vi.fn();

      store.touch("session123", {}, callback);
      await nextTurn();

      expect(callback).toHaveBeenCalledExactlyOnceWith(error);
      expect(mockClient.query).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
      expect(mockClient.release).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
    });

    it.each(["success", "connection failure", "query failure"])("handles %s when the optional callback is omitted", async (outcome) => {
      vi.clearAllMocks();
      if (outcome === "connection failure") mockPool.connect.mockRejectedValueOnce(new Error("No connection"));
      if (outcome === "query failure") mockClient.query.mockRejectedValueOnce(new Error("Update failed"));

      expect(store.touch("session123", {})).toBeUndefined();
      await nextTurn();

      expect(mockPool.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.query).toHaveBeenCalledTimes(outcome === "connection failure" ? 0 : 1);
      expect(mockClient.release).toHaveBeenCalledTimes(outcome === "connection failure" ? 0 : 1);
    });

    it("keeps disabled touch synchronous and does not acquire a client, with or without a callback", async () => {
      const touchStore = await PostgresStore.create({ pool: mockPool as unknown as Pool, disableTouch: true, cleanupInterval: 0 });
      vi.clearAllMocks();
      const callback = vi.fn();

      expect(touchStore.touch("session123", {}, callback)).toBeUndefined();
      expect(callback).toHaveBeenCalledExactlyOnceWith(null);
      expect(touchStore.touch("session123", {})).toBeUndefined();
      expect(mockPool.connect).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
      expect(mockClient.release).not.toHaveBeenCalled();
      touchStore.stopCleanup();
    });

    it.each(["success", "query failure"])("does not retry or turn a throwing callback into a rejected promise after %s", (outcome) => {
      // Isolate the deliberately uncaught consumer error from Vitest's own exception handlers.
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
        import { PostgresStore } from ${JSON.stringify(new URL("./postgres-store.ts", import.meta.url).href)};
        let calls = 0;
        let releases = 0;
        const client = { query: async () => ({ rows: [] }), release: () => { releases++; } };
        const store = await PostgresStore.create({ pool: { connect: async () => client }, cleanupInterval: 0 });
        releases = 0;
        if (${JSON.stringify(outcome)} === "query failure") client.query = async () => { throw new Error("Update failed"); };
        process.on("uncaughtExceptionMonitor", (error, origin) => {
          console.log(JSON.stringify({ message: error.message, origin, calls, releases }));
        });
        store.touch("session123", {}, () => { calls++; throw new Error("Consumer failed"); });
      `
        ],
        { encoding: "utf8", timeout: 5000 }
      );

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(JSON.parse(run.stdout.trim())).toEqual({ message: "Consumer failed", origin: "uncaughtException", calls: 1, releases: 1 });
    });
  });

  describe("clear", () => {
    it("should delete all sessions", async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await new Promise<void>((resolve) => {
        store.clear((err) => {
          expect(err).toBeNull();
          expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM public.test_session"));
          resolve();
        });
      });
    });
  });

  describe("length", () => {
    it("should return number of sessions", async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [{ count: "10" }] });

      await new Promise<void>((resolve) => {
        store.length((err, length) => {
          expect(err).toBeNull();
          expect(length).toBe(10);
          resolve();
        });
      });
    });
  });

  describe("all", () => {
    it("should return all non-expired sessions", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { sid: "sess1", sess: { userId: "1" } },
          { sid: "sess2", sess: { userId: "2" } }
        ]
      });

      await new Promise<void>((resolve) => {
        store.all((err, sessions) => {
          expect(err).toBeNull();
          expect(sessions).toEqual({
            sess1: { userId: "1" },
            sess2: { userId: "2" }
          });
          resolve();
        });
      });
    });

    it("should return empty object when no sessions", async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await new Promise<void>((resolve) => {
        store.all((err, sessions) => {
          expect(err).toBeNull();
          expect(sessions).toEqual({});
          resolve();
        });
      });
    });
  });

  describe("write and enumeration callback contracts", () => {
    const session = { cookie: { maxAge: 7200000 }, userId: "123" };
    type Callback = (error: unknown, value?: unknown) => void;
    const operations = [
      { name: "set", invoke: (s: PostgresStore, cb: Callback) => s.set("session123", session, cb), rows: [], expected: [null] },
      { name: "destroy", invoke: (s: PostgresStore, cb: Callback) => s.destroy("session123", cb), rows: [], expected: [null] },
      { name: "clear", invoke: (s: PostgresStore, cb: Callback) => s.clear(cb), rows: [], expected: [null] },
      { name: "length", invoke: (s: PostgresStore, cb: Callback) => s.length(cb), rows: [{ count: "10" }], expected: [null, 10] },
      {
        name: "all",
        invoke: (s: PostgresStore, cb: Callback) => s.all(cb),
        rows: [{ sid: "session123", sess: session }],
        expected: [null, { session123: session }]
      }
    ];

    describe.each(operations)("$name", ({ invoke, rows, expected }) => {
      it("returns void and delivers the result once after the operation and release", async () => {
        vi.clearAllMocks();
        const query = Promise.withResolvers<{ rows: unknown[] }>();
        mockClient.query.mockReturnValueOnce(query.promise);
        const callback = vi.fn();

        const returned = invoke(store, callback);
        await nextTurn();
        expect(callback).not.toHaveBeenCalled();
        expect(mockClient.release).not.toHaveBeenCalled();
        query.resolve({ rows });
        await nextTurn();

        expect(returned).toBeUndefined();
        expect(callback).toHaveBeenCalledExactlyOnceWith(...expected);
        expect(mockPool.connect).toHaveBeenCalledTimes(1);
        expect(mockClient.query).toHaveBeenCalledTimes(1);
        expect(mockClient.release).toHaveBeenCalledTimes(1);
        expect(mockClient.release.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0]);
      });

      it.each(["connection", "query"])("delivers a %s failure once, after any acquired client is released", async (stage) => {
        vi.clearAllMocks();
        const error = new Error("Database unavailable");
        if (stage === "connection") mockPool.connect.mockRejectedValueOnce(error);
        else mockClient.query.mockRejectedValueOnce(error);
        const callback = vi.fn();

        const returned = invoke(store, callback);
        // Drain the old implementation's rejected return during the source-unchanged regression run.
        await Promise.resolve(returned).catch(() => undefined);
        await nextTurn();

        expect(callback).toHaveBeenCalledExactlyOnceWith(error);
        expect(returned).toBeUndefined();
        expect(mockPool.connect).toHaveBeenCalledTimes(1);
        expect(mockClient.query).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
        expect(mockClient.release).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
        if (stage === "query") {
          expect(mockClient.release.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0]);
        }
      });
    });

    it("delivers a set serialization failure after releasing the client without querying", async () => {
      vi.clearAllMocks();
      const error = new Error("Cannot serialize session");
      const unserializable = {
        toJSON: () => {
          throw error;
        }
      };
      const callback = vi.fn();

      store.set("session123", unserializable, callback);
      await nextTurn();

      expect(callback).toHaveBeenCalledExactlyOnceWith(error);
      expect(mockClient.query).not.toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(mockClient.release.mock.invocationCallOrder[0]).toBeLessThan(callback.mock.invocationCallOrder[0]);
    });

    it.each(operations.flatMap(({ name }) => ["success", "connection failure", "query failure"].map((outcome) => [name, outcome])))(
      "%s keeps a throwing consumer separate after %s",
      (method, outcome) => {
        // Consumer exceptions belong to the caller, never to the database operation's error path.
        const run = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
        import { PostgresStore } from ${JSON.stringify(new URL("./postgres-store.ts", import.meta.url).href)};
        let calls = 0, releases = 0, releasedAtCallback = -1;
        const client = { query: async () => ({ rows: [] }), release: () => { releases++; } };
        const pool = { connect: async () => client };
        const store = await PostgresStore.create({ pool, cleanupInterval: 0 });
        releases = 0;
        const outcome = ${JSON.stringify(outcome)};
        if (outcome === "connection failure") pool.connect = async () => { throw new Error("No connection"); };
        client.query = async () => {
          if (outcome === "query failure") throw new Error("Query failed");
          return { rows: [{ count: "1", sid: "session123", sess: {} }] };
        };
        process.on("uncaughtExceptionMonitor", (error, origin) => {
          console.log(JSON.stringify({ message: error.message, origin, calls, releases, releasedAtCallback }));
        });
        const callback = () => { calls++; releasedAtCallback = releases; throw new Error("Consumer failed"); };
        const invoke = {
          set: () => store.set("session123", {}, callback),
          destroy: () => store.destroy("session123", callback),
          clear: () => store.clear(callback),
          length: () => store.length(callback),
          all: () => store.all(callback)
        };
        invoke[${JSON.stringify(method)}]();
      `
          ],
          { encoding: "utf8", timeout: 5000 }
        );

        expect(run.error).toBeUndefined();
        expect(run.status).toBe(1);
        const releases = outcome === "connection failure" ? 0 : 1;
        expect(JSON.parse(run.stdout.trim())).toEqual({
          message: "Consumer failed",
          origin: "uncaughtException",
          calls: 1,
          releases,
          releasedAtCallback: releases
        });
      }
    );

    it.each([
      ...["set", "destroy", "clear"].flatMap((method) => ["success", "connection failure", "query failure"].map((outcome) => [method, outcome])),
      ["set", "serialization failure"]
    ])("%s handles %s without an optional callback or unhandled rejection", (method, outcome) => {
      const run = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
        import { setImmediate as nextTurn } from "node:timers/promises";
        import { PostgresStore } from ${JSON.stringify(new URL("./postgres-store.ts", import.meta.url).href)};
        let queries = 0, releases = 0, connections = 0;
        const client = { query: async () => ({ rows: [] }), release: () => { releases++; } };
        const pool = { connect: async () => client };
        const store = await PostgresStore.create({ pool, cleanupInterval: 0 });
        releases = 0;
        const outcome = ${JSON.stringify(outcome)};
        pool.connect = async () => {
          connections++;
          if (outcome === "connection failure") throw new Error("No connection");
          return client;
        };
        client.query = async () => {
          queries++;
          if (outcome === "query failure") throw new Error("Query failed");
          return { rows: [] };
        };
        const session = outcome === "serialization failure" ? { toJSON() { throw new Error("Cannot serialize"); } } : {};
        const invoke = { set: () => store.set("session123", session), destroy: () => store.destroy("session123"), clear: () => store.clear() };
        const returned = invoke[${JSON.stringify(method)}]();
        await nextTurn();
        console.log(JSON.stringify({ returnedVoid: returned === undefined, queries, releases, connections }));
      `
        ],
        { encoding: "utf8", timeout: 5000 }
      );

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout.trim())).toEqual({
        returnedVoid: true,
        connections: 1,
        queries: outcome === "connection failure" || outcome === "serialization failure" ? 0 : 1,
        releases: outcome === "connection failure" ? 0 : 1
      });
    });
  });

  describe("initialization lifecycle", () => {
    it("waits for both DDL queries before returning the store and starting cleanup", async () => {
      vi.useFakeTimers();
      vi.clearAllMocks();
      const table = Promise.withResolvers<{ rows: never[] }>();
      const index = Promise.withResolvers<{ rows: never[] }>();
      mockClient.query.mockReturnValueOnce(table.promise).mockReturnValueOnce(index.promise);
      const ready = vi.fn();
      const creating = PostgresStore.create({ pool: mockPool as unknown as Pool, cleanupInterval: 1000 });
      void creating.then(ready);

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(ready).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      table.resolve({ rows: [] });
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(ready).not.toHaveBeenCalled();
      expect(mockClient.release).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      index.resolve({ rows: [] });
      store = await creating;
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
      vi.clearAllMocks();
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockClient.query).toHaveBeenCalledWith("DELETE FROM public.session WHERE expire < NOW()");
      expect(mockClient.release).toHaveBeenCalledTimes(1);

      store.stopCleanup();
      store.stopCleanup();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });

    it.each(["connection", "table", "index"])("propagates %s initialization failures without starting cleanup", async (stage) => {
      vi.useFakeTimers();
      vi.clearAllMocks();
      const error = new Error("Database setup failed");
      if (stage === "connection") {
        mockPool.connect.mockRejectedValueOnce(error);
      } else {
        if (stage === "index") mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockRejectedValueOnce(error);
      }

      await expect(PostgresStore.create({ pool: mockPool as unknown as Pool })).rejects.toBe(error);
      expect(mockClient.release).toHaveBeenCalledTimes(stage === "connection" ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("disables cleanup when the interval is zero", async () => {
      vi.useFakeTimers();
      store = await PostgresStore.create({ pool: mockPool as unknown as Pool, cleanupInterval: 0 });
      vi.clearAllMocks();
      await vi.advanceTimersByTimeAsync(900000);
      expect(vi.getTimerCount()).toBe(0);
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it("cleans up every 15 minutes by default", async () => {
      vi.useFakeTimers();
      store = await PostgresStore.create({ pool: mockPool as unknown as Pool });
      vi.clearAllMocks();
      await vi.advanceTimersByTimeAsync(899999);
      expect(mockClient.query).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(mockClient.query).toHaveBeenCalledWith("DELETE FROM public.session WHERE expire < NOW()");
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });
});
