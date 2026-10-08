import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, findGazetteSettings, InvalidInputError, saveGazetteSettings } from "@hmcts/deed-poll";
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
  const req = pageRequest({ admin: true, accessToken: "admin-token", body, query });
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
  it("should preserve typed data on conflict and require a reload before saving again", async () => {
    vi.mocked(saveGazetteSettings).mockRejectedValue(new ConflictError("private internal prose"));
    const { res, markup } = await render({ recipientEmail: "draft@example.com", revision: "2" });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(markup).toContain('value="draft@example.com"');
    expect(markup).toContain("The recipient has changed since you opened this page");
    expect(markup).not.toContain("private internal prose");
    expect(markup).not.toContain('type="submit"');
  });
  it("should translate local and API field errors into Welsh", async () => {
    const local = await render({ recipientEmail: "bad", revision: "2" }, "cy");
    expect(local.markup).toContain("Rhowch gyfeiriad e-bost dilys");
    vi.mocked(saveGazetteSettings).mockRejectedValue(new InvalidInputError("internal", [{ field: "recipientEmail", message: "internal" }]));
    const api = await render({ recipientEmail: "lg@example.com", revision: "2" }, "cy");
    expect(api.markup).toContain("Derbynnydd y London Gazette");
    expect(api.markup).toContain("Rhowch gyfeiriad e-bost dilys");
  });
  it("should translate the saved notification title and content into Welsh", async () => {
    const { markup } = await render(undefined, "cy", { saved: "true" });
    expect(markup).toContain("Llwyddiant");
    expect(markup).toContain("Mae cyfeiriad e-bost y derbynnydd wedi’i gadw.");
  });
  it("should let an outage reach the service error page, without reporting success", async () => {
    vi.mocked(saveGazetteSettings).mockRejectedValue(new Error("unavailable"));
    await expect(render({ recipientEmail: "lg@example.com", revision: "2" })).rejects.toThrow("unavailable");
  });
});
