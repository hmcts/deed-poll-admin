import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";

const VIEWS = path.dirname(fileURLToPath(import.meta.url));
const GOVUK_FRONTEND = path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", "..");
const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader([GOVUK_FRONTEND, path.join(VIEWS, "../../govuk-frontend/views"), VIEWS]), {
  autoescape: true
});

describe("cookie-preferences.njk", () => {
  it("should render the preferences form with no _csrf input, because nothing reads one (ITHC, plan 20261106 D5)", () => {
    const html = environment.render("cookie-preferences.njk", {
      title: "Cookie preferences",
      saveButton: "Save cookie preferences",
      cookiePreferences: {},
      categories: {}
    });

    expect(html).toContain('action="/cookies/save-preferences"');
    expect(html).not.toContain("_csrf");
  });
});
