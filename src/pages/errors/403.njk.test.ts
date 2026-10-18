/**
 * The 403 page's no-access branch (OWASP plan 01 Task 6). `src/pages/oauth2/callback.test.ts` pins when it is
 * rendered; this pins what the refused user reads, which must not tell them to sign in again.
 */
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

// The locale content reaches the template through `res.locals`, so it goes first and the handler's model over it.
const html = (model: Record<string, unknown>, locale: typeof en = en): string => environment.render("errors/403.njk", { ...locale, ...model });

describe("errors/403.njk", () => {
  it("should tell a user api gives no area to that their account has no access, and not to sign in again", () => {
    const page = html({ refusal: "no-access" });

    expect(page).toContain(en.staffAccess.noAccess);
    expect(page).not.toContain('href="/login"');
  });

  it("should say it in Welsh under the Welsh locale", () => {
    const page = html({ refusal: "no-access" }, cy);

    expect(page).toContain("Nid oes gan eich cyfrif fynediad");
    expect(page).not.toContain(en.staffAccess.noAccess);
  });

  it("should keep the reason and the sign-in advice for every other refusal", () => {
    const page = html({ reason: "User declined" });

    expect(page).toContain("User declined");
    expect(page).toContain('href="/login"');
    expect(page).not.toContain(en.staffAccess.noAccess);
  });
});
