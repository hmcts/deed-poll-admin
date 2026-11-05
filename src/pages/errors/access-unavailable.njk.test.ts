/**
 * The page the IDAM callback renders when api's `GET /me` could not be asked (OWASP plan 01 Task 6).
 * `src/pages/oauth2/callback.test.ts` pins the 503 and when; this pins that it reads as "try again".
 */
import { readFileSync } from "node:fs";
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

const html = (locale: typeof en = en): string => environment.render("errors/access-unavailable.njk", { ...locale });

describe("errors/access-unavailable.njk", () => {
  it("should extend the app's layout, so the page keeps the persona switcher", () => {
    const template = readFileSync(path.join(HERE, "access-unavailable.njk"), "utf8");

    expect(template).toMatch(/^{% extends "layouts\/app\.njk" %}/);
  });

  it("should say the service could not check access, and link to sign in again", () => {
    const page = html();

    expect(page).toContain(en.staffAccess.unavailableHeading);
    expect(page).toContain(en.staffAccess.unavailableBody);
    expect(page).toMatch(/<a class="govuk-link" href="\/login">Sign in again<\/a>/);
  });

  it("should say it in Welsh under the Welsh locale", () => {
    const page = html(cy);

    expect(page).toContain("Mewngofnodi eto");
    expect(page).not.toContain(en.staffAccess.unavailableBody);
  });
});
