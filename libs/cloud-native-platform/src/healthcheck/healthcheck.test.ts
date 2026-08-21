import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { down, raw, up, web } from "./healthcheck.js";

describe("healthcheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("up/down", () => {
    it("should return UP", () => {
      expect(up()).toBe("UP");
    });

    it("should return DOWN", () => {
      expect(down()).toBe("DOWN");
    });
  });

  describe("web", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return UP for successful response", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true
      } as Response);

      const check = web("https://example.com/health");
      expect(await check()).toBe("UP");
    });

    it("should return DOWN for failed response", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false
      } as Response);

      const check = web("https://example.com/health");
      expect(await check()).toBe("DOWN");
    });

    it("should return DOWN on error", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

      const check = web("https://example.com/health");
      expect(await check()).toBe("DOWN");
    });

    it("should use timeout", async () => {
      const check = web("https://example.com/health", 100);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      await check();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://example.com/health",
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      );
    });
  });

  describe("raw", () => {
    it("should return UP for successful check", async () => {
      const check = raw(() => "UP");
      expect(await check()).toBe("UP");
    });

    it("should return DOWN for failing check", async () => {
      const check = raw(() => "DOWN");
      expect(await check()).toBe("DOWN");
    });

    it("should return UP when check returns void", async () => {
      const check = raw(() => {});
      expect(await check()).toBe("UP");
    });

    it("should return UP for async void", async () => {
      const check = raw(async () => {});
      expect(await check()).toBe("UP");
    });

    it("should return DOWN on error", async () => {
      const check = raw(() => {
        throw new Error("Check failed");
      });
      expect(await check()).toBe("DOWN");
    });

    it("should return DOWN on async error", async () => {
      const check = raw(async () => {
        throw new Error("Check failed");
      });
      expect(await check()).toBe("DOWN");
    });
  });
});
