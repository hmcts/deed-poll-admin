/**
 * The signed-out page's markup, and that an anonymous visitor reaches it (review finding R04, plan
 * `docs/plans/completed/20261021-r04b-signed-out-page.md`). Logout lands here when IDAM's end-session page cannot be
 * reached, so it must render for a signed-out visitor and offer sign-in as a link: `/` would start sign-in at once,
 * through an IDAM session that may have survived the outage.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localeMiddleware } from "@hmcts-cft/express-govuk-starter";
import express, { type NextFunction, type Request, type Response } from "express";
import nunjucks from "nunjucks";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireAuth } from "../../auth/require-auth.js";
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
function html(locale: "en" | "cy"): string {
  const res = pageResponse();
  GET(pageRequest({ signedIn: false }), res);
  const model = res.render.mock.calls[0][1] as Record<string, unknown>;
  return environment.render("signed-out/index.njk", { ...(model[locale] as object), ...model });
}

/** `requireAuth` and the starter's locale middleware in front of the real handler, with no session signed in. */
function anonymousApp() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { session: unknown }).session = { deedPoll: {} };
    next();
  });
  app.use(localeMiddleware());
  app.use(requireAuth());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.render = ((view: string, model: Record<string, unknown>) => {
      res.send(environment.render(`${view}.njk`, { ...(model[res.locals.locale] as object), ...model }));
    }) as Response["render"];
    next();
  });
  app.get("/signed-out", GET);
  return app;
}

describe("signed-out/index.njk", () => {
  it("should say the user signed out of this service, with one link to sign in again", () => {
    const page = html("en");

    expect(page).toContain("You have signed out");
    expect(page).toContain("You have signed out of this service.");
    expect(page).toContain('<a class="govuk-link" href="/login">Sign in again</a>');
  });

  it("should render in Welsh", () => {
    const page = html("cy");

    expect(page).toContain('<a class="govuk-link" href="/login">Mewngofnodi eto</a>');
  });

  it("should answer an anonymous GET with the page itself, not a redirect to sign in", async () => {
    const res = await request(anonymousApp()).get("/signed-out");

    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).toContain("You have signed out");
    expect(res.text).toContain('href="/login"');
  });

  it("should render in Welsh with ?lng=cy", async () => {
    const res = await request(anonymousApp()).get("/signed-out?lng=cy");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Mewngofnodi eto");
    expect(res.text).not.toContain("Sign in again");
  });
});
