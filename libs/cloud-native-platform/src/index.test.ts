import { describe, expect, it } from "vitest";
import { hc, healthcheck } from "./index.js";

describe("healthcheck export", () => {
  it("should expose all healthcheck functions", () => {
    expect(healthcheck).toBeDefined();
    expect(healthcheck).toBeInstanceOf(Function); // healthcheck is the configure function
    expect(hc.web).toBeInstanceOf(Function);
    expect(hc.raw).toBeInstanceOf(Function);
    expect(hc.up).toBeInstanceOf(Function);
    expect(hc.down).toBeInstanceOf(Function);
  });

  it("should create working health checks", async () => {
    const webCheck = hc.web("https://example.com");
    expect(webCheck).toBeInstanceOf(Function);

    const rawCheck = hc.raw(() => hc.up());
    expect(await rawCheck()).toBe("UP");

    const middleware = healthcheck({
      checks: {
        test: hc.raw(() => hc.down())
      }
    });
    expect(middleware).toBeInstanceOf(Function);
  });
});
