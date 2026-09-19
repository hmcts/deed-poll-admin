import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { PERSONA_SWITCH_PATH, PERSONA_SWITCHER_ENVIRONMENTS, PERSONAS, personaSwitcherEnabled, personaSwitcherLocals } from "./persona-switcher.js";

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

/**
 * What the layout renders from, and the properties of it that are decisions rather than details.
 *
 * The markup is `src/pages/layouts/app.njk.test.ts`'s subject. This is about what reaches it: nothing at all
 * when the gate is shut or nobody is signed in, and — when it is open — the same three personas for every
 * persona, since a switcher only on the caseworker chrome is a trap door with no way back out (decision 7).
 */
describe("personaSwitcherLocals", () => {
  beforeEach(() => {
    settings.clear();
    settings.set("personaSwitcher.enabled", true);
    settings.set("environmentName", "aat");
  });

  const locals = (options: Parameters<typeof pageRequest>[0] = {}): Record<string, unknown> => {
    const res = pageResponse();
    personaSwitcherLocals()(pageRequest(options), res, vi.fn());
    return res.locals as Record<string, unknown>;
  };

  it("should offer every persona to a caseworker", () => {
    expect(locals({ subject: "caseworker@example.com" }).personaSwitcher).toMatchObject({
      action: PERSONA_SWITCH_PATH,
      personas: [
        { id: "caseworker", name: "Caseworker", isCurrent: true },
        { id: "admin", name: "Caseworker with admin", isCurrent: false },
        { id: "judge", name: "Judge", isCurrent: false }
      ]
    });
  });

  // Decision 7 in the only place it can be pinned: the judge gets the same three options, so the way back to
  // the caseworker screens exists.
  it("should offer every persona to a judge too, so the judicial chrome is not a one-way door", () => {
    const view = locals({ judicial: true, subject: "judge@example.com" }).personaSwitcher as { personas: { id: string; isCurrent: boolean }[] };

    expect(view.personas.map((persona) => persona.id)).toEqual(PERSONAS.map((persona) => persona.id));
    expect(view.personas.filter((persona) => persona.isCurrent)).toEqual([{ id: "judge", name: "Judge", isCurrent: true }]);
  });

  it("should offer every persona to an admin", () => {
    const view = locals({ admin: true, subject: "admin@example.com" }).personaSwitcher as { personas: { id: string }[] };

    expect(view.personas.map((persona) => persona.id)).toEqual(PERSONAS.map((persona) => persona.id));
  });

  // The ordinary case in AAT and for anyone who signed in as themselves rather than as a fixture. No persona
  // is marked, and the switcher is still offered — nothing here decides what may be switched *to*.
  it("should mark no persona as current when the subject is not one of them", () => {
    const view = locals({ subject: "a.real.caseworker@justice.gov.uk" }).personaSwitcher as { personas: { isCurrent: boolean }[] };

    expect(view.personas.some((persona) => persona.isCurrent)).toBe(false);
  });

  // The strip's `{% if personaSwitcher %}` is the whole of the render-time gate, so "off" has to mean absent
  // rather than empty: an assigned-but-falsy value would be one refactor away from rendering.
  it("should assign nothing when the chart flag is off", () => {
    settings.set("personaSwitcher.enabled", false);

    expect(locals({ subject: "judge@example.com" })).toEqual({});
  });

  it("should assign nothing in an environment outside the allowlist", () => {
    settings.set("environmentName", "production");

    expect(locals({ subject: "judge@example.com" })).toEqual({});
  });

  // `/login` and the footer pages are on `requireAuth`'s public allowlist, so they render with no session at
  // all — and offering to change a persona nobody holds yet is an invitation to a 401 from api.
  it("should assign nothing for an anonymous visitor, since there is no persona to change", () => {
    expect(locals({ signedIn: false })).toEqual({});
  });

  it("should always call next, so a shut gate cannot hang a page", () => {
    const next = vi.fn();

    personaSwitcherLocals()(pageRequest({ signedIn: false }), pageResponse(), next);

    expect(next).toHaveBeenCalledOnce();
  });
});
