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
    it("should retrieve session from database", async () => {
      const sessionData = { cookie: { maxAge: 3600000 }, userId: "123" };

      mockClient.query.mockResolvedValueOnce({
        rows: [{ sess: sessionData }]
      });

      await new Promise<void>((resolve) => {
        store.get("session123", (err, session) => {
          expect(err).toBeNull();
          expect(session).toEqual(sessionData);
          expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("SELECT sess FROM"), ["session123"]);
          resolve();
        });
      });
    });

    it("should return null for non-existent session", async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await new Promise<void>((resolve) => {
        store.get("nonexistent", (err, session) => {
          expect(err).toBeNull();
          expect(session).toBeNull();
          resolve();
        });
      });
    });

    it("should handle errors", async () => {
      const error = new Error("Database error");
      mockClient.query.mockRejectedValueOnce(error);

      await new Promise<void>((resolve) => {
        store.get("session123", (err) => {
          expect(err).toBe(error);
          resolve();
        });
      });
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
    it("should update session expiration", async () => {
      const sessionData = { cookie: { maxAge: 3600000 } };
      mockClient.query.mockResolvedValue({ rows: [] });

      await new Promise<void>((resolve) => {
        store.touch("session123", sessionData, (err) => {
          expect(err).toBeNull();
          expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE"), ["session123", expect.any(Date)]);
          resolve();
        });
      });
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
