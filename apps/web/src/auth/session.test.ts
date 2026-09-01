import { afterEach, describe, expect, it } from "vitest";
import { assertSessionSecret } from "./session.js";

describe("assertSessionSecret", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("allows the checked-in placeholder locally, where there is nothing to protect", () => {
    process.env.NODE_ENV = "development";

    expect(() => assertSessionSecret("session-secret")).not.toThrow();
  });

  // Not a warning, and not only production. Everything would work, users would log in, and the
  // sessions asserting their roles could be minted by anyone — nothing about running would reveal it.
  it.each(["production", "aat", "preview", "demo", "ithc", ""])("refuses to start on the placeholder under NODE_ENV=%o", (env) => {
    process.env.NODE_ENV = env;

    expect(() => assertSessionSecret("session-secret")).toThrow(/forgeable/);
  });

  it("refuses to start on the placeholder when NODE_ENV is not set at all", () => {
    delete process.env.NODE_ENV;

    expect(() => assertSessionSecret("session-secret")).toThrow(/forgeable/);
  });

  it("accepts a real secret everywhere", () => {
    process.env.NODE_ENV = "production";

    expect(() => assertSessionSecret("a-real-secret-from-the-key-vault")).not.toThrow();
  });
});
