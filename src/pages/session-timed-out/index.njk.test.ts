/**
 * The timed-out page's markup. `index.test.ts` and `session-lifetime.test.ts` pin the model; this pins that the
 * one control goes where the model says, and that only a timed-out POST says its changes were lost.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

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

/** The content pair first and the handler's own values over it, as `renderInterceptorMiddleware` merges them. */
function html(overrides: Record<string, unknown> = {}): string {
  const res = pageResponse();
  GET(pageRequest({ signedIn: false }), res);
  const model = { ...(res.render.mock.calls[0][1] as Record<string, unknown>), ...overrides };
  return environment.render("session-timed-out/index.njk", { ...(model.en as object), ...model });
}

describe("session-timed-out/index.njk", () => {
  it("should say the user was signed out, with one link to sign in again", () => {
    const page = html();

    expect(page).toContain("You have been signed out");
    expect(page).toContain('href="/login?returnTo=%2F"');
    expect(page).not.toContain("were not saved");
  });

  it("should say the changes were not saved when a POST timed out", () => {
    const page = html({ unsaved: true, signInHref: "https://hmcts-access.example/o/endSession?id_token_hint=x" });

    expect(page).toContain("Any changes you were making were not saved.");
    expect(page).toContain('href="https://hmcts-access.example/o/endSession?id_token_hint=x"');
  });
});
