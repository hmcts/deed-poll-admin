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
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [] });

    store = new PostgresStore({
      pool: mockPool as any,
      tableName: "test_session",
      schemaName: "public",
      ttl: 3600,
      cleanupInterval: 0 // Disable auto cleanup for tests
    });

    // Wait for initialization to complete
    await new Promise((resolve) => setImmediate(resolve));
  });

  afterEach(() => {
    store.stopCleanup();
  });

  describe("constructor", () => {
    it("should throw error if pool is not provided", () => {
      expect(() => new PostgresStore({} as any)).toThrow("PostgreSQL connection pool is required");
    });

    it("should set default values", () => {
      const defaultStore = new PostgresStore({
        pool: mockPool as any,
        cleanupInterval: 0
      });
      expect(defaultStore).toBeDefined();
    });

    it("should initialize table on construction", async () => {
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
      const touchStore = new PostgresStore({
        pool: mockPool as any,
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

  describe("clearExpiredSessions", () => {
    it("should create store with cleanup interval", () => {
      const storeWithCleanup = new PostgresStore({
        pool: mockPool as any,
        cleanupInterval: 1000
      });

      expect(storeWithCleanup).toBeDefined();
      storeWithCleanup.stopCleanup();
    });
  });
});
