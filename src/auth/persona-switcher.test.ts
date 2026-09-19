import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONA_SWITCHER_ENVIRONMENTS, personaSwitcherEnabled } from "./persona-switcher.js";

/**
 * `config` resolves the environment once, when it is first imported, so the real package cannot be steered
 * from a test by setting `process.env`. Mocking it is also the closer test: what matters is which pair of
 * resolved values opens the gate, not how node-config arrived at them.
 */
const settings = vi.hoisted(() => new Map<string, unknown>());

vi.mock("config", () => ({
  default: {
    get: (key: string) => {
      if (!settings.has(key)) throw new Error(`Configuration property "${key}" is not defined`);
      return settings.get(key);
    }
  }
}));

describe("personaSwitcherEnabled", () => {
  beforeEach(() => {
    settings.clear();
  });

  it("should permit the switcher in development, test, aat and preview, and nowhere else", () => {
    expect([...PERSONA_SWITCHER_ENVIRONMENTS].sort()).toEqual(["aat", "development", "preview", "test"]);
  });

  it.each([...PERSONA_SWITCHER_ENVIRONMENTS])("should enable it in %s when the chart flag is on", (environmentName) => {
    settings.set("personaSwitcher.enabled", true);
    settings.set("environmentName", environmentName);

    expect(personaSwitcherEnabled()).toBe(true);
  });

  // The point of the allowlist, and the assertions that fail if someone "simplifies" it to
  // `!== "production"`. Every deployed pod runs as `NODE_ENV=production`, so these environment names are the
  // only thing that tells one deployment from another.
  it.each(["production", "prod", "demo", "ithc", "perftest", "staging", ""])("should refuse it in %o even with the chart flag on", (environmentName) => {
    settings.set("personaSwitcher.enabled", true);
    settings.set("environmentName", environmentName);

    expect(personaSwitcherEnabled()).toBe(false);
  });

  it.each([...PERSONA_SWITCHER_ENVIRONMENTS])("should refuse it in %s while the chart flag is off, which is the default", (environmentName) => {
    settings.set("personaSwitcher.enabled", false);
    settings.set("environmentName", environmentName);

    expect(personaSwitcherEnabled()).toBe(false);
  });

  // Without `__format: "json"` in `config/custom-environment-variables.json`, `PERSONA_SWITCHER_ENABLED`
  // arrives as a string — and `"false"` is truthy, so a values file that turned the switcher *off* would turn
  // it on. Fail closed on anything that is not a real boolean.
  it.each(["true", "false", 1, "yes"])("should refuse a flag of %o, which is not the boolean the mapping declares", (enabled) => {
    settings.set("personaSwitcher.enabled", enabled);
    settings.set("environmentName", "aat");

    expect(personaSwitcherEnabled()).toBe(false);
  });
});
