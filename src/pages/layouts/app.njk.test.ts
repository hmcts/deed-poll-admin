/**
 * The app-owned layout, and the three things about it nothing else would notice going wrong.
 *
 * **That every page actually extends it.** A page left on `layouts/default.njk` renders perfectly — the
 * starter's layout is a complete template — it simply has no switcher, on one page, for whoever happens to
 * open that page. So the sweep below reads `src/pages/**` off the filesystem rather than listing templates,
 * the way `app.test.ts` reads the judicial pages: the failure that matters is the page added *after* this
 * test was written.
 *
 * **That the strip is absent when the gate is shut.** The condition is one `{% if %}` in a partial, and both
 * polarities render without error, so nothing about a page load says which way it went.
 *
 * **That the starter's own layouts are untouched.** They are template-provided (decision 4) and a re-scaffold
 * overwrites them, so an app-specific edit there is lost silently at some later date — which is the whole
 * reason this file exists rather than an edit to `libs/express-govuk-starter`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";
import { content as cy } from "../../locales/cy.js";
import { content as en } from "../../locales/en.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.join(HERE, "..");
const STARTER_VIEWS = path.join(HERE, "../../../libs/express-govuk-starter/src");

const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    PAGES
  ],
  { autoescape: true }
);

/** The strip as `personaSwitcherLocals()` builds it, spelled out here so this file tests the markup only. */
const SWITCHER = {
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
    { id: "judge", name: "Master", isCurrent: false, isAvailable: true }
  ]
};

const APP_LAYOUTS = ["layouts/app.njk", "layouts/app-full-width.njk"];

/** Every page template that extends anything — partials such as `two-column-card.njk` extend nothing. */
function pageTemplates(): { file: string; extended: string }[] {
  return readdirSync(PAGES, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".njk") && !entry.startsWith("layouts"))
    .map((entry) => ({ file: entry, source: readFileSync(path.join(PAGES, entry), "utf8") }))
    .map(({ file, source }) => ({ file, extended: source.match(/{%\s*extends\s*"([^"]+)"/)?.[1] ?? "" }))
    .filter(({ extended }) => extended !== "");
}

describe("the app layout", () => {
  describe.each(APP_LAYOUTS)("sign-out in %s", (layout) => {
    it.each([
      { content: en, label: "Sign out" },
      { content: cy, label: "Allgofnodi" }
    ])("should offer a translated sign-out link ($label) without the development switcher", ({ content, label }) => {
      const html = environment.render(layout, content);

      expect(html.match(/href="\/logout"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`href="/logout"[^>]*>\\s*${label}\\s*</a>`));
      expect(html).not.toContain("/switch-persona");
    });

    it("should keep sign-out in the header, separate from the persona strip", () => {
      const html = environment.render(layout, { ...en, personaSwitcher: SWITCHER });

      expect(html).toContain('href="/logout"');
      expect(html.indexOf('href="/logout"')).toBeLessThan(html.indexOf('action="/switch-persona"'));
      expect(html).toContain('action="/switch-persona"');
    });
  });

  it("should be what every page template extends, including ones added after this test was written", () => {
    const templates = pageTemplates();

    // A guard against the sweep silently finding nothing and the assertion below passing vacuously.
    expect(templates.length).toBeGreaterThanOrEqual(20);

    for (const { file, extended } of templates) {
      expect(APP_LAYOUTS, file).toContain(extended);
    }
  });

  it.each(APP_LAYOUTS)("should render the switcher on %s when the gate has put it on locals", (layout) => {
    const html = environment.render(layout, { personaSwitcher: SWITCHER });

    expect(html).toContain('<form method="post" action="/switch-persona"');
    expect(html).toContain('name="persona" value="judge"');
    expect(html).toContain('name="persona" value="team-leader"');
  });

  // The polarity that matters, and the one with no visible symptom: a page renders either way.
  it.each(APP_LAYOUTS)("should render nothing at all on %s when the gate has left locals empty", (layout) => {
    const html = environment.render(layout, {});

    expect(html).not.toContain("app-persona-switcher");
    expect(html).not.toContain("/switch-persona");
  });

  // Three buttons whose accessible names are "Switch", "Switch" and "Switch" would be no better than a
  // dropdown nobody can describe. The visible label stays the persona's name so the strip holds one line.
  it("should name each button by its persona rather than by the action", () => {
    const html = environment.render("layouts/app.njk", { personaSwitcher: SWITCHER });

    expect(html).toContain('<span class="govuk-visually-hidden">Switch to </span>Master');
  });

  // You cannot switch to who you already are, so the current persona is text. Stated in words and not by
  // position alone, per the accessibility rules.
  it("should state the current persona as text rather than as a button", () => {
    const html = environment.render("layouts/app.njk", { personaSwitcher: SWITCHER });

    expect(html).toContain("Caseworker (current)");
    expect(html).not.toContain('value="caseworker"');
  });

  /**
   * A persona this environment cannot provide — the judicial role before `idam-access-config#995` merges.
   *
   * The reason has to be *on the page*: a button that failed at IDAM, or a persona quietly missing from the
   * strip, both read as a broken switcher. And it must not be a disabled button, which invites a click that
   * does nothing and explains nothing.
   */
  it("should state an unavailable persona and its reason instead of offering a button", () => {
    const html = environment.render("layouts/app.njk", {
      personaSwitcher: {
        ...SWITCHER,
        personas: [
          { id: "caseworker", name: "Caseworker", isCurrent: true, isAvailable: true },
          { id: "team-leader", name: "Team leader", isCurrent: false, isAvailable: true },
          { id: "delivery-manager", name: "Delivery Manager", isCurrent: false, isAvailable: true },
          { id: "judge", name: "Master", isCurrent: false, isAvailable: false, reason: "The judicial role does not exist here." }
        ]
      }
    });

    expect(html).toContain("Master (unavailable)");
    expect(html).toContain("Master: The judicial role does not exist here.");
    expect(html).not.toContain('value="judge"');
    // The personas that do work are untouched by another one's refusal.
    expect(html).toContain('name="persona" value="team-leader"');
  });

  /**
   * No persona at all, which is what an IDAM client registered for neither grant type produces.
   *
   * The form goes with the buttons: there is nothing to post, so leaving one would invite a tester to find
   * that out by pressing something. The strip itself stays, because it is where the reason is.
   */
  it("should replace the form with the notice when nothing can be switched to", () => {
    const html = environment.render("layouts/app.njk", {
      personaSwitcher: { ...SWITCHER, notice: "IDAM will not issue a token for this client here.", personas: [] }
    });

    expect(html).toContain("app-persona-switcher");
    expect(html).toContain("IDAM will not issue a token for this client here.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("/switch-persona");
  });

  // `{{ super() }}` rather than a restatement of the parent block, so everything the starter renders before
  // the content survives. The back link is the part a page supplies, and losing it would be a real
  // regression on every form page.
  it.each(APP_LAYOUTS)("should keep the starter's phase banner and back link on %s", (layout) => {
    const html = environment.render(layout, { phase: "beta", backLink: "/deed-polls", back: "Back" });

    expect(html).toContain("govuk-phase-banner");
    expect(html).toContain('<a href="/deed-polls" class="govuk-back-link">Back</a>');
  });
});

// The timeout warning (OWASP plan 03, Task 7). Markup only; the server decides when a session ends.
describe.each(APP_LAYOUTS)("the session timeout warning in %s", (layout) => {
  const TIMEOUT = { idleSeconds: 1800, idleRemaining: 1750, absoluteRemaining: 33_000 };

  it("should carry the deadlines for the script, in dialogs that are announced as alerts", () => {
    const html = environment.render(layout, { ...en, sessionClock: TIMEOUT });

    expect(html).toContain('data-idle-seconds="1800"');
    expect(html).toContain('data-idle-remaining="1750"');
    expect(html).toContain('data-absolute-remaining="33000"');
    expect(html.match(/<dialog[^>]*role="alertdialog"/g)).toHaveLength(2);
  });

  // The idle warning can be extended; the absolute notice cannot, so it offers no way to stay signed in.
  it("should offer to stay signed in for the idle limit only", () => {
    const html = environment.render(layout, { ...en, sessionClock: TIMEOUT });
    const idle = html.slice(html.indexOf('id="session-timeout-idle"'), html.indexOf('id="session-timeout-absolute"'));
    const absolute = html.slice(html.indexOf('id="session-timeout-absolute"'));

    expect(idle).toContain("Stay signed in");
    expect(idle).toContain('href="/logout"');
    expect(absolute).not.toContain("Stay signed in");
    expect(absolute).toContain("Continue");
  });

  it("should render the warning in Welsh on a Welsh page", () => {
    const html = environment.render(layout, { ...cy, sessionClock: TIMEOUT });

    expect(html).toContain(cy.sessionTimeout.staySignedIn);
    expect(html).not.toContain(en.sessionTimeout.staySignedIn);
  });

  // An anonymous page has nothing to time out, and the dialog would only invite a pointless keep-alive.
  it("should render no warning on a page without a signed-in session", () => {
    expect(environment.render(layout, en)).not.toContain("session-timeout");
  });
});

describe("the starter's layouts", () => {
  // Not a style rule. A re-scaffold overwrites `libs/express-govuk-starter`, so an app-specific edit there is
  // lost with nothing failing — the switcher would simply stop being on any page, at whatever later date
  // somebody re-runs the template.
  it.each(["layouts/default.njk", "layouts/full-width.njk"])("should know nothing about the persona switcher (%s)", (layout) => {
    const source = readFileSync(path.join(STARTER_VIEWS, "govuk-frontend/views", layout), "utf8");

    expect(source).not.toMatch(/persona/i);
  });
});
