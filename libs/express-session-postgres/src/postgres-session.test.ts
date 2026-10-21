import session, { Store } from "express-session";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expressSessionPostgres } from "./postgres-session.js";
import { PostgresStore } from "./postgres-store.js";

vi.mock("./postgres-store.js", () => ({
  PostgresStore: {
    create: vi.fn()
  }
}));

vi.mock("express-session", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest 4 requires function keyword for constructors
  default: vi.fn().mockImplementation(function (options) {
    return { sessionOptions: options };
  }),
  Store: class {}
}));

describe("expressSessionPostgres", () => {
  const mockPool = { connect: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the options visible in the middleware mock for assertions.
    vi.mocked(PostgresStore.create).mockImplementation(async (options) => Object.assign(new Store(), { pgStoreOptions: options }) as PostgresStore);
    delete process.env.SESSION_SECRET;
    delete process.env.NODE_ENV;
  });

  it("should use default secret when none is provided", async () => {
    const middleware = await expressSessionPostgres({ pgConnection: mockPool as unknown as Pool });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "default-secret-change-in-production"
      })
    });
  });

  it("should create session middleware with default options", async () => {
    process.env.SESSION_SECRET = "test-secret";

    const middleware = await expressSessionPostgres({
      pgConnection: mockPool as unknown as Pool
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
        cookie: expect.objectContaining({
          secure: false,
          httpOnly: true,
          maxAge: 1000 * 60 * 60 * 24
        }),
        store: expect.objectContaining({
          pgStoreOptions: expect.objectContaining({
            pool: mockPool
          })
        })
      })
    });
  });

  it("should use SESSION_SECRET from environment", async () => {
    process.env.SESSION_SECRET = "pg-secret";

    const middleware = await expressSessionPostgres({
      pgConnection: mockPool as unknown as Pool
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "pg-secret"
      })
    });
  });

  it("should set secure cookie in production", async () => {
    process.env.SESSION_SECRET = "test-secret";
    process.env.NODE_ENV = "production";

    const middleware = await expressSessionPostgres({
      pgConnection: mockPool as unknown as Pool
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        cookie: expect.objectContaining({
          secure: true
        })
      })
    });
  });

  it("should allow custom store options", async () => {
    process.env.SESSION_SECRET = "test-secret";

    const middleware = await expressSessionPostgres({
      pgConnection: mockPool as unknown as Pool,
      storeOptions: {
        tableName: "custom_sessions",
        schemaName: "app",
        ttl: 7200
      }
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        store: expect.objectContaining({
          pgStoreOptions: expect.objectContaining({
            pool: mockPool,
            tableName: "custom_sessions",
            schemaName: "app",
            ttl: 7200
          })
        })
      })
    });
  });

  it("should allow custom cookie maxAge", async () => {
    process.env.SESSION_SECRET = "test-secret";

    const middleware = await expressSessionPostgres({
      pgConnection: mockPool as unknown as Pool,
      cookieMaxAge: 1000 * 60 * 60 * 2
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        cookie: expect.objectContaining({
          maxAge: 1000 * 60 * 60 * 2
        })
      })
    });
  });

  it("should accept secret via sessionOptions without env var", async () => {
    const middleware = await expressSessionPostgres({
      pgConnection: mockPool as unknown as Pool,
      sessionOptions: {
        secret: "options-secret"
      }
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "options-secret"
      })
    });
  });

  it("waits for the initialized store before creating middleware", async () => {
    const initialized = Promise.withResolvers<PostgresStore>();
    vi.mocked(PostgresStore.create).mockReturnValueOnce(initialized.promise);
    const creating = expressSessionPostgres({ pgConnection: mockPool as unknown as Pool });
    await Promise.resolve();
    expect(session).not.toHaveBeenCalled();

    const store = new Store() as PostgresStore;
    initialized.resolve(store);
    await creating;
    expect(session).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ store }));
  });

  it("propagates initialization errors without creating middleware", async () => {
    const error = new Error("Database setup failed");
    vi.mocked(PostgresStore.create).mockRejectedValueOnce(error);
    await expect(expressSessionPostgres({ pgConnection: mockPool as unknown as Pool })).rejects.toBe(error);
    expect(session).not.toHaveBeenCalled();
  });
});
