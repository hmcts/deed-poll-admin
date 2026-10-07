/**
 * The sign-in-again page's markup. `src/errors.test.ts` pins the status and the model; this pins that the one
 * control on the page goes where it says, because a broken link here leaves the caseworker exactly as stranded as
 * the 500 page did.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";

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

describe("errors/401.njk", () => {
  it("should link back to sign-in carrying the page the caseworker was on", () => {
    const html = environment.render("errors/401.njk", { returnTo: "/deed-polls/c-1/notes/new?tab=a&b=c" });

    expect(html).toContain("You need to sign in again");
    expect(html).toContain('href="/login?returnTo=%2Fdeed-polls%2Fc-1%2Fnotes%2Fnew%3Ftab%3Da%26b%3Dc"');
  });

  it("should link to plain sign-in when there is no page to return to", () => {
    const html = environment.render("errors/401.njk", { returnTo: null });

    expect(html).toContain('href="/login"');
  });
});
