/**
 * Pins the one thing about `server.ts` that nothing else can see: the key vault secrets are loaded
 * **before** the application graph is imported.
 *
 * That ordering is the whole mechanism, not a tidiness preference — see ./secrets.ts. Turning the dynamic
 * `import("./app.js")` back into a static import is a one-line change that leaves every other test green,
 * every page working locally, and every deployed pod reading `config/default.json`'s placeholders instead
 * of its vault.
 *
 * Monitoring sits between the two for the second reason the app is imported late: Application Insights
 * collects no requests unless it starts before express is loaded, and the app's graph is what loads it.
 */
import { describe, expect, it, vi } from "vitest";

const order = vi.hoisted(() => [] as string[]);

vi.mock("./secrets.js", () => ({
  loadSecrets: vi.fn(async () => {
    order.push("secrets");
    return {};
  })
}));

// Only startMonitoring: server.ts uses nothing else from the package, and the real one loads the SDK.
vi.mock("@hmcts-cft/cloud-native-platform", () => ({
  startMonitoring: vi.fn(() => {
    order.push("monitoring");
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
  it("should load the secrets, then start monitoring, then import the app", async () => {
    await import("./server.js");

    expect(order).toEqual(["secrets", "monitoring", "app"]);
  });
});
