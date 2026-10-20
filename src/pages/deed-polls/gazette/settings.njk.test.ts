import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, ForbiddenError, findGazetteSettings, InvalidInputError, saveGazetteSettings, UnauthorizedError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./settings.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findGazetteSettings: vi.fn(),
  saveGazetteSettings: vi.fn()
}));

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../../..", "pages")
  ],
  { autoescape: true }
);
const SETTINGS = { recipientEmail: "lg@example.com", revision: 2, updatedBy: "<Admin>", updatedAt: new Date("2026-10-08T10:00:00Z") };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findGazetteSettings).mockResolvedValue(SETTINGS);
  vi.mocked(saveGazetteSettings).mockResolvedValue(SETTINGS);
});

async function render(body?: unknown, locale = "en", query = {}) {
  const res = pageResponse();
  res.locals.locale = locale;
  const req = pageRequest({ teamLeader: true, accessToken: "admin-token", body, query });
  await (body === undefined ? GET : POST)(req, res);
  const model = res.render.mock.calls[0]?.[1];
  return { res, model, markup: model ? environment.render("deed-polls/gazette/settings.njk", { ...model[locale], ...model }) : "" };
}

describe("Gazette recipient page", () => {
  it("should show the current address, revision and escaped change attribution", async () => {
    const { markup } = await render();
    expect(findGazetteSettings).toHaveBeenCalledExactlyOnceWith({ accessToken: "admin-token" });
    expect(markup).toContain('value="lg@example.com"');
    expect(markup).toContain('name="revision" value="2"');
    expect(markup).toContain("&lt;Admin&gt;");
    expect(markup).toContain("Last changed");
  });
  it("should clearly show unconfigured settings without suggesting the court mailbox", async () => {
    vi.mocked(findGazetteSettings).mockResolvedValue({ recipientEmail: null, revision: 0 });
    const { markup } = await render();
    expect(markup).toContain("The recipient email address has not been set.");
    expect(markup).not.toContain("kbdeedspoll@justice.gov.uk");
  });
  it("should save only validated settings with the original revision and caller token", async () => {
    const { res } = await render({ recipientEmail: "  new@example.com  ", revision: "2", updatedBy: "forged" });
    expect(saveGazetteSettings).toHaveBeenCalledExactlyOnceWith({ recipientEmail: "new@example.com", revision: 2 }, { accessToken: "admin-token" });
    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/gazette/settings?saved=true");
  });
  it.each(["", "bad", "a@example.com,b@example.com"])("should keep invalid input %s and link the error to the field", async (recipientEmail) => {
    const { res, markup, model } = await render({ recipientEmail, revision: "2" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(model.values.recipientEmail).toBe(recipientEmail);
    expect(markup).toContain('href="#recipientEmail"');
    expect(saveGazetteSettings).not.toHaveBeenCalled();
  });
  it("should refuse a missing revision and offer a reload rather than fetch a new one for the write", async () => {
    const { markup } = await render({ recipientEmail: "lg@example.com" });
    expect(markup).toContain("Reload recipient settings");
    expect(markup).not.toContain('type="submit"');
    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(saveGazetteSettings).not.toHaveBeenCalled();
  });
  it.each([
    ["en", "The recipient has changed since you opened this page"],
    ["cy", "Mae’r derbynnydd wedi newid ers i chi agor y dudalen hon"]
  ])("should preserve typed data on conflict and require a reload in %s", async (locale, message) => {
    vi.mocked(saveGazetteSettings).mockRejectedValue(new ConflictError("private internal prose"));
    const values = { recipientEmail: "  draft@example.com  ", revision: "2" };
    const { res, markup, model } = await render(values, locale);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(model.values).toEqual(values);
    expect(model.errorList).toEqual([{ text: expect.stringContaining(message), href: "#reload-settings" }]);
    expect(markup).toContain(message);
    expect(markup).not.toContain("private internal prose");
    expect(markup).not.toContain('type="submit"');
    expect(saveGazetteSettings).toHaveBeenCalledTimes(1);
    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
  it.each([
    ["en", "Enter a valid email address, like name@example.com"],
    ["cy", "Rhowch gyfeiriad e-bost dilys, fel enw@enghraifft.com"]
  ])("should translate local and API field errors into %s and allow correction", async (locale, message) => {
    const local = await render({ recipientEmail: "bad", revision: "2" }, locale);
    expect(local.markup).toContain(message);
    vi.mocked(saveGazetteSettings).mockRejectedValue(new InvalidInputError("internal", [{ field: "recipientEmail", message: "internal" }]));
    const values = { recipientEmail: "  lg@example.com  ", revision: "2" };
    const api = await render(values, locale);
    expect(api.res.status).toHaveBeenCalledWith(400);
    expect(api.model).toMatchObject({
      values,
      emailError: message,
      reloadRequired: false,
      errorList: [{ text: message, href: "#recipientEmail" }]
    });
    expect(api.markup).toContain('type="submit"');
    expect(api.markup).not.toContain("internal");
    expect(saveGazetteSettings).toHaveBeenCalledTimes(1);
    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(api.res.redirect).not.toHaveBeenCalled();
  });
  it.each([
    { locale: "en", errors: [] },
    { locale: "cy", errors: [] },
    { locale: "en", errors: [{ field: "revision", message: "private internal prose" }] },
    { locale: "cy", errors: [{ field: "revision", message: "private internal prose" }] }
  ])("should require a reload for an API rejection without an email field error ($locale, $errors)", async ({ locale, errors }) => {
    vi.mocked(saveGazetteSettings).mockRejectedValue(new InvalidInputError("private internal prose", errors));
    const values = { recipientEmail: "  draft@example.com  ", revision: "2" };

    const { res, model, markup } = await render(values, locale);

    const message =
      locale === "cy"
        ? "Ni ellid cadw’r derbynnydd. Ail-lwythwch y gosodiadau a rhowch gynnig arall arni."
        : "The recipient could not be saved. Reload the settings and try again.";
    expect(res.status).toHaveBeenCalledWith(400);
    expect(model).toMatchObject({ values, reloadRequired: true, errorList: [{ text: message, href: "#reload-settings" }] });
    expect(model.emailError).toBeUndefined();
    expect(markup).toContain(message);
    expect(markup).not.toContain("private internal prose");
    expect(markup).not.toContain('type="submit"');
    expect(saveGazetteSettings).toHaveBeenCalledTimes(1);
    expect(findGazetteSettings).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
  it("should translate the saved notification title and content into Welsh", async () => {
    const { markup } = await render(undefined, "cy", { saved: "true" });
    expect(markup).toContain("Llwyddiant");
    expect(markup).toContain("Mae cyfeiriad e-bost y derbynnydd wedi’i gadw.");
  });
  it.each([new Error("unavailable"), new ForbiddenError("forbidden"), new UnauthorizedError("unauthorized")])(
    "should propagate $name unchanged without rendering or reporting success",
    async (error) => {
      vi.mocked(saveGazetteSettings).mockRejectedValue(error);
      const req = pageRequest({ accessToken: "admin-token", body: { recipientEmail: "lg@example.com", revision: "2" } });
      const res = pageResponse();

      await expect(POST(req, res)).rejects.toBe(error);

      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(saveGazetteSettings).toHaveBeenCalledTimes(1);
      expect(findGazetteSettings).not.toHaveBeenCalled();
    }
  );
});
