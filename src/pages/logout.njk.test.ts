/**
 * The GET /logout page's markup (plan `docs/plans/20261106-ithc-csrf-and-headers.md`, D3): a bookmark or an external
 * link reaches one button that posts, so a GET can never sign anyone out.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { addPathFilters } from "../path-filters.js";
import { GET } from "./logout.js";

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

/** The content pair first and the handler's own values over it, as `renderInterceptorMiddleware` merges them. */
function html(locale: "en" | "cy"): string {
  const res = pageResponse();
  GET(pageRequest(), res);
  const model = res.render.mock.calls[0][1] as Record<string, unknown>;
  return environment.render("logout.njk", { ...(model[locale] as object), ...model });
}

function pageContent(page: string): string {
  return page.slice(page.indexOf("<main"), page.indexOf("</main>"));
}

describe("logout.njk", () => {
  it("should ask for the click with one button that posts to /logout", () => {
    const main = pageContent(html("en"));

    expect(main).toContain('<h1 class="govuk-heading-l">Sign out</h1>');
    expect(main).toContain("Select the button to sign out of this service.");
    expect(main.match(/<form method="post" action="\/logout"/g)).toHaveLength(1);
    expect(main).toMatch(/<button type="submit" class="govuk-button"[^>]*>Sign out<\/button>/);
    expect(main).not.toContain('href="/logout"');
  });

  it("should render in Welsh", () => {
    const main = pageContent(html("cy"));

    expect(main).toContain('<h1 class="govuk-heading-l">Allgofnodi</h1>');
    expect(main).toMatch(/<button type="submit" class="govuk-button"[^>]*>Allgofnodi<\/button>/);
  });
});
