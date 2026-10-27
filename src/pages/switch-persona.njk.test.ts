/**
 * The refusal page's markup, which no other test renders.
 *
 * `switch-persona.test.ts` asserts that `res.render` is called with the reason; the template itself was
 * unrendered by anything, and the e2e journey only exercises the success path because the local fixtures
 * always resolve. A renamed variable or a broken `extends` here would show the 500 page at exactly the moment
 * the feature is already refusing — the outcome task 5 exists to prevent.
 *
 * The strip is asserted too, because the guidance ("use the persona switcher above") is only a real
 * instruction if it is there.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";
import { addPathFilters } from "../path-filters.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTER_VIEWS = path.join(HERE, "../../libs/express-govuk-starter/src");

const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    HERE
  ],
  { autoescape: true }
);
addPathFilters(environment);

/** The view model `switch-persona.ts` renders with, refusing the judge for the reason AAT actually gives. */
const REFUSAL = {
  title: "This persona is not available in this environment",
  back: "Back",
  backLink: "/",
  guidance: "Use the persona switcher above to choose another, or carry on as the persona you are now.",
  personaName: "Judge",
  reason: "The caseworker-deedpoll-judicial role does not exist in this environment.",
  personaSwitcher: {
    tag: "Dev only",
    label: "Switch persona",
    switchTo: "Switch to",
    current: "current",
    unavailable: "unavailable",
    action: "/switch-persona",
    personas: [
      { id: "caseworker", name: "Caseworker", isCurrent: true, isAvailable: true },
      { id: "team-leader", name: "Team leader", isCurrent: false, isAvailable: true },
      { id: "delivery-manager", name: "Delivery Manager", isCurrent: false, isAvailable: true },
      { id: "judge", name: "Judge", isCurrent: false, isAvailable: false, reason: "The caseworker-deedpoll-judicial role does not exist in this environment." }
    ]
  }
};

describe("the persona refusal page", () => {
  it("should name the persona and the reason it could not be had", () => {
    const html = environment.render("switch-persona.njk", REFUSAL);

    expect(html).toContain("This persona is not available in this environment");
    expect(html).toContain("Judge: The caseworker-deedpoll-judicial role does not exist in this environment.");
    expect(html).toContain("Use the persona switcher above to choose another");
  });

  // Without the strip the guidance is a gesture: there would be nothing above to use, and the page offers no
  // other way on except the back link.
  it("should carry the switcher, since the guidance points at it", () => {
    const html = environment.render("switch-persona.njk", REFUSAL);

    expect(html).toContain("app-persona-switcher");
    expect(html).toContain('name="persona" value="team-leader"');
    expect(html).toContain('name="persona" value="delivery-manager"');
  });

  // The persona that was just refused must not be offered again here — the handler rebuilds the strip after
  // the attempt precisely so this holds.
  it("should not offer a button for the persona it is refusing", () => {
    const html = environment.render("switch-persona.njk", REFUSAL);

    expect(html).not.toContain('value="judge"');
    expect(html).toContain("Judge (unavailable)");
  });
});
