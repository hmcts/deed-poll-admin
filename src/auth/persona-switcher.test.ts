import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_JUDICIAL } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { PERSONA_SWITCH_PATH, PERSONA_SWITCHER_ENVIRONMENTS, PERSONAS, personaFor, personaSwitcherEnabled, personaSwitcherLocals } from "./persona-switcher.js";
import { personaState, switcherUnavailableReason } from "./persona-users.js";

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

/**
 * `persona-users.js` is stubbed at its two read-only functions, and only those.
 *
 * What a persona resolves to and why one is refused is that file's subject, pinned against real IDAM failures
 * in `persona-users.test.ts`. What is worth pinning *here* is that the strip renders whatever it reports —
 * including the two states no local environment produces, an unpublished role and an unregistered grant type.
 * Driving those through the real classification would mean failing a mocked token request to assert on markup.
 */
vi.mock("./persona-users.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./persona-users.js")>()),
  personaState: vi.fn(),
  switcherUnavailableReason: vi.fn()
}));

describe("personaSwitcherEnabled", () => {
  beforeEach(() => {
    settings.clear();
  });

  it("should permit the switcher in development, test and aat, and nowhere else", () => {
    expect([...PERSONA_SWITCHER_ENVIRONMENTS].sort()).toEqual(["aat", "development", "test"]);
  });

  it.each([...PERSONA_SWITCHER_ENVIRONMENTS])("should enable it in %s when the chart flag is on", (environmentName) => {
    settings.set("personaSwitcher.enabled", true);
    settings.set("environmentName", environmentName);

    expect(personaSwitcherEnabled()).toBe(true);
  });

  // The point of the allowlist, and the assertions that fail if someone "simplifies" it to
  // `!== "production"`. Every deployed pod runs as `NODE_ENV=production`, so these environment names are the
  // only thing that tells one deployment from another.
  it.each(["production", "prod", "demo", "ithc", "perftest", "staging", "preview", ""])("should refuse it in %o even with the chart flag on", (environmentName) => {
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
    // The ordinary state: every persona has a user here and none has been refused. Individual tests below
    // replace this to describe an environment that cannot offer one.
    vi.mocked(personaState).mockImplementation((persona) => ({ username: persona.fixtureUsername, isAvailable: true }));
    vi.mocked(switcherUnavailableReason).mockReturnValue(undefined);
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
    expect(view.personas.filter((persona) => persona.isCurrent)).toEqual([
      { id: "judge", name: "Judge", isCurrent: true, isAvailable: true, reason: undefined }
    ]);
  });

  it("should offer every persona to an admin", () => {
    const view = locals({ admin: true, subject: "admin@example.com" }).personaSwitcher as { personas: { id: string }[] };

    expect(view.personas.map((persona) => persona.id)).toEqual(PERSONAS.map((persona) => persona.id));
  });

  // Task 5's visible half. The judicial role does not exist in AAT until `idam-access-config#995` merges, and
  // a button that fails at IDAM looks exactly like a defect in the switcher — so the persona is stated as
  // unavailable, with the reason, and carries no button to press.
  it("should offer no button for a persona this environment cannot provide, and pass its reason through", () => {
    vi.mocked(personaState).mockImplementation((persona) =>
      persona.id === "judge"
        ? { isAvailable: false, unavailableReason: "The judicial role does not exist in this environment." }
        : { username: persona.fixtureUsername, isAvailable: true }
    );

    const view = locals({ subject: "caseworker@example.com" }).personaSwitcher as {
      personas: { id: string; isAvailable: boolean; reason?: string }[];
    };

    expect(view.personas).toMatchObject([
      { id: "caseworker", isAvailable: true, reason: undefined },
      { id: "admin", isAvailable: true, reason: undefined },
      { id: "judge", isAvailable: false, reason: "The judicial role does not exist in this environment." }
    ]);
  });

  // One fact and not three. A client registered for neither grant type refuses every persona identically, so
  // repeating the sentence against each name would bury which persona each line was about.
  it("should state a switcher-wide refusal once and offer no personas at all", () => {
    vi.mocked(switcherUnavailableReason).mockReturnValue("IDAM will not issue a token from a username and password for this client here.");

    expect(locals({ subject: "caseworker@example.com" }).personaSwitcher).toMatchObject({
      notice: "IDAM will not issue a token from a username and password for this client here.",
      personas: []
    });
  });

  // The strip still renders, because it is where the reason is said. An absent strip would report the same
  // state as a shut gate, which is the one thing it must not be confused with.
  it("should still render the strip when nothing can be switched to", () => {
    vi.mocked(switcherUnavailableReason).mockReturnValue("A reason.");

    expect(locals({ subject: "caseworker@example.com" }).personaSwitcher).toBeDefined();
  });

  // AAT before this pod has resolved anybody: `personaState` knows no username, so no persona is claimed to be
  // the one signed in. The tester is themselves, which is neither a persona nor an error.
  it("should mark no persona as current when none has a known user here", () => {
    vi.mocked(personaState).mockImplementation(() => ({ isAvailable: true }));

    const view = locals({ subject: "a.tester@justice.gov.uk" }).personaSwitcher as { personas: { isCurrent: boolean }[] };

    expect(view.personas.some((persona) => persona.isCurrent)).toBe(false);
  });

  // IDAM does not promise to hand back the subject in the case the account was created with, and the two
  // failures either side of this are indistinguishable from legitimate renderings: without the
  // normalisation the judge is offered a "Switch to Judge" button, which is also what a real user correctly
  // sees, so nothing but this test says which happened.
  it("should mark the persona current when the subject differs only in case", () => {
    const view = locals({ subject: "Judge@Example.com" }).personaSwitcher as { personas: { id: string; isCurrent: boolean }[] };

    expect(view.personas.filter((persona) => persona.isCurrent).map((persona) => persona.id)).toEqual(["judge"]);
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

/**
 * The local fixtures, pinned against the script that creates them.
 *
 * Three files name the same accounts — `PERSONAS` here, `personaSwitcher.password` in
 * `config/default.json`, and `scripts/seed-idam-users.mjs` — and nothing relates them, which is how a copy
 * of one of these strings has already drifted once in this repo. Drift fails closed and *lies about why*:
 * IDAM answers `invalid_grant` for a renamed account and for a changed password alike, so a tester is told
 * `yarn idam:users` has not been run when it has. Read as text rather than imported because the seeder is a
 * script with top-level `await fetch`, which importing would execute.
 */
describe("the seeded fixtures", () => {
  const seeder = readFileSync(path.join(fileURLToPath(import.meta.url), "../../../scripts/seed-idam-users.mjs"), "utf8");

  it.each(PERSONAS.map((persona) => persona.fixtureUsername))("should be created by yarn idam:users (%s)", (username) => {
    expect(seeder).toContain(username);
  });

  it("should be seeded with the password the switcher signs in with", () => {
    const defaults = JSON.parse(readFileSync(path.join(fileURLToPath(import.meta.url), "../../../config/default.json"), "utf8")) as {
      personaSwitcher: { password: string };
    };

    expect(seeder).toContain(defaults.personaSwitcher.password);
  });
});

/**
 * The lookup a request body goes through, and the security property that rests on it: the set of identities
 * this service will ever obtain a token for is `PERSONAS` and a request cannot widen it.
 */
describe("personaFor", () => {
  it("should resolve each offered persona by its id, with the roles that define it", () => {
    expect(personaFor("judge")).toMatchObject({ name: "Judge", roleNames: [DEEDPOLL_JUDICIAL] });
    expect(personaFor("admin")).toMatchObject({ name: "Caseworker with admin", roleNames: [DEEDPOLL_ADMIN] });
    expect(personaFor("caseworker")).toMatchObject({ name: "Caseworker", roleNames: [DEEDPOLL_CASEWORKER] });
  });

  // Whatever arrives in a form body, including the shapes a crafted request uses. An id that matches nothing
  // yields no persona rather than a guess, and the caller answers 404 — so nothing says which ids exist.
  it.each([["root"], ["someone@example.com"], [["judge"]], [undefined], [{ id: "judge" }], [""]])("should refuse %o", (id) => {
    expect(personaFor(id)).toBeUndefined();
  });
});
