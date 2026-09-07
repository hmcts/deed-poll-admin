import { beforeEach, describe, expect, it, vi } from "vitest";
import { expressSessionRedis } from "./index.js";

vi.mock("connect-redis", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest 4 requires function keyword for constructors
  RedisStore: vi.fn().mockImplementation(function (options) {
    return { redisStoreOptions: options };
  })
}));

vi.mock("express-session", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest 4 requires function keyword for constructors
  default: vi.fn().mockImplementation(function (options) {
    return { sessionOptions: options };
  })
}));

describe("expressSessionRedis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SESSION_SECRET;
    delete process.env.NODE_ENV;
  });

  it("should use default secret when none is provided", () => {
    const mockRedisClient = { connect: vi.fn() };

    const middleware = expressSessionRedis({ redisConnection: mockRedisClient });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "default-secret-change-in-production"
      })
    });
  });

  it("should create session middleware with default options", () => {
    process.env.SESSION_SECRET = "test-secret";
    const mockRedisClient = { connect: vi.fn() };

    const middleware = expressSessionRedis({
      redisConnection: mockRedisClient
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
        cookie: expect.objectContaining({
          secure: false,
          httpOnly: true,
          maxAge: 1000 * 60 * 60 * 4
        }),
        store: expect.objectContaining({
          redisStoreOptions: expect.objectContaining({
            client: mockRedisClient,
            prefix: "sess:"
          })
        })
      })
    });
  });

  it("should use SESSION_SECRET from environment", () => {
    process.env.SESSION_SECRET = "my-secret-key";
    const mockRedisClient = { connect: vi.fn() };

    const middleware = expressSessionRedis({
      redisConnection: mockRedisClient
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "my-secret-key"
      })
    });
  });

  it("should set secure cookie in production", () => {
    process.env.SESSION_SECRET = "test-secret";
    process.env.NODE_ENV = "production";
    const mockRedisClient = { connect: vi.fn() };

    const middleware = expressSessionRedis({
      redisConnection: mockRedisClient
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        cookie: expect.objectContaining({
          secure: true
        })
      })
    });
  });

  it("should allow custom store options", () => {
    process.env.SESSION_SECRET = "test-secret";
    const mockRedisClient = { connect: vi.fn() };

    const middleware = expressSessionRedis({
      redisConnection: mockRedisClient,
      storeOptions: {
        prefix: "myapp:",
        ttl: 3600,
        disableTouch: true
      }
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        store: expect.objectContaining({
          redisStoreOptions: expect.objectContaining({
            client: mockRedisClient,
            prefix: "myapp:",
            ttl: 3600,
            disableTouch: true
          })
        })
      })
    });
  });

  it("should allow custom session options to override defaults", () => {
    const mockRedisClient = { connect: vi.fn() };

    const middleware = expressSessionRedis({
      redisConnection: mockRedisClient,
      sessionOptions: {
        secret: "custom-secret",
        resave: true,
        cookie: {
          httpOnly: false,
          maxAge: 1000 * 60 * 30 // 30 minutes
        }
      }
    });

    expect(middleware).toEqual({
      sessionOptions: expect.objectContaining({
        secret: "custom-secret",
        resave: true,
        cookie: expect.objectContaining({
          httpOnly: false,
          maxAge: 1000 * 60 * 30
        })
      })
    });
  });

  it("should work with any Redis client implementation", () => {
    process.env.SESSION_SECRET = "test-secret";

    const ioredisClient = {
      connect: vi.fn(),
      set: vi.fn(),
      get: vi.fn()
    };

    const middleware1 = expressSessionRedis({
      redisConnection: ioredisClient
    });

    expect(middleware1).toBeDefined();

    const nodeRedisClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn()
    };

    const middleware2 = expressSessionRedis({
      redisConnection: nodeRedisClient
    });

    expect(middleware2).toBeDefined();
  });
});
