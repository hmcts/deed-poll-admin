/**
 * The "too many requests" page's markup. `src/errors.test.ts` pins the status, the header and the model; this pins
 * the sentence the caseworker reads, which is the difference between "wait" and "the service is broken".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";
import { content as cy } from "../../locales/cy.js";
import { content as en } from "../../locales/en.js";
import { addPathFilters } from "../../path-filters.js";

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
addPathFilters(environment);

// The locale content reaches the template through `res.locals`, so it goes first and the handler's model over it.
const html = (model: Record<string, unknown>, locale: typeof en = en): string => environment.render("errors/429.njk", { ...locale, ...model });

describe("errors/429.njk", () => {
  it("should extend the app's layout, so the page keeps the persona switcher", () => {
    const template = readFileSync(path.join(HERE, "429.njk"), "utf8");

    expect(template).toMatch(/^{% extends "layouts\/app\.njk" %}/);
  });

  it("should title the browser tab with the heading, so the page's purpose is announced", () => {
    const page = html({ retryAfterMinutes: null });

    expect(page).toMatch(new RegExp(`<title[^>]*>\\s*${en.tooManyRequests.heading} - `));
  });

  it("should tell the caseworker how many minutes to wait when the wait is known", () => {
    const page = html({ retryAfterMinutes: 3 });

    expect(page).toContain(en.tooManyRequests.heading);
    expect(page).toContain("Try again in 3 minutes.");
    expect(page).not.toContain(en.tooManyRequests.tryAgainLater);
  });

  it("should use the singular for a one-minute wait", () => {
    expect(html({ retryAfterMinutes: 1 })).toContain("Try again in 1 minute.");
  });

  it("should say to try again later when the wait is unknown", () => {
    const page = html({ retryAfterMinutes: null });

    expect(page).toContain(en.tooManyRequests.tryAgainLater);
    expect(page).not.toContain("Try again in");
  });

  it("should render the Welsh copy for a Welsh session", () => {
    const page = html({ retryAfterMinutes: 3 }, cy);

    expect(page).toContain(cy.tooManyRequests.heading);
    expect(page).toContain(cy.tooManyRequests.tryAgainInMinutes.replace("{minutes}", "3"));
  });
});
