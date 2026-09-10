/**
 * Pins the one thing about `server.ts` that nothing else can see: the key vault secrets are loaded
 * **before** the application graph is imported.
 *
 * That ordering is the whole mechanism, not a tidiness preference — see ./secrets.ts. Turning the dynamic
 * `import("./app.js")` back into a static import is a one-line change that leaves every other test green,
 * every page working locally, and every deployed pod reading `config/default.json`'s placeholders instead
 * of its vault.
 */
import { describe, expect, it, vi } from "vitest";

const order = vi.hoisted(() => [] as string[]);

vi.mock("./secrets.js", () => ({
  loadSecrets: vi.fn(async () => {
    order.push("secrets");
    return {};
  })
}));

// Recorded in the mock factory rather than inside `createApp`: the factory runs when the module is first
// imported, and it is that moment — not the call — being asserted about.
vi.mock("./app.js", () => {
  order.push("app");

  return {
    createApp: vi.fn(async () => ({
      listen: vi.fn((_port: unknown, callback: () => void) => {
        callback();
        return { close: vi.fn() };
      })
    }))
  };
});

describe("server", () => {
  it("should load the key vault secrets before importing the app, so config does not cache the placeholders", async () => {
    await import("./server.js");

    expect(order).toEqual(["secrets", "app"]);
  });
});
