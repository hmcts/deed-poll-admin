import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, findMasters, saveMasterChange } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET, POST } from "./masters/[masterId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findMasters: vi.fn(),
  saveMasterChange: vi.fn()
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
addPathFilters(environment);
const ID = "6f1c1d4e-2a5b-4c3d-8e9f-0a1b2c3d4e5f";
const MASTER = { id: ID, name: "<Master Wren>", email: "wren@example.test", available: false, linked: true, revision: 3 };
const BODY = { name: "Master Wren", email: "wren@example.test", available: "true", revision: "3" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findMasters).mockResolvedValue([MASTER]);
});

async function render(handler: typeof GET, body?: unknown) {
  const res = pageResponse();
  res.locals.locale = "en";
  await handler(pageRequest({ deliveryManager: true, accessToken: "dm-token", params: { masterId: ID }, body }), res);
  const model = res.render.mock.calls[0]?.[1];
  return environment.render("deed-polls/settings/master.njk", { ...model.en, ...model });
}

describe("a Master's Change page", () => {
  it("should title the page for the change and draw every field at the Master's revision, escaped", async () => {
    const markup = await render(GET);

    expect(markup).toMatch(/<title>\s*Change a Master/);
    expect(markup).toContain('<h1 class="govuk-heading-xl">Change a Master</h1>');
    expect(markup).toContain(`action="/deed-polls/settings/masters/${ID}"`);
    expect(markup).toContain('name="revision" value="3"');
    expect(markup).toMatch(/id="master-name"[^>]*value="&lt;Master Wren&gt;"/);
    expect(markup).toMatch(/id="master-email"[^>]*value="wren@example.test"/);
    expect(markup).toMatch(/value="false" checked/);
    expect(markup).not.toMatch(/value="true" checked/);
    expect(markup).toContain('href="/deed-polls/settings#masters"');
    expect(markup).toContain("Save changes");
  });

  it("should warn before the form that a signed-in Master must sign in again after an email change", async () => {
    const markup = await render(GET);

    const warning = markup.indexOf("they will need to sign in again with the new address");
    expect(warning).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(markup.indexOf("<form"));
  });

  it("should not warn about a Master who has not signed in", async () => {
    vi.mocked(findMasters).mockResolvedValue([{ ...MASTER, linked: false }]);

    const markup = await render(GET);

    expect(markup).not.toContain("sign in again");
  });

  it("should replace Save with a reload link on a stale revision, keeping what was typed", async () => {
    vi.mocked(saveMasterChange).mockRejectedValue(new ConflictError("changed"));

    const markup = await render(POST, { ...BODY, name: "Typed" });

    expect(markup).not.toContain("Save changes");
    expect(markup).toContain(`<a id="reload-master" class="govuk-link" href="/deed-polls/settings/masters/${ID}">Reload this Master</a>`);
    expect(markup).toMatch(/id="master-name"[^>]*value="Typed"/);
    expect(markup).toContain('href="#reload-master"');
  });

  it("should mark each refused control and link the summary to it", async () => {
    const markup = await render(POST, { ...BODY, email: "", available: "" });

    const summary = markup.slice(markup.indexOf("govuk-error-summary"), markup.indexOf("</ul>", markup.indexOf("govuk-error-summary")));
    const targets = [...summary.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    expect(targets).toEqual(["master-email", "available"]);
    for (const target of targets) expect(markup).toContain(`id="${target}"`);
  });
});
